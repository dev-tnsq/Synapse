import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";

import type { x402ResourceServer } from "@x402/core/server";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import {
  parseSorobanAbiToCanonical,
  type SorobanAbiArg,
  type SorobanAbiFn,
  type SorobanContractAbi,
} from "../../core/abi-parser";
import {
  hashJson,
  signReceiptEnvelope,
  verifyReceiptEnvelope,
  type SignedReceiptEnvelope,
} from "../../receipts/envelope";
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
import {
  createIdempotencyFingerprint,
  type IdempotencyStore,
} from "../../x402/idempotency-store";

export interface OperationsRouteDependencies {
  readonly registry: OperationRegistry;
  readonly idempotencyStore: IdempotencyStore<CanonicalOperationResult>;
  readonly x402Server?: x402ResourceServer;
  readonly paymentProvider: "x402" | "mpp";
  readonly processMppPayment?: (input: {
    method: "GET" | "POST";
    pathWithQuery: string;
    operation: CanonicalOperationSpec;
    headers: Record<string, string>;
    body: JsonValue;
  }) => Promise<
    | {
        status: "payment_required";
        headers: Record<string, string>;
        body: CanonicalFailure;
      }
    | {
        status: "paid";
        headers: Record<string, string>;
        paymentProofId?: string;
      }
  >;
  readonly paymentConfig: {
    readonly x402Network: `${string}:${string}`;
    readonly assetAddress: string;
    readonly networkPassphrase: string;
    readonly payToAddress: string;
    readonly challengeTtlSeconds: number;
  };
  readonly receiptConfig: {
    readonly signerId: string;
    readonly signingSecret: string;
    readonly payToAddress: string;
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

function getProofDirectory(): string {
  const configured = process.env.GATEWAY_PROOF_DIR;
  if (typeof configured === "string" && configured.trim().length > 0) {
    const configuredPath = configured.trim();
    if (isExistingDirectory(configuredPath)) {
      return configuredPath;
    }
  }

  const candidateA = path.resolve(process.cwd(), "contracts", "target");
  const candidateB = path.resolve(process.cwd(), "..", "..", "contracts", "target");

  if (isExistingDirectory(candidateA)) {
    return candidateA;
  }
  if (isExistingDirectory(candidateB)) {
    return candidateB;
  }

  return candidateA;
}

function isExistingDirectory(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

type ParsedProofArtifact = {
  file: string;
  generatedAt: number;
  paymentChallengeStatus: number | null;
  invokeHttpStatus: number | null;
  txHash: string | null;
  registryContractId: string | null;
  receiptContractId: string | null;
  proofTxExplorerUrl?: string;
};

function parseProofLimit(rawLimit: string | null): number {
  if (typeof rawLimit !== "string") {
    return 10;
  }

  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }

  return Math.min(parsed, 50);
}

function loadProofHistory(explorerBase: string, limit: number): {
  availableProofs: number;
  proofs: ParsedProofArtifact[];
} {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const proofDirectory = getProofDirectory();
  const proofNamePattern = /^e2e-proof\.(\d+)\.json$/;

  try {
    const proofFiles = readdirSync(proofDirectory)
      .map((file) => {
        const match = proofNamePattern.exec(file);
        if (!match) {
          return null;
        }

        return {
          file,
          generatedAt: Number(match[1]),
        };
      })
      .filter((entry): entry is { file: string; generatedAt: number } => entry !== null)
      .sort((left, right) => right.generatedAt - left.generatedAt);

    const proofs = proofFiles.slice(0, safeLimit).map((proofFile) => {
      const proofFilePath = path.join(proofDirectory, proofFile.file);

      try {
        const parsed = JSON.parse(readFileSync(proofFilePath, "utf8")) as Record<string, unknown>;
        const txHash = typeof parsed.txHash === "string" ? parsed.txHash : null;

        return {
          file: path.basename(proofFile.file),
          generatedAt: proofFile.generatedAt,
          paymentChallengeStatus:
            typeof parsed.paymentChallengeStatus === "number" ? parsed.paymentChallengeStatus : null,
          invokeHttpStatus: typeof parsed.invokeHttpStatus === "number" ? parsed.invokeHttpStatus : null,
          txHash,
          registryContractId:
            typeof parsed.registryContractId === "string" ? parsed.registryContractId : null,
          receiptContractId:
            typeof parsed.receiptContractId === "string" ? parsed.receiptContractId : null,
          ...(explorerBase && txHash ? { proofTxExplorerUrl: explorerBase + "/tx/" + txHash } : {}),
        };
      } catch {
        return {
          file: path.basename(proofFile.file),
          generatedAt: proofFile.generatedAt,
          paymentChallengeStatus: null,
          invokeHttpStatus: null,
          txHash: null,
          registryContractId: null,
          receiptContractId: null,
        };
      }
    });

    return {
      availableProofs: proofFiles.length,
      proofs,
    };
  } catch {
    return { availableProofs: 0, proofs: [] };
  }
}

function loadLatestProofSummary(explorerBase: string): {
  availableProofs: number;
  latestProof?: {
    file: string;
    generatedAt: number;
    invokeHttpStatus: number | null;
    paymentChallengeStatus: number | null;
    txHash: string | null;
    registryContractId: string | null;
    receiptContractId: string | null;
    proofTxExplorerUrl?: string;
  };
} {
  const proofHistory = loadProofHistory(explorerBase, 1);
  const latest = proofHistory.proofs[0];

  if (!latest) {
    return { availableProofs: 0 };
  }

  return {
    availableProofs: proofHistory.availableProofs,
    latestProof: {
      file: latest.file,
      generatedAt: latest.generatedAt,
      invokeHttpStatus: latest.invokeHttpStatus,
      paymentChallengeStatus: latest.paymentChallengeStatus,
      txHash: latest.txHash,
      registryContractId: latest.registryContractId,
      receiptContractId: latest.receiptContractId,
      ...(latest.proofTxExplorerUrl ? { proofTxExplorerUrl: latest.proofTxExplorerUrl } : {}),
    },
  };
}

type DiscoveryPaymentConfig = Pick<OperationsRouteDependencies["paymentConfig"], "networkPassphrase" | "payToAddress">;

function resolveOperationPayToAddress(
  operation: CanonicalOperationSpec,
  defaultPayToAddress: string,
): string {
  return operation.beneficiaryAddress ?? defaultPayToAddress;
}

function hasOperationMetadata(operation: CanonicalOperationSpec): boolean {
  return (
    operation.providerId !== undefined ||
    operation.sellerId !== undefined ||
    operation.beneficiaryAddress !== undefined
  );
}

type CanonicalFields = Readonly<Record<string, { readonly type: string; readonly required?: boolean; readonly description?: string }>>;

function toJsonSchemaFromCanonicalFields(fields: CanonicalFields | undefined): {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties: true;
} {
  if (!fields) {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }

  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    const schema: { type: string; description?: string } = {
      type: typeof field.type === "string" ? field.type : "string",
    };

    if (typeof field.description === "string" && field.description.length > 0) {
      schema.description = field.description;
    }

    properties[name] = schema;

    if (field.required === true) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  };
}

export function buildContractDiscovery(
  registry: OperationRegistry,
  _network: StellarNetwork,
  explorerBase: string,
) {
  const grouped = new Map<string, CanonicalOperationSpec[]>();

  for (const operation of registry.list()) {
    const existing = grouped.get(operation.contractId);
    if (existing) {
      existing.push(operation);
    } else {
      grouped.set(operation.contractId, [operation]);
    }
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contractId, operations]) => {
      const sortedOperations = [...operations].sort((left, right) => left.id.localeCompare(right.id));
      const prices = sortedOperations.map((operation) => operation.priceStroops);
      const providerId = sortedOperations.find((operation) => operation.providerId !== undefined)?.providerId;
      const sellerId = sortedOperations.find((operation) => operation.sellerId !== undefined)?.sellerId;
      const beneficiaryAddress =
        sortedOperations.find((operation) => operation.beneficiaryAddress !== undefined)?.beneficiaryAddress;

      return {
        contractId,
        ...(explorerBase ? { contractExplorerUrl: explorerBase + "/contract/" + contractId } : {}),
        paidOperations: sortedOperations.filter((operation) => operation.paymentRequired).length,
        freeOperations: sortedOperations.filter((operation) => !operation.paymentRequired).length,
        minPriceStroops: prices.length > 0 ? Math.min(...prices) : 0,
        maxPriceStroops: prices.length > 0 ? Math.max(...prices) : 0,
        ...(providerId !== undefined ? { providerId } : {}),
        ...(sellerId !== undefined ? { sellerId } : {}),
        ...(beneficiaryAddress !== undefined ? { beneficiaryAddress } : {}),
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
}

export function buildOperationDiscovery(
  registry: OperationRegistry,
  paymentConfig: DiscoveryPaymentConfig,
) {
  return [...registry.list()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((operation) => ({
      id: operation.id,
      contractId: operation.contractId,
      functionName: operation.functionName,
      method: operation.method,
      path: operation.path,
      paymentRequired: operation.paymentRequired,
      priceStroops: operation.priceStroops,
      ...(operation.providerId !== undefined ? { providerId: operation.providerId } : {}),
      ...(operation.sellerId !== undefined ? { sellerId: operation.sellerId } : {}),
      ...(operation.beneficiaryAddress !== undefined
        ? { beneficiaryAddress: operation.beneficiaryAddress }
        : {}),
      payment: {
        challengeRequired: operation.paymentRequired,
        minAmountStroops: operation.priceStroops,
        payToAddress: resolveOperationPayToAddress(operation, paymentConfig.payToAddress),
        networkPassphrase: paymentConfig.networkPassphrase,
      },
    }));
}

export function buildAgentToolDiscovery(registry: OperationRegistry) {
  return [...registry.list()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((operation) => {
      const method = operation.method.toUpperCase();
      const paymentRequired = operation.paymentRequired;

      return {
        name: operation.id,
        description: operation.description,
        method,
        path: operation.path,
        paymentRequired,
        priceStroops: operation.priceStroops,
        idempotencyRequired: true,
        inputSchema: method === "GET"
          ? toJsonSchemaFromCanonicalFields(operation.request.query)
          : toJsonSchemaFromCanonicalFields(operation.request.body),
        invocation: {
          url: operation.path,
          method,
          requiredHeaders: ["idempotency-key", ...(paymentRequired ? ["payment-signature"] : [])],
        },
        ...(hasOperationMetadata(operation)
          ? {
              metadata: {
                ...(operation.providerId !== undefined ? { providerId: operation.providerId } : {}),
                ...(operation.sellerId !== undefined ? { sellerId: operation.sellerId } : {}),
                ...(operation.beneficiaryAddress !== undefined
                  ? { beneficiaryAddress: operation.beneficiaryAddress }
                  : {}),
              },
            }
          : {}),
      };
    });
}

type OpenApiSpec = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
};

export function buildOpenApiSpec(
  registry: OperationRegistry,
  paymentConfig: DiscoveryPaymentConfig,
): OpenApiSpec {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of registry.list()) {
    const pathItem = paths[operation.path] ?? {};
    const methodKey = operation.method.toLowerCase();

    pathItem[methodKey] = {
      operationId: operation.id,
      summary: operation.description,
      tags: [operation.contractId],
      parameters: operation.method === "GET"
        ? [
            {
              name: "idempotency-key",
              in: "header",
              required: true,
              schema: { type: "string" },
              description: "Required idempotency key for safe retries.",
            },
          ]
        : [
            {
              name: "idempotency-key",
              in: "header",
              required: true,
              schema: { type: "string" },
              description: "Required idempotency key for safe retries.",
            },
          ],
      requestBody:
        operation.method === "POST"
          ? {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                  },
                },
              },
            }
          : undefined,
      responses: {
        "200": {
          description: "Successful invocation",
        },
        "400": {
          description: "Invalid request",
        },
        "402": {
          description: "Payment required or invalid payment proof",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean", const: false },
                  error: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      message: { type: "string" },
                    },
                    required: ["code", "message"],
                  },
                },
                required: ["ok", "error"],
              },
            },
          },
        },
      },
      "x-synapse-payment": {
        required: operation.paymentRequired,
        priceStroops: operation.priceStroops,
        payToAddress: resolveOperationPayToAddress(operation, paymentConfig.payToAddress),
        networkPassphrase: paymentConfig.networkPassphrase,
      },
    };

    paths[operation.path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Synapse Gateway Operation API",
      version: "0.1.0",
      description: "Machine-readable contract operation surface generated from canonical operation registry.",
    },
    servers: [{ url: "/" }],
    paths,
  };
}

