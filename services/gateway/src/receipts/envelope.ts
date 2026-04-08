import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { JsonValue } from "../types/canonical";

export interface SignedReceiptEnvelope {
  readonly version: string;
  readonly algorithm: string;
  readonly signerId: string;
  readonly issuedAt: number;
  readonly receiptId: string;
  readonly operationId: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly paid: boolean;
  readonly paymentProofId?: string;
  readonly priceStroops: number;
  readonly payToAddress: string;
  readonly signature: string;
}

export type SignedReceiptEnvelopeInput = Omit<SignedReceiptEnvelope, "signature">;

function canonicalizeUnknown(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeUnknown(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeUnknown(item)}`).join(",")}}`;
}

function buildSignaturePayload(input: SignedReceiptEnvelopeInput): JsonValue {
  const payload: JsonValue = {
    version: input.version,
    algorithm: input.algorithm,
    signerId: input.signerId,
    issuedAt: input.issuedAt,
    receiptId: input.receiptId,
    operationId: input.operationId,
    requestHash: input.requestHash,
    responseHash: input.responseHash,
    paid: input.paid,
    priceStroops: input.priceStroops,
    payToAddress: input.payToAddress,
  };

  if (typeof input.paymentProofId === "string" && input.paymentProofId.length > 0) {
    (payload as Record<string, JsonValue>).paymentProofId = input.paymentProofId;
  }

  return payload;
}

function buildExpectedSignature(
  input: SignedReceiptEnvelopeInput,
  signingSecret: string,
): string {
  return createHmac("sha256", signingSecret)
    .update(canonicalizeJson(buildSignaturePayload(input)))
    .digest("hex");
}

function safeCompareSignatures(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  const providedDigest = createHash("sha256").update(providedBuffer).digest();
  const expectedDigest = createHash("sha256").update(expectedBuffer).digest();
  const digestMatches = timingSafeEqual(providedDigest, expectedDigest);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return digestMatches && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function canonicalizeJson(value: JsonValue): string {
  return canonicalizeUnknown(value);
}

export function hashJson(value: JsonValue): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function signReceiptEnvelope(
  input: SignedReceiptEnvelopeInput,
  signingSecret: string,
): SignedReceiptEnvelope {
  const signature = buildExpectedSignature(input, signingSecret);
  return {
    ...input,
    signature,
  };
}

export function verifyReceiptEnvelope(
  envelope: SignedReceiptEnvelope,
  signingSecret: string,
): { valid: boolean; expectedSignature: string } {
  const payload: SignedReceiptEnvelopeInput = {
    version: envelope.version,
    algorithm: envelope.algorithm,
    signerId: envelope.signerId,
    issuedAt: envelope.issuedAt,
    receiptId: envelope.receiptId,
    operationId: envelope.operationId,
    requestHash: envelope.requestHash,
    responseHash: envelope.responseHash,
    paid: envelope.paid,
    paymentProofId: envelope.paymentProofId,
    priceStroops: envelope.priceStroops,
    payToAddress: envelope.payToAddress,
  };

  const expectedSignature = buildExpectedSignature(payload, signingSecret);
  const valid = safeCompareSignatures(envelope.signature, expectedSignature);
  return {
    valid,
    expectedSignature,
  };
}
