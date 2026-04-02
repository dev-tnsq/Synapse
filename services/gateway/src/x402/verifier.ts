import { createHash } from "node:crypto";

import type { StellarPaymentInspector } from "../stellar/horizon";
import { GatewayError } from "../types/canonical";
import type { X402FacilitatorClient } from "./facilitator";

export interface PaymentProof {
  readonly proofId: string;
  readonly payer: string;
  readonly operationId: string;
  readonly resource: string;
  readonly amountStroops: number;
  readonly nonce: string;
  readonly signature?: string;
  readonly txHash?: string;
  readonly networkPassphrase?: string;
  readonly timestamp?: number;
  readonly mppSummary?: {
    readonly deliveredAmountStroops: number;
    readonly legs: number;
  };
  readonly paymentLegs?: ReadonlyArray<{
    readonly destination: string;
    readonly amountStroops: number;
  }>;
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

  public constructor(
    private readonly maxProofAgeMs: number,
    private readonly paymentInspector?: StellarPaymentInspector,
    private readonly facilitator?: X402FacilitatorClient,
  ) {}

  public async verify(
    proof: PaymentProof,
    expected: PaymentExpectation,
    now = Date.now(),
  ): Promise<PaymentReceipt> {
    this.purge(now);

    if (proof.operationId !== expected.operationId || proof.resource !== expected.resource) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Proof does not match requested operation", 402);
    }

    if (proof.mppSummary) {
      if (
        proof.mppSummary.legs <= 0 ||
        proof.mppSummary.deliveredAmountStroops < expected.minAmountStroops
      ) {
        throw new GatewayError("INVALID_PAYMENT_PROOF", "Invalid MPP summary amount", 402);
      }
    } else if (proof.paymentLegs) {
      const deliveredAmountStroops = proof.paymentLegs.reduce((sum, leg) => {
        return sum + leg.amountStroops;
      }, 0);

      if (deliveredAmountStroops < expected.minAmountStroops) {
        throw new GatewayError("INVALID_PAYMENT_PROOF", "Insufficient legged proof amount", 402);
      }
    } else if (proof.amountStroops < expected.minAmountStroops) {
      throw new GatewayError("INVALID_PAYMENT_PROOF", "Insufficient proof amount", 402);
    }

    const hasSignatureProof = Boolean(proof.signature && proof.nonce);
    const hasTxHashProof = typeof proof.txHash === "string" && proof.txHash.length > 0;
    if (!hasSignatureProof && !hasTxHashProof) {
      throw new GatewayError(
        "INVALID_PAYMENT_PROOF",
        "Proof must include either signature or txHash",
        402,
      );
    }

    if (hasSignatureProof) {
      if (typeof proof.timestamp !== "number") {
        throw new GatewayError("INVALID_PAYMENT_PROOF", "Proof is missing timestamp", 402);
      }
      if (Math.abs(now - proof.timestamp) > this.maxProofAgeMs) {
        throw new GatewayError(
          "INVALID_PAYMENT_PROOF",
          "Proof timestamp is outside accepted window",
          402,
        );
      }
    }

    if (hasTxHashProof) {
      const reasonChain: string[] = [];

      if (!this.facilitator) {
        reasonChain.push("FACILITATOR:UNAVAILABLE");
      } else if (!this.facilitator.isEnabled()) {
        reasonChain.push("FACILITATOR:DISABLED");
      } else {
        try {
          const facilitatorResult = await this.facilitator.verifyTx({
            txHash: proof.txHash!,
            operationId: expected.operationId,
            resource: expected.resource,
            minAmountStroops: expected.minAmountStroops,
          });
          if (!facilitatorResult.ok) {
            reasonChain.push(`FACILITATOR:${facilitatorResult.reason ?? "REJECTED"}`);
          }
        } catch {
          reasonChain.push("FACILITATOR:UNAVAILABLE");
        }
      }

      if (!this.paymentInspector) {
        reasonChain.push("INSPECTOR:UNAVAILABLE");
      } else {
        try {
          const inspection = await this.paymentInspector.inspect(
            proof.txHash!,
            now,
            expected.minAmountStroops,
          );
          if (!inspection.ok) {
            reasonChain.push(`INSPECTOR:${inspection.reason ?? "UNVERIFIED_TX"}`);
          }
        } catch {
          reasonChain.push("INSPECTOR:UNAVAILABLE");
        }
      }

      if (reasonChain.length > 0) {
        throw new GatewayError(
          "INVALID_PAYMENT_PROOF",
          `Transaction proof invalid: ${reasonChain.join(" -> ")}`,
          402,
        );
      }
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
