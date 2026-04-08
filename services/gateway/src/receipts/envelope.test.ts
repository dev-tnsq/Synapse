import assert from "node:assert/strict";
import test from "node:test";

import {
  hashJson,
  signReceiptEnvelope,
  verifyReceiptEnvelope,
  type SignedReceiptEnvelopeInput,
} from "./envelope";
import type { JsonValue } from "../types/canonical";

const SIGNING_SECRET = "test-signing-secret";

function buildEnvelopeInput(overrides: Partial<SignedReceiptEnvelopeInput> = {}): SignedReceiptEnvelopeInput {
  return {
    version: "1",
    algorithm: "HMAC-SHA256",
    signerId: "test-signer",
    issuedAt: 1_775_358_090_000,
    receiptId: "receipt-1",
    operationId: "ops.echo",
    requestHash: "request-hash-1",
    responseHash: "response-hash-1",
    paid: false,
    priceStroops: 0,
    payToAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ...overrides,
  };
}

test("sign + verify happy path yields valid signature and expectedSignature", () => {
  const input = buildEnvelopeInput();
  const envelope = signReceiptEnvelope(input, SIGNING_SECRET);

  const verification = verifyReceiptEnvelope(envelope, SIGNING_SECRET);

  assert.equal(verification.valid, true);
  assert.equal(verification.expectedSignature, envelope.signature);
});

test("verify fails when requestHash is tampered", () => {
  const envelope = signReceiptEnvelope(buildEnvelopeInput(), SIGNING_SECRET);
  const tamperedEnvelope = {
    ...envelope,
    requestHash: "request-hash-tampered",
  };

  const verification = verifyReceiptEnvelope(tamperedEnvelope, SIGNING_SECRET);

  assert.equal(verification.valid, false);
  assert.notEqual(verification.expectedSignature, envelope.signature);
});

test("hashJson canonicalization is stable across key ordering, nested objects, and arrays", () => {
  const left: JsonValue = {
    z: 1,
    a: {
      d: true,
      b: [
        { y: 2, x: 1 },
        "done",
      ],
      c: null,
    },
    list: [
      { n: 2, m: 1 },
      [3, 2, 1],
      "tail",
    ],
  };

  const right: JsonValue = {
    list: [
      { m: 1, n: 2 },
      [3, 2, 1],
      "tail",
    ],
    a: {
      c: null,
      b: [
        { x: 1, y: 2 },
        "done",
      ],
      d: true,
    },
    z: 1,
  };

  assert.equal(hashJson(left), hashJson(right));
});
