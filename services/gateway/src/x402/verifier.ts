import { createHash } from "node:crypto";

import { GatewayError } from "../types/canonical";

export interface PaymentProof {
  readonly proofId: string;
  readonly payer: string;
  readonly operationId: string;
  readonly resource: string;
  readonly amountStroops: number;
  readonly nonce: string;
  readonly signature: string;
  readonly timestamp: number;
}

export interface PaymentReceipt {
  readonly receiptId: string;
  readonly proofId: string;
  readonly payer: string;
  readonly amountStroops: number;
  readonly verifiedAt: number;
}

export interface PaymentExpectation {
  readonly operationId: string;
  readonly resource: string;
  readonly minAmountStroops: number;
}

export class InMemoryPaymentVerifier {
  private readonly seenProofs = new Map<string, number>();

  public constructor(private readonly maxProofAgeMs: number) {}

  public verify(proof: PaymentProof, expected: PaymentExpectation, now = Date.now()): PaymentReceipt {
    this.purge(now);

    if (proof.operationId !== expected.operationId || proof.resource !== expected.resource) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Proof does not match requested operation", 402);
    }

    if (proof.amountStroops < expected.minAmountStroops) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Insufficient proof amount", 402);
    }

    if (!proof.signature || !proof.nonce) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Proof is missing signature fields", 402);
    }

    if (Math.abs(now - proof.timestamp) > this.maxProofAgeMs) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Proof timestamp is outside accepted window", 402);
    }

    if (this.seenProofs.has(proof.proofId)) {
      throw new GatewayError("PAYMENT_PROOF_REPLAY", "Payment proof already used", 409);
    }

    this.seenProofs.set(proof.proofId, now + this.maxProofAgeMs);

    const receiptId = createHash("sha256")
      .update(`${proof.proofId}:${proof.payer}:${proof.amountStroops}:${now}`)
      .digest("hex");

    return {
      receiptId,
      proofId: proof.proofId,
      payer: proof.payer,
      amountStroops: proof.amountStroops,
      verifiedAt: now,
    };
  }

  private purge(now: number): void {
    for (const [proofId, expiresAt] of this.seenProofs.entries()) {
      if (expiresAt <= now) {
        this.seenProofs.delete(proofId);
      }
    }
  }
}