function hashOpenApiSpec(openapi: OpenApiSpec): string {
  return createHash("sha256").update(JSON.stringify(openapi)).digest("hex");
}

function buildDiscoveryMetadata(
  registry: OperationRegistry,
  paymentConfig: DiscoveryPaymentConfig,
  generatedAt: number,
): { updatedAt: number; openapiHash: string } {
  const openapi = buildOpenApiSpec(registry, paymentConfig);

  return {
    updatedAt: generatedAt,
    openapiHash: hashOpenApiSpec(openapi),
  };
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

function parsePaymentProof(headers: Record<string, string>): PaymentPayload | null {
  const raw = headers["payment-signature"];
  if (!raw) {
    return null;
  }
  try {
    return decodePaymentSignatureHeader(raw);
  } catch {
    throw new GatewayError("INVALID_PAYMENT_PROOF", "payment-signature header is invalid", 402);
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRegisterContractBody(body: JsonValue): {
  readonly contractId: string;
  readonly abi: SorobanContractAbi;
  readonly basePath?: string;
  readonly metadata?: {
    readonly providerId?: string;
    readonly sellerId?: string;
    readonly beneficiaryAddress?: string;
  };
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

    const payable = fn.payable;
    if (typeof payable !== "boolean") {
      throw new GatewayError(
        "INVALID_REQUEST",
        `abi.functions[${fnIndex}].payable must be explicitly set to true or false`,
        400,
      );
    }

    const rawPriceStroops = fn.priceStroops;
    let parsedPriceStroops: number | undefined;
    if (rawPriceStroops !== undefined) {
      if (typeof rawPriceStroops !== "number" || !Number.isInteger(rawPriceStroops) || rawPriceStroops < 0) {
        throw new GatewayError(
          "INVALID_REQUEST",
          `abi.functions[${fnIndex}].priceStroops must be an integer >= 0 when provided`,
          400,
        );
      }
      parsedPriceStroops = rawPriceStroops;
    }

    if (payable && (parsedPriceStroops === undefined || parsedPriceStroops <= 0)) {
      throw new GatewayError(
        "INVALID_REQUEST",
        `abi.functions[${fnIndex}].priceStroops must be an integer > 0 when payable is true`,
        400,
      );
    }

    const priceStroops = payable ? parsedPriceStroops : 0;

    return {
      name,
      inputs: parsedInputs,
      outputs: parsedOutputs,
      doc: typeof fn.doc === "string" ? fn.doc : undefined,
      readonly: typeof fn.readonly === "boolean" ? fn.readonly : undefined,
      payable,
      priceStroops,
    };
  });

  const basePath = body.basePath;
  if (basePath !== undefined && typeof basePath !== "string") {
    throw new GatewayError("INVALID_REQUEST", "basePath must be a string when provided", 400);
  }

  const providerId = body.providerId;
  if (providerId !== undefined && typeof providerId !== "string") {
    throw new GatewayError("INVALID_REQUEST", "providerId must be a string when provided", 400);
  }

  const sellerId = body.sellerId;
  if (sellerId !== undefined && typeof sellerId !== "string") {
    throw new GatewayError("INVALID_REQUEST", "sellerId must be a string when provided", 400);
  }

  const beneficiaryAddress = body.beneficiaryAddress;
  if (beneficiaryAddress !== undefined && typeof beneficiaryAddress !== "string") {
    throw new GatewayError("INVALID_REQUEST", "beneficiaryAddress must be a string when provided", 400);
  }

  const payToAddress = body.payToAddress;
  if (payToAddress !== undefined && typeof payToAddress !== "string") {
    throw new GatewayError("INVALID_REQUEST", "payToAddress must be a string when provided", 400);
  }

  const resolvedBeneficiaryAddress = beneficiaryAddress ?? payToAddress;
  if (resolvedBeneficiaryAddress !== undefined && !/^[GC][A-Z2-7]{55}$/.test(resolvedBeneficiaryAddress)) {
    throw new GatewayError(
      "INVALID_REQUEST",
      "beneficiaryAddress/payToAddress must start with G or C and be 56 base32 characters",
      400,
    );
  }
  if (
    beneficiaryAddress !== undefined &&
    payToAddress !== undefined &&
    beneficiaryAddress !== payToAddress
  ) {
    throw new GatewayError(
      "INVALID_REQUEST",
      "beneficiaryAddress and payToAddress must match when both are provided",
      400,
    );
  }

  const metadata =
    providerId !== undefined || sellerId !== undefined || resolvedBeneficiaryAddress !== undefined
      ? {
          ...(providerId !== undefined ? { providerId } : {}),
          ...(sellerId !== undefined ? { sellerId } : {}),
          ...(resolvedBeneficiaryAddress !== undefined
            ? { beneficiaryAddress: resolvedBeneficiaryAddress }
            : {}),
        }
      : undefined;

  return {
    contractId,
    abi: {
      functions: parsedFunctions,
    },
    basePath,
    metadata,
  };
}

type VerifyReceiptExpected = {
  readonly operationId?: string;
  readonly receiptId?: string;
  readonly requestHash?: string;
  readonly responseBody?: JsonValue;
  readonly priceStroops?: number;
  readonly payToAddress?: string;
};

type VerifyReceiptRequest = {
  readonly envelope: SignedReceiptEnvelope;
  readonly expected?: VerifyReceiptExpected;
};

function requiredStringField(
  value: JsonValue,
  fieldName: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GatewayError("INVALID_REQUEST", `${fieldName} must be a non-empty string`, 400);
  }
  return value;
}

