import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import {
  parseSorobanAbiToCanonical,
  type SorobanAbiArg,
  type SorobanAbiFn,
  type SorobanContractAbi,
} from "../../core/abi-parser";
import { OperationRegistry } from "../../core/operation-registry";
import {
  GatewayError,
  isGatewayError,
  type CanonicalFailure,
  type CanonicalOperationInvocation,
  type CanonicalOperationResult,
  type CanonicalOperationSpec,
  type JsonValue,
} from "../../types/canonical";
import { buildX402Challenge } from "../../x402/challenge";
import {
  createIdempotencyFingerprint,
  InMemoryIdempotencyStore,
} from "../../x402/idempotency-store";
import { InMemoryPaymentVerifier, type PaymentProof, type PaymentReceipt } from "../../x402/verifier";

export interface OperationsRouteDependencies {
  readonly registry: OperationRegistry;
  readonly idempotencyStore: InMemoryIdempotencyStore<CanonicalOperationResult>;
  readonly paymentVerifier: InMemoryPaymentVerifier;
  readonly paymentConfig: {
    readonly networkPassphrase: string;
    readonly payToAddress: string;
    readonly challengeTtlSeconds: number;
  };
  readonly execute: (invocation: CanonicalOperationInvocation) => Promise<JsonValue>;
}

type StellarNetwork = "testnet" | "mainnet" | "custom";

export function networkFromPassphrase(passphrase: string): StellarNetwork {
  if (passphrase.includes("Test SDF Network")) {
    return "testnet";
  }
  if (passphrase.includes("Public Global Stellar Network")) {
    return "mainnet";
  }
  return "custom";
}

export function buildExplorerBase(network: StellarNetwork): string {
  switch (network) {
    case "testnet":
      return "https://stellar.expert/explorer/testnet";
    case "mainnet":
      return "https://stellar.expert/explorer/public";
    default:
      return "";
  }
}

function mapErrorStatus(error: CanonicalFailure): number {
  switch (error.error.code) {
    case "OPERATION_NOT_FOUND":
      return 404;
    case "MISSING_IDEMPOTENCY_KEY":
    case "INVALID_REQUEST":
      return 400;
    case "IDEMPOTENCY_CONFLICT":
    case "PAYMENT_PROOF_REPLAY":
      return 409;
    case "PAYMENT_REQUIRED":
    case "INVALID_PAYMENT_PROOF":
      return 402;
    default:
      return 500;
  }
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function toLowerHeaderMap(headers: IncomingMessage["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    if (typeof rawValue === "string") {
      result[key.toLowerCase()] = rawValue;
    } else if (Array.isArray(rawValue) && rawValue.length > 0) {
      result[key.toLowerCase()] = rawValue.join(",");
    }
  }
  return result;
}

