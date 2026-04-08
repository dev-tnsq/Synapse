import { createHash, randomUUID } from "node:crypto";

import { OperationRegistry } from "../core/operation-registry";
import { hashJson, signReceiptEnvelope } from "../receipts/envelope";
import {
  GatewayError,
  isGatewayError,
  type CanonicalOperationInvocation,
  type CanonicalOperationResult,
  type CanonicalOperationSpec,
  type JsonValue,
} from "../types/canonical";
import {
  createIdempotencyFingerprint,
  type IdempotencyStore,
} from "../x402/idempotency-store";
import { InMemoryPaymentVerifier, type PaymentProof } from "../x402/verifier";

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly paymentRequired: boolean;
  readonly priceStroops: number;
}

export interface McpInvokeContext {
  readonly idempotencyKey: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly paymentProof?: PaymentProof;
}

export interface McpRuntimeDependencies {
  readonly registry: OperationRegistry;
  readonly idempotencyStore: IdempotencyStore<CanonicalOperationResult>;
  readonly paymentVerifier: InMemoryPaymentVerifier;
  readonly paymentProvider: "x402" | "mpp";
  readonly receiptConfig: {
    readonly signerId: string;
    readonly signingSecret: string;
    readonly payToAddress: string;
  };
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
        body: CanonicalOperationResult & { ok: false };
      }
    | {
        status: "paid";
        headers: Record<string, string>;
        paymentProofId?: string;
      }
  >;
  readonly execute: (invocation: CanonicalOperationInvocation) => Promise<JsonValue>;
}

function normalizeHeaders(headers?: Readonly<Record<string, string>>): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
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

export class McpGatewayRuntime {
  public constructor(private readonly deps: McpRuntimeDependencies) {}

  public listTools(): readonly McpToolDefinition[] {
    return this.deps.registry.list().map((operation) => ({
      name: operation.id,
      description: operation.description,
      inputSchema: {
        type: "object",
        properties: operation.request.body ?? operation.request.query ?? {},
      },
      paymentRequired: operation.paymentRequired,
      priceStroops: operation.priceStroops,
    }));
  }

  public async invokeTool(
    operationId: string,
    input: JsonValue,
    context: McpInvokeContext,
  ): Promise<CanonicalOperationResult> {
    const operation = this.deps.registry.getById(operationId);
    if (!operation) {
      return {
        ok: false,
        error: {
          code: "OPERATION_NOT_FOUND",
          message: `Unknown tool: ${operationId}`,
        },
      };
    }

    if (!context.idempotencyKey) {
      return {
        ok: false,
        error: {
          code: "MISSING_IDEMPOTENCY_KEY",
          message: "MCP invocation requires idempotencyKey",
        },
      };
    }

    const fingerprint = createIdempotencyFingerprint(operation.id, stableStringify(input));
    const beginResult = await this.deps.idempotencyStore.begin(context.idempotencyKey, fingerprint);
    if (beginResult.state === "in_progress") {
      return {
        ok: false,
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Invocation with same idempotency key is still in progress",
        },
      };
    }
    if (beginResult.state === "replay") {
      return (
        beginResult.record.value ?? {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Replay record missing response",
          },
        }
      );
    }

    const normalizedHeaders = normalizeHeaders(context.headers);
    let paymentProofId: string | undefined;

    if (operation.paymentRequired) {
      if (this.deps.paymentProvider === "mpp" && this.deps.processMppPayment) {
        try {
          const paymentResult = await this.deps.processMppPayment({
            method: operation.method,
            pathWithQuery: operation.path,
            operation,
            headers: normalizedHeaders,
            body: input,
          });

          if (paymentResult.status === "payment_required") {
            await this.deps.idempotencyStore.fail(
              context.idempotencyKey,
              fingerprint,
              paymentResult.body,
            );
            return paymentResult.body;
          }

          paymentProofId = paymentResult.paymentProofId;
        } catch (error: unknown) {
          const failure: CanonicalOperationResult = isGatewayError(error)
            ? error.toFailure()
            : {
                ok: false,
                error: {
                  code: "INTERNAL_ERROR",
                  message: "Could not verify MCP MPP payment",
                },
              };
          await this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
          return failure;
        }
      } else {
        if (!context.paymentProof) {
          const failure: CanonicalOperationResult = {
            ok: false,
            error: {
              code: "PAYMENT_REQUIRED",
              message: "MCP invocation needs payment proof",
            },
          };
          await this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
          return failure;
        }

        try {
          await this.deps.paymentVerifier.verify(context.paymentProof, {
            operationId: operation.id,
            resource: operation.path,
            minAmountStroops: operation.priceStroops,
          });
        } catch (error: unknown) {
          const failure: CanonicalOperationResult = isGatewayError(error)
            ? error.toFailure()
            : {
                ok: false,
                error: {
                  code: "INVALID_PAYMENT_PROOF",
                  message: "Could not verify MCP payment proof",
                },
              };
          await this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
          return failure;
        }
      }
    }

    const invocation: CanonicalOperationInvocation = {
      requestId: randomUUID(),
      operationId,
      idempotencyKey: context.idempotencyKey,
      pathParams: {},
      query: {},
      headers: normalizedHeaders,
      body: input,
    };

    try {
      const output = await this.deps.execute(invocation);
      const receiptId = createHash("sha256")
        .update(`${operation.id}:${context.idempotencyKey}`)
        .digest("hex");
      const signedEnvelope = signReceiptEnvelope(
        {
          version: "1",
          algorithm: "HMAC-SHA256",
          signerId: this.deps.receiptConfig.signerId,
          issuedAt: Date.now(),
          receiptId,
          operationId: operation.id,
          requestHash: fingerprint,
          responseHash: hashJson(output),
          paid: operation.paymentRequired,
          paymentProofId: paymentProofId ?? context.paymentProof?.proofId,
          priceStroops: operation.priceStroops,
          payToAddress: operation.beneficiaryAddress ?? this.deps.receiptConfig.payToAddress,
        },
        this.deps.receiptConfig.signingSecret,
      );
      const success: CanonicalOperationResult = {
        ok: true,
        data: output,
        receipt: {
          receiptId,
          operationId: operation.id,
          paid: operation.paymentRequired,
          paymentProofId: paymentProofId ?? context.paymentProof?.proofId,
          signedEnvelope,
        },
      };
      await this.deps.idempotencyStore.complete(context.idempotencyKey, fingerprint, success);
      return success;
    } catch (error: unknown) {
      const failure: CanonicalOperationResult = isGatewayError(error)
        ? error.toFailure()
        : {
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Unhandled MCP execution failure",
            },
          };
      await this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
      return failure;
    }
  }
}