function parseSignedReceiptEnvelope(body: JsonValue): SignedReceiptEnvelope {
  if (!isJsonObject(body)) {
    throw new GatewayError("INVALID_REQUEST", "envelope must be an object", 400);
  }

  const issuedAt = body.issuedAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw new GatewayError("INVALID_REQUEST", "envelope.issuedAt must be a finite number", 400);
  }

  const paid = body.paid;
  if (typeof paid !== "boolean") {
    throw new GatewayError("INVALID_REQUEST", "envelope.paid must be a boolean", 400);
  }

  const priceStroops = body.priceStroops;
  if (typeof priceStroops !== "number" || !Number.isInteger(priceStroops) || priceStroops < 0) {
    throw new GatewayError("INVALID_REQUEST", "envelope.priceStroops must be an integer >= 0", 400);
  }

  const paymentProofId = body.paymentProofId;
  if (paymentProofId !== undefined && typeof paymentProofId !== "string") {
    throw new GatewayError("INVALID_REQUEST", "envelope.paymentProofId must be a string when provided", 400);
  }

  return {
    version: requiredStringField(body.version, "envelope.version"),
    algorithm: requiredStringField(body.algorithm, "envelope.algorithm"),
    signerId: requiredStringField(body.signerId, "envelope.signerId"),
    issuedAt,
    receiptId: requiredStringField(body.receiptId, "envelope.receiptId"),
    operationId: requiredStringField(body.operationId, "envelope.operationId"),
    requestHash: requiredStringField(body.requestHash, "envelope.requestHash"),
    responseHash: requiredStringField(body.responseHash, "envelope.responseHash"),
    paid,
    paymentProofId,
    priceStroops,
    payToAddress: requiredStringField(body.payToAddress, "envelope.payToAddress"),
    signature: requiredStringField(body.signature, "envelope.signature"),
  };
}