async function readJsonBody(req: IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new GatewayError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

function parsePaymentProof(headers: Record<string, string>): PaymentProof | null {
  const raw = headers["x-payment-proof"];
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PaymentProof;
  } catch {
    throw new GatewayError("INVALID_PAYMENT_PROOF", "x-payment-proof header is not valid JSON", 402);
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRegisterContractBody(body: JsonValue): {
  readonly contractId: string;
  readonly abi: SorobanContractAbi;
  readonly basePath?: string;
} {
  if (!isJsonObject(body)) {
    throw new GatewayError("INVALID_REQUEST", "Request body must be an object", 400);
  }

  const contractId = body.contractId;
  if (typeof contractId !== "string" || contractId.trim().length === 0) {
    throw new GatewayError("INVALID_REQUEST", "contractId must be a non-empty string", 400);
  }

  const abi = body.abi;
  if (!isJsonObject(abi)) {
    throw new GatewayError("INVALID_REQUEST", "abi must be an object", 400);
  }

  const functions = abi.functions;
  if (!Array.isArray(functions)) {
    throw new GatewayError("INVALID_REQUEST", "abi.functions must be an array", 400);
  }

  const parsedFunctions: SorobanAbiFn[] = functions.map((fn, fnIndex) => {
    if (!isJsonObject(fn)) {
      throw new GatewayError("INVALID_REQUEST", `abi.functions[${fnIndex}] must be an object`, 400);
    }

    const name = fn.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new GatewayError("INVALID_REQUEST", `abi.functions[${fnIndex}].name must be a non-empty string`, 400);
    }

    const inputs = fn.inputs;
    if (!Array.isArray(inputs)) {
      throw new GatewayError("INVALID_REQUEST", `abi.functions[${fnIndex}].inputs must be an array`, 400);
    }

    const parsedInputs: SorobanAbiArg[] = inputs.map((input, inputIndex) => {
      if (!isJsonObject(input)) {
        throw new GatewayError(
          "INVALID_REQUEST",
          `abi.functions[${fnIndex}].inputs[${inputIndex}] must be an object`,
          400,
        );
      }

      const inputName = input.name;
      const inputType = input.type;
      if (typeof inputName !== "string" || inputName.trim().length === 0) {
        throw new GatewayError(
          "INVALID_REQUEST",
          `abi.functions[${fnIndex}].inputs[${inputIndex}].name must be a non-empty string`,
          400,
        );
      }
      if (typeof inputType !== "string" || inputType.trim().length === 0) {
        throw new GatewayError(
          "INVALID_REQUEST",
          `abi.functions[${fnIndex}].inputs[${inputIndex}].type must be a non-empty string`,
          400,
        );
      }

      return {
        name: inputName,
        type: inputType,
        required: typeof input.required === "boolean" ? input.required : undefined,
        doc: typeof input.doc === "string" ? input.doc : undefined,
      };
    });

    const outputs = fn.outputs;
    let parsedOutputs: SorobanAbiArg[] | undefined;
    if (outputs !== undefined) {
      if (!Array.isArray(outputs)) {
        throw new GatewayError("INVALID_REQUEST", `abi.functions[${fnIndex}].outputs must be an array`, 400);
      }
      parsedOutputs = outputs.map((output, outputIndex) => {
        if (!isJsonObject(output)) {
          throw new GatewayError(
            "INVALID_REQUEST",
            `abi.functions[${fnIndex}].outputs[${outputIndex}] must be an object`,
            400,
          );
        }

        const outputName = output.name;
        const outputType = output.type;
        if (typeof outputName !== "string" || outputName.trim().length === 0) {
          throw new GatewayError(
            "INVALID_REQUEST",
            `abi.functions[${fnIndex}].outputs[${outputIndex}].name must be a non-empty string`,
            400,
          );
        }
        if (typeof outputType !== "string" || outputType.trim().length === 0) {
          throw new GatewayError(
            "INVALID_REQUEST",
            `abi.functions[${fnIndex}].outputs[${outputIndex}].type must be a non-empty string`,
            400,
          );
        }

        return {
          name: outputName,
          type: outputType,
          required: typeof output.required === "boolean" ? output.required : undefined,
          doc: typeof output.doc === "string" ? output.doc : undefined,
        };
      });
    }

    return {
      name,
      inputs: parsedInputs,
      outputs: parsedOutputs,
      doc: typeof fn.doc === "string" ? fn.doc : undefined,
      readonly: typeof fn.readonly === "boolean" ? fn.readonly : undefined,
      payable: typeof fn.payable === "boolean" ? fn.payable : undefined,
      priceStroops: typeof fn.priceStroops === "number" ? fn.priceStroops : undefined,
    };
  });

  const basePath = body.basePath;
  if (basePath !== undefined && typeof basePath !== "string") {
    throw new GatewayError("INVALID_REQUEST", "basePath must be a string when provided", 400);
  }

  return {
    contractId,
    abi: {
      functions: parsedFunctions,
    },
    basePath,
  };
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(payload);
}

function challengeForOperation(
  operation: CanonicalOperationSpec,
  paymentConfig: OperationsRouteDependencies["paymentConfig"],
): ReturnType<typeof buildX402Challenge> {
  return buildX402Challenge({
    operationId: operation.id,
    resource: operation.path,
    priceStroops: operation.priceStroops,
    networkPassphrase: paymentConfig.networkPassphrase,
    payToAddress: paymentConfig.payToAddress,
    ttlSeconds: paymentConfig.challengeTtlSeconds,
  });
}

export function createOperationsRouteHandler(deps: OperationsRouteDependencies) {
  return async function handleOperationsRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method?.toUpperCase();
    if (!method) {
      return false;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (method === "GET" && path === "/operations") {
      sendJson(res, 200, {
        operations: deps.registry.list(),
      });
      return true;
    }

    if (method === "POST" && path === "/api/v1/contracts/register") {
      try {
        const body = await readJsonBody(req);
        const parsedBody = parseRegisterContractBody(body);
        const operations = parseSorobanAbiToCanonical(
          parsedBody.contractId,
          parsedBody.abi,
          parsedBody.basePath,
        );
        const registeredOperationIds = deps.registry.registerMany(operations);

        sendJson(res, 200, {
          ok: true,
          contractId: parsedBody.contractId,
          registeredOperationIds,
        });
        return true;
      } catch (error: unknown) {
        if (isGatewayError(error)) {
          sendJson(res, error.status, error.toFailure());
          return true;
        }

        sendJson(res, 400, {
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid request payload",
          },
        });
        return true;
      }
    }

    if (method === "GET" && path === "/api/v1/discovery/contracts") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const explorerBase = buildExplorerBase(network);
      const grouped = new Map<string, CanonicalOperationSpec[]>();

      for (const operation of deps.registry.list()) {
        const existing = grouped.get(operation.contractId);
        if (existing) {
          existing.push(operation);
        } else {
          grouped.set(operation.contractId, [operation]);
        }
      }

      const contracts = Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([contractId, operations]) => {
          const sortedOperations = [...operations].sort((left, right) => left.id.localeCompare(right.id));
          const prices = sortedOperations.map((operation) => operation.priceStroops);

          return {
            contractId,
            ...(explorerBase ? { contractExplorerUrl: explorerBase + "/contract/" + contractId } : {}),
            paidOperations: sortedOperations.filter((operation) => operation.paymentRequired).length,
            freeOperations: sortedOperations.filter((operation) => !operation.paymentRequired).length,
            minPriceStroops: prices.length > 0 ? Math.min(...prices) : 0,
            maxPriceStroops: prices.length > 0 ? Math.max(...prices) : 0,
            operations: sortedOperations.map((operation) => ({
              id: operation.id,
              functionName: operation.functionName,
              method: operation.method,
              path: operation.path,
              paymentRequired: operation.paymentRequired,
              priceStroops: operation.priceStroops,
            })),
          };
        });

      sendJson(res, 200, {
        network,
        generatedAt: Date.now(),
        contracts,
      });
      return true;
    }

    if (method === "GET" && path === "/api/v1/discovery/operations") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const operations = [...deps.registry.list()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((operation) => ({
          id: operation.id,
          contractId: operation.contractId,
          functionName: operation.functionName,
          method: operation.method,
          path: operation.path,
          paymentRequired: operation.paymentRequired,
          priceStroops: operation.priceStroops,
          payment: {
            challengeRequired: operation.paymentRequired,
            minAmountStroops: operation.priceStroops,
            payToAddress: deps.paymentConfig.payToAddress,
            networkPassphrase: deps.paymentConfig.networkPassphrase,
          },
        }));

      sendJson(res, 200, {
        network,
        generatedAt: Date.now(),
        operations,
      });
      return true;
    }

    const operation = deps.registry.getByRoute(method as "GET" | "POST", path);
    if (!operation) {
      return false;
    }

    const headerMap = toLowerHeaderMap(req.headers);
    const idempotencyKey = headerMap["idempotency-key"];
    if (!idempotencyKey) {
      sendJson(res, 400, {
        ok: false,
        error: {
          code: "MISSING_IDEMPOTENCY_KEY",
          message: "idempotency-key header is required",
        },
      });
      return true;
    }

    let body: JsonValue = null;
    try {
      body = method === "POST" ? await readJsonBody(req) : null;
    } catch (error: unknown) {
      const failure = isGatewayError(error)
        ? error.toFailure()
        : ({ ok: false, error: { code: "INVALID_REQUEST", message: "Malformed request" } } as const);
      sendJson(res, mapErrorStatus(failure), failure);
      return true;
    }

    const queryObject: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      queryObject[key] = value;
    }

    const fingerprintPayload = stableStringify({
      method,
      path,
      query: queryObject,
      body,
    });
    const fingerprint = createIdempotencyFingerprint(operation.id, fingerprintPayload);

    let beginResult;
    try {
      beginResult = deps.idempotencyStore.begin(idempotencyKey, fingerprint);
    } catch (error: unknown) {
      const failure = isGatewayError(error)
        ? error.toFailure()
        : ({ ok: false, error: { code: "INTERNAL_ERROR", message: "Unexpected idempotency failure" } } as const);
      sendJson(res, mapErrorStatus(failure), failure);
      return true;
    }

    if (beginResult.state === "in_progress") {
      const failure: CanonicalFailure = {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Request with same idempotency key is already in progress",
        },
      };
      sendJson(res, 409, failure);
      return true;
    }

    if (beginResult.state === "replay") {
      sendJson(res, beginResult.record.value?.ok ? 200 : mapErrorStatus(beginResult.record.value as CanonicalFailure), beginResult.record.value ?? {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Idempotent replay had no stored response",
        },
      }, {
        "x-idempotent-replay": "true",
      });
      return true;
    }

    let paymentReceipt: PaymentReceipt | undefined;
    if (operation.paymentRequired) {
      try {
        const proof = parsePaymentProof(headerMap);
        if (!proof) {
          const challenge = challengeForOperation(operation, deps.paymentConfig);
          sendJson(res, challenge.status, challenge.body, challenge.headers);
          deps.idempotencyStore.fail(idempotencyKey, fingerprint, {
            ok: false,
            error: {
              code: "PAYMENT_REQUIRED",
              message: "Missing payment proof",
            },
          });
          return true;
        }

        paymentReceipt = await deps.paymentVerifier.verify(proof, {
          operationId: operation.id,
          resource: operation.path,
          minAmountStroops: operation.priceStroops,
        });
      } catch (error: unknown) {
        const failure = isGatewayError(error)
          ? error.toFailure()
          : ({ ok: false, error: { code: "INVALID_PAYMENT_PROOF", message: "Unable to verify payment proof" } } as const);
        deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
        if (failure.error.code === "INVALID_PAYMENT_PROOF") {
          const challenge = challengeForOperation(operation, deps.paymentConfig);
          sendJson(res, 402, failure, challenge.headers);
          return true;
        }
        sendJson(res, mapErrorStatus(failure), failure);
        return true;
      }
    }

    const invocation: CanonicalOperationInvocation = {
      requestId: randomUUID(),
      operationId: operation.id,
      idempotencyKey,
      pathParams: {},
      query: queryObject,
      headers: headerMap,
      body,
    };

    try {
      const data = await deps.execute(invocation);
      const success: CanonicalOperationResult = {
        ok: true,
        data,
        receipt: {
          receiptId: paymentReceipt?.receiptId ?? createHash("sha256").update(`${operation.id}:${idempotencyKey}`).digest("hex"),
          operationId: operation.id,
          paid: operation.paymentRequired,
          paymentProofId: paymentReceipt?.proofId,
        },
      };
      deps.idempotencyStore.complete(idempotencyKey, fingerprint, success);
      sendJson(res, 200, success);
      return true;
    } catch (error: unknown) {
      const failure: CanonicalFailure = isGatewayError(error)
        ? error.toFailure()
        : {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Unhandled execution failure",
            },
          };
      deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
      sendJson(res, mapErrorStatus(failure), failure);
      return true;
    }
  };
}
