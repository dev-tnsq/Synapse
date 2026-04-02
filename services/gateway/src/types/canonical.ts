export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type HttpMethod = "GET" | "POST";
export type DeterministicErrorCode =
  | "INVALID_REQUEST"
  | "OPERATION_NOT_FOUND"
  | "MISSING_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_REQUIRED"
  | "INVALID_PAYMENT_PROOF"
  | "PAYMENT_PROOF_REPLAY"
  | "INTERNAL_ERROR";

export type CanonicalScalarType = "string" | "number" | "boolean" | "object" | "array";

export interface CanonicalFieldSchema {
  readonly type: CanonicalScalarType;
  readonly required?: boolean;
  readonly description?: string;
}

export interface CanonicalRequestSchema {
  readonly path?: Readonly<Record<string, CanonicalFieldSchema>>;
  readonly query?: Readonly<Record<string, CanonicalFieldSchema>>;
  readonly headers?: Readonly<Record<string, CanonicalFieldSchema>>;
  readonly body?: Readonly<Record<string, CanonicalFieldSchema>>;
}

export interface CanonicalResponseSchema {
  readonly data: Readonly<Record<string, CanonicalFieldSchema>>;
}

export interface CanonicalOperationSpec {
  readonly id: string;
  readonly contractId: string;
  readonly functionName: string;
  readonly title: string;
  readonly description: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly paymentRequired: boolean;
  readonly priceStroops: number;
  readonly request: CanonicalRequestSchema;
  readonly response: CanonicalResponseSchema;
}

export interface CanonicalOperationInvocation {
  readonly requestId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: JsonValue;
}

export interface CanonicalReceipt {
  readonly receiptId: string;
  readonly operationId: string;
  readonly paid: boolean;
  readonly paymentProofId?: string;
}

export interface CanonicalSuccess {
  readonly ok: true;
  readonly data: JsonValue;
  readonly receipt: CanonicalReceipt;
}

export interface CanonicalFailure {
  readonly ok: false;
  readonly error: {
    readonly code: DeterministicErrorCode;
    readonly message: string;
    readonly details?: JsonValue;
  };
}

export type CanonicalOperationResult = CanonicalSuccess | CanonicalFailure;

export class GatewayError extends Error {
  public readonly code: DeterministicErrorCode;
  public readonly status: number;
  public readonly details?: JsonValue;

  public constructor(
    code: DeterministicErrorCode,
    message: string,
    status: number,
    details?: JsonValue,
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  public toFailure(): CanonicalFailure {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError;
}
