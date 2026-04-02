import { createHash, randomUUID } from "node:crypto";

import { OperationRegistry } from "../core/operation-registry";
import {
  GatewayError,
  isGatewayError,
  type CanonicalOperationInvocation,
  type CanonicalOperationResult,
  type JsonValue,
} from "../types/canonical";
import {
  createIdempotencyFingerprint,
  InMemoryIdempotencyStore,
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
  readonly idempotencyStore: InMemoryIdempotencyStore<CanonicalOperationResult>;
  readonly paymentVerifier: InMemoryPaymentVerifier;
  readonly execute: (invocation: CanonicalOperationInvocation) => Promise<JsonValue>;
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
    const beginResult = this.deps.idempotencyStore.begin(context.idempotencyKey, fingerprint);
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

    if (operation.paymentRequired) {
      if (!context.paymentProof) {
        const failure: CanonicalOperationResult = {
          ok: false,
          error: {
            code: "PAYMENT_REQUIRED",
            message: "MCP invocation needs payment proof",
          },
        };
        this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
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
        this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
        return failure;
      }
    }

    const invocation: CanonicalOperationInvocation = {
      requestId: randomUUID(),
      operationId,
      idempotencyKey: context.idempotencyKey,
      pathParams: {},
      query: {},
      headers: context.headers ?? {},
      body: input,
    };

    try {
      const output = await this.deps.execute(invocation);
      const success: CanonicalOperationResult = {
        ok: true,
        data: output,
        receipt: {
          receiptId: createHash("sha256")
            .update(`${operation.id}:${context.idempotencyKey}`)
            .digest("hex"),
          operationId: operation.id,
          paid: operation.paymentRequired,
          paymentProofId: context.paymentProof?.proofId,
        },
      };
      this.deps.idempotencyStore.complete(context.idempotencyKey, fingerprint, success);
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
      this.deps.idempotencyStore.fail(context.idempotencyKey, fingerprint, failure);
      return failure;
    }
  }
}
