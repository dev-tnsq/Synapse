import { createHash } from "node:crypto";

import type { JsonObject } from "../types/canonical";

function safeBase64Encode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

export interface ChallengeInput {
  readonly operationId: string;
  readonly resource: string;
  readonly priceStroops: number;
  readonly networkPassphrase: string;
  readonly payToAddress: string;
  readonly ttlSeconds: number;
  readonly now?: number;
}

export interface X402Challenge {
  readonly status: 402;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: {
    readonly code: "PAYMENT_REQUIRED";
    readonly message: string;
    readonly challenge: JsonObject;
  };
}

export function buildX402Challenge(input: ChallengeInput): X402Challenge {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const expiresAt = issuedAt + input.ttlSeconds;
  const nonce = createHash("sha256")
    .update(`${input.operationId}:${input.resource}:${issuedAt}:${expiresAt}`)
    .digest("hex")
    .slice(0, 24);

  const challenge: JsonObject = {
    version: "x402-stellar-v0.1",
    operationId: input.operationId,
    resource: input.resource,
    amountStroops: input.priceStroops,
    payTo: input.payToAddress,
    networkPassphrase: input.networkPassphrase,
    nonce,
    issuedAt,
    expiresAt,
  };

  const encoded = safeBase64Encode(JSON.stringify(challenge));

  return {
    status: 402,
    headers: {
      "WWW-Authenticate": `x402 challenge=\"${encoded}\"`,
      "Cache-Control": "no-store",
    },
    body: {
      code: "PAYMENT_REQUIRED",
      message: "Payment proof is required before invocation",
      challenge,
    },
  };
}