function parseVerifyReceiptRequest(body: JsonValue): VerifyReceiptRequest {
  if (!isJsonObject(body)) {
    throw new GatewayError("INVALID_REQUEST", "Request body must be an object", 400);
  }

  const envelope = parseSignedReceiptEnvelope(body.envelope ?? null);
  const expectedValue = body.expected;

  if (expectedValue === undefined) {
    return { envelope };
  }

  if (!isJsonObject(expectedValue)) {
    throw new GatewayError("INVALID_REQUEST", "expected must be an object when provided", 400);
  }

  const operationId = expectedValue.operationId;
  if (operationId !== undefined && typeof operationId !== "string") {
    throw new GatewayError("INVALID_REQUEST", "expected.operationId must be a string when provided", 400);
  }

  const receiptId = expectedValue.receiptId;
  if (receiptId !== undefined && typeof receiptId !== "string") {
    throw new GatewayError("INVALID_REQUEST", "expected.receiptId must be a string when provided", 400);
  }

  const requestHash = expectedValue.requestHash;
  if (requestHash !== undefined && typeof requestHash !== "string") {
    throw new GatewayError("INVALID_REQUEST", "expected.requestHash must be a string when provided", 400);
  }

  const priceStroops = expectedValue.priceStroops;
  if (
    priceStroops !== undefined &&
    (typeof priceStroops !== "number" || !Number.isInteger(priceStroops) || priceStroops < 0)
  ) {
    throw new GatewayError(
      "INVALID_REQUEST",
      "expected.priceStroops must be an integer >= 0 when provided",
      400,
    );
  }

  const payToAddress = expectedValue.payToAddress;
  if (payToAddress !== undefined && typeof payToAddress !== "string") {
    throw new GatewayError("INVALID_REQUEST", "expected.payToAddress must be a string when provided", 400);
  }

  const expected: VerifyReceiptExpected = {
    operationId,
    receiptId,
    requestHash,
    responseBody: expectedValue.responseBody,
    priceStroops,
    payToAddress,
  };

  return {
    envelope,
    expected,
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

async function challengeForOperation(
  operation: CanonicalOperationSpec,
  x402Server: x402ResourceServer,
  paymentConfig: OperationsRouteDependencies["paymentConfig"],
): Promise<{ status: number; body: CanonicalFailure; headers: Record<string, string> }> {
  const payToAddress = resolveOperationPayToAddress(operation, paymentConfig.payToAddress);
  const requirements = await x402Server.buildPaymentRequirements({
    scheme: "exact",
    network: paymentConfig.x402Network,
    payTo: payToAddress,
    price: {
      asset: paymentConfig.assetAddress,
      amount: String(operation.priceStroops),
    },
    maxTimeoutSeconds: paymentConfig.challengeTtlSeconds,
  });

  const paymentRequired = await x402Server.createPaymentRequiredResponse(
    requirements,
    {
      url: operation.path,
      description: operation.description,
      mimeType: "application/json",
    },
    "Payment required",
  );

  return {
    status: 402,
    body: {
      ok: false,
      error: {
        code: "PAYMENT_REQUIRED",
        message: "Missing payment signature",
      },
    },
    headers: {
      "payment-required": encodePaymentRequiredHeader(paymentRequired),
    },
  };
}

export function createOperationsRouteHandler(deps: OperationsRouteDependencies) {
  return async function handleOperationsRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method?.toUpperCase();
    if (!method) {
      return false;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (method === "GET" && path === "/health") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      sendJson(res, 200, {
        status: "ok",
        network,
        generatedAt: Date.now(),
      });
      return true;
    }

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
          parsedBody.metadata,
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
      const generatedAt = Date.now();
      const contracts = buildContractDiscovery(deps.registry, network, explorerBase);
      const discovery = buildDiscoveryMetadata(deps.registry, deps.paymentConfig, generatedAt);

      sendJson(res, 200, {
        network,
        generatedAt,
        discovery,
        contracts,
      });
      return true;
    }

    if (method === "GET" && path === "/api/v1/discovery/operations") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const generatedAt = Date.now();
      const operations = buildOperationDiscovery(deps.registry, deps.paymentConfig);
      const discovery = buildDiscoveryMetadata(deps.registry, deps.paymentConfig, generatedAt);

      sendJson(res, 200, {
        network,
        generatedAt,
        discovery,
        operations,
      });
      return true;
    }

    if (method === "GET" && path === "/api/v1/discovery/agent-tools") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const generatedAt = Date.now();
      const tools = buildAgentToolDiscovery(deps.registry);
      const paid = tools.filter((tool) => tool.paymentRequired).length;
      const discovery = buildDiscoveryMetadata(deps.registry, deps.paymentConfig, generatedAt);

      sendJson(res, 200, {
        network,
        generatedAt,
        discovery,
        tools,
        summary: {
          total: tools.length,
          paid,
          free: tools.length - paid,
        },
      });
      return true;
    }

    if (method === "GET" && path === "/api/v1/discovery/proofs") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const explorerBase = buildExplorerBase(network);
      const generatedAt = Date.now();
      const limit = parseProofLimit(url.searchParams.get("limit"));
      const proofHistory = loadProofHistory(explorerBase, limit);
      const discovery = buildDiscoveryMetadata(deps.registry, deps.paymentConfig, generatedAt);

      sendJson(res, 200, {
        network,
        generatedAt,
        discovery,
        availableProofs: proofHistory.availableProofs,
        proofs: proofHistory.proofs.map((proof) => ({
          file: proof.file,
          generatedAt: proof.generatedAt,
          paymentChallengeStatus: proof.paymentChallengeStatus,
          invokeHttpStatus: proof.invokeHttpStatus,
          txHash: proof.txHash,
          ...(proof.proofTxExplorerUrl ? { proofTxExplorerUrl: proof.proofTxExplorerUrl } : {}),
        })),
      });
      return true;
    }


    if (method === "GET" && path === "/api/v1/discovery/manifest") {
      const network = networkFromPassphrase(deps.paymentConfig.networkPassphrase);
      const explorerBase = buildExplorerBase(network);
      const generatedAt = Date.now();
      const contracts = buildContractDiscovery(deps.registry, network, explorerBase);
      const operations = buildOperationDiscovery(deps.registry, deps.paymentConfig);
      const proof = loadLatestProofSummary(explorerBase);
      const paidOperations = operations.filter((operation) => operation.paymentRequired).length;
      const freeOperations = operations.length - paidOperations;
      const discovery = buildDiscoveryMetadata(deps.registry, deps.paymentConfig, generatedAt);

      sendJson(res, 200, {
        network,
        generatedAt,
        discovery,
        paymentDefaults: {
          payToAddress: deps.paymentConfig.payToAddress,
          networkPassphrase: deps.paymentConfig.networkPassphrase,
          challengeTtlSeconds: deps.paymentConfig.challengeTtlSeconds,
        },
        summary: {
          contracts: contracts.length,
          operations: operations.length,
          paidOperations,
          freeOperations,
        },
        contracts,
        operations,
        proof,
      });
      return true;
    }

    if (method === "GET" && path === "/api/v1/discovery/openapi.json") {
      const generatedAt = Date.now();
      const openapi = buildOpenApiSpec(deps.registry, deps.paymentConfig);
      const openapiHash = hashOpenApiSpec(openapi);

      sendJson(res, 200, openapi, {
        "x-synapse-openapi-hash": openapiHash,
        "x-synapse-updated-at": String(generatedAt),
      });
      return true;
    }

    if (method === "POST" && path === "/api/v1/receipts/verify") {
      try {
        const body = await readJsonBody(req);
        const parsed = parseVerifyReceiptRequest(body);
        const signatureResult = verifyReceiptEnvelope(parsed.envelope, deps.receiptConfig.signingSecret);

        const responseBodyHash =
          parsed.expected?.responseBody === undefined
            ? true
            : parsed.envelope.responseHash === hashJson(parsed.expected.responseBody);
        const operationId =
          parsed.expected?.operationId === undefined
            ? true
            : parsed.envelope.operationId === parsed.expected.operationId;
        const receiptId =
          parsed.expected?.receiptId === undefined
            ? true
            : parsed.envelope.receiptId === parsed.expected.receiptId;
        const requestHash =
          parsed.expected?.requestHash === undefined
            ? true
            : parsed.envelope.requestHash === parsed.expected.requestHash;
        const priceStroops =
          parsed.expected?.priceStroops === undefined
            ? true
            : parsed.envelope.priceStroops === parsed.expected.priceStroops;
        const payToAddress =
          parsed.expected?.payToAddress === undefined
            ? true
            : parsed.envelope.payToAddress === parsed.expected.payToAddress;

        sendJson(res, 200, {
          ok: true,
          valid:
            signatureResult.valid &&
            responseBodyHash &&
            operationId &&
            receiptId &&
            requestHash &&
            priceStroops &&
            payToAddress,
          checks: {
            signature: signatureResult.valid,
            responseBodyHash,
            operationId,
            receiptId,
            requestHash,
            priceStroops,
            payToAddress,
          },
          envelope: {
            receiptId: parsed.envelope.receiptId,
            operationId: parsed.envelope.operationId,
            issuedAt: parsed.envelope.issuedAt,
            signerId: parsed.envelope.signerId,
          },
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
      beginResult = await deps.idempotencyStore.begin(idempotencyKey, fingerprint);
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

    let paymentProofId: string | undefined;
    const responseHeaders: Record<string, string> = {};
    if (operation.paymentRequired) {
      if (deps.paymentProvider === "mpp" && deps.processMppPayment) {
        try {
          const mppResult = await deps.processMppPayment({
            method: method as "GET" | "POST",
            pathWithQuery: path + url.search,
            operation,
            headers: headerMap,
            body,
          });

          if (mppResult.status === "payment_required") {
            sendJson(res, 402, mppResult.body, mppResult.headers);
            await deps.idempotencyStore.fail(idempotencyKey, fingerprint, mppResult.body);
            return true;
          }

          paymentProofId = mppResult.paymentProofId;
          Object.assign(responseHeaders, mppResult.headers);
        } catch (error: unknown) {
          const failure = isGatewayError(error)
            ? error.toFailure()
            : ({
                ok: false,
                error: { code: "INVALID_PAYMENT_PROOF", message: "Unable to process MPP payment" },
              } as const);
          await deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
          sendJson(res, mapErrorStatus(failure), failure);
          return true;
        }
      } else {
      const x402Server = deps.x402Server;
      if (!x402Server) {
        const failure: CanonicalFailure = {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "x402 payment server is not configured",
          },
        };
        await deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
        sendJson(res, 500, failure);
        return true;
      }
      try {
        const paymentPayload = parsePaymentProof(headerMap);
        if (!paymentPayload) {
          const challenge = await challengeForOperation(operation, x402Server, deps.paymentConfig);
          sendJson(res, challenge.status, challenge.body, challenge.headers);
          await deps.idempotencyStore.fail(idempotencyKey, fingerprint, {
            ok: false,
            error: {
              code: "PAYMENT_REQUIRED",
              message: "Missing payment signature",
            },
          });
          return true;
        }

        const requirements = await x402Server.buildPaymentRequirements({
          scheme: "exact",
          network: deps.paymentConfig.x402Network,
          payTo: resolveOperationPayToAddress(operation, deps.paymentConfig.payToAddress),
          price: {
            asset: deps.paymentConfig.assetAddress,
            amount: String(operation.priceStroops),
          },
          maxTimeoutSeconds: deps.paymentConfig.challengeTtlSeconds,
        });

        const matchingRequirements = x402Server.findMatchingRequirements(requirements, paymentPayload);
        if (!matchingRequirements) {
          throw new GatewayError(
            "INVALID_PAYMENT_PROOF",
            "Provided payment does not match operation requirements",
            402,
          );
        }

        const verifyResult = await x402Server.verifyPayment(paymentPayload, matchingRequirements);
        if (!verifyResult.isValid) {
          throw new GatewayError(
            "INVALID_PAYMENT_PROOF",
            verifyResult.invalidMessage ?? "Unable to verify payment signature",
            402,
          );
        }

        const settlementResult = await x402Server.settlePayment(paymentPayload, matchingRequirements);
        if (!settlementResult.success) {
          throw new GatewayError(
            "INVALID_PAYMENT_PROOF",
            settlementResult.errorMessage ?? "Unable to settle payment",
            402,
          );
        }

        paymentProofId = settlementResult.transaction;
        responseHeaders["payment-response"] = encodePaymentResponseHeader(settlementResult);
      } catch (error: unknown) {
        const failure = isGatewayError(error)
          ? error.toFailure()
          : ({
              ok: false,
              error: { code: "INVALID_PAYMENT_PROOF", message: "Unable to process payment signature" },
            } as const);
        await deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
        if (failure.error.code === "INVALID_PAYMENT_PROOF") {
          const challenge = await challengeForOperation(operation, x402Server, deps.paymentConfig);
          sendJson(res, 402, failure, challenge.headers);
          return true;
        }
        sendJson(res, mapErrorStatus(failure), failure);
        return true;
      }
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
      const receiptId = createHash("sha256").update(`${operation.id}:${idempotencyKey}`).digest("hex");
      const signedEnvelope = signReceiptEnvelope(
        {
          version: "1",
          algorithm: "HMAC-SHA256",
          signerId: deps.receiptConfig.signerId,
          issuedAt: Date.now(),
          receiptId,
          operationId: operation.id,
          requestHash: fingerprint,
          responseHash: hashJson(data),
          paid: operation.paymentRequired,
          paymentProofId,
          priceStroops: operation.priceStroops,
          payToAddress: resolveOperationPayToAddress(operation, deps.paymentConfig.payToAddress),
        },
        deps.receiptConfig.signingSecret,
      );
      const success: CanonicalOperationResult = {
        ok: true,
        data,
        receipt: {
          receiptId,
          operationId: operation.id,
          paid: operation.paymentRequired,
          paymentProofId,
          signedEnvelope,
        },
      };
      await deps.idempotencyStore.complete(idempotencyKey, fingerprint, success);
      sendJson(res, 200, success, responseHeaders);
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
      await deps.idempotencyStore.fail(idempotencyKey, fingerprint, failure);
      sendJson(res, mapErrorStatus(failure), failure);
      return true;
    }
  };
}
