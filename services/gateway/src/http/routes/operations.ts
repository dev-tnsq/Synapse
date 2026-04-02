import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

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
