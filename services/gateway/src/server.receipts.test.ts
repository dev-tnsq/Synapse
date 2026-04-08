import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { GatewayConfig } from "./config";
import { createGatewayServer } from "./server";
import type { SignedReceiptEnvelope } from "./receipts/envelope";
import type { CanonicalOperationSpec, JsonValue } from "./types/canonical";

const ECHO_OPERATION: CanonicalOperationSpec = {
  id: "ops.echo",
  contractId: "test-contract",
  functionName: "echo",
  title: "Echo",
  description: "Echo request body",
  method: "POST",
  path: "/api/v1/ops/echo",
  paymentRequired: false,
  priceStroops: 0,
  request: {
    body: {
      message: { type: "string", required: true },
    },
  },
  response: {
    data: {
      message: { type: "string", required: true },
    },
  },
};

const TEST_CONFIG: GatewayConfig = {
  env: "test",
  host: "127.0.0.1",
  port: 0,
  logLevel: "error",
  receipt: {
    signerId: "test-signer",
    signingSecret: "test-signing-secret",
  },
  payment: {
    provider: "mpp",
    networkPassphrase: "Test SDF Network ; September 2015",
    payToAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    challengeTtlSeconds: 60,
    maxProofAgeMs: 60_000,
    horizonUrl: undefined,
    maxTxAgeMs: 300_000,
    facilitatorUrl: undefined,
    mppSecretKey: undefined,
    mppCurrency: undefined,
  },
  idempotency: {
    ttlMs: 60_000,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function expectString(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}

function expectNumber(value: unknown): number {
  assert.equal(typeof value, "number");
  return value as number;
}

function expectBoolean(value: unknown): boolean {
  assert.equal(typeof value, "boolean");
  return value as boolean;
}

function expectOptionalString(value: unknown): string | undefined {
  assert.ok(value === undefined || typeof value === "string");
  return value as string | undefined;
}

function parseSignedEnvelope(value: unknown): SignedReceiptEnvelope {
  assert.ok(isObject(value), "signedEnvelope must be an object");

  const version = expectString(value.version);
  const algorithm = expectString(value.algorithm);
  const signerId = expectString(value.signerId);
  const issuedAt = expectNumber(value.issuedAt);
  const receiptId = expectString(value.receiptId);
  const operationId = expectString(value.operationId);
  const requestHash = expectString(value.requestHash);
  const responseHash = expectString(value.responseHash);
  const paid = expectBoolean(value.paid);
  const paymentProofId = expectOptionalString(value.paymentProofId);
  const priceStroops = expectNumber(value.priceStroops);
  const payToAddress = expectString(value.payToAddress);
  const signature = expectString(value.signature);

  return {
    version,
    algorithm,
    signerId,
    issuedAt,
    receiptId,
    operationId,
    requestHash,
    responseHash,
    paid,
    paymentProofId,
    priceStroops,
    payToAddress,
    signature,
  };
}

function parseInvokeEnvelope(responseBody: unknown): SignedReceiptEnvelope {
  assert.ok(isObject(responseBody), "invoke response must be an object");
  assert.equal(responseBody.ok, true);

  const receipt = responseBody.receipt;
  assert.ok(isObject(receipt), "invoke response must include receipt");

  return parseSignedEnvelope(receipt.signedEnvelope);
}

function parseVerifyChecks(responseBody: unknown): { valid: boolean; requestHash: boolean } {
  assert.ok(isObject(responseBody), "verify response must be an object");
  assert.equal(responseBody.ok, true);

  const valid = expectBoolean(responseBody.valid);

  const checks = responseBody.checks;
  assert.ok(isObject(checks), "verify response checks must be an object");
  const requestHash = expectBoolean(checks.requestHash);

  return {
    valid,
    requestHash,
  };
}

async function listen(server: ReturnType<typeof createGatewayServer>["server"]): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string", "server address must be available");

  return (address as AddressInfo).port;
}

async function close(server: ReturnType<typeof createGatewayServer>["server"]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test("receipt verify endpoint validates signed envelopes from operation invoke", async () => {
  const gateway = createGatewayServer({
    config: TEST_CONFIG,
    operations: [ECHO_OPERATION],
    execute: async (invocation) => invocation.body,
  });

  const port = await listen(gateway.server);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const invokeBody: JsonValue = {
      message: "hello",
      nested: {
        count: 1,
      },
      items: ["a", "b"],
    };

    const invokeResponse = await fetch(`${baseUrl}/api/v1/ops/echo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-echo-1",
      },
      body: JSON.stringify(invokeBody),
    });

    assert.equal(invokeResponse.status, 200);

    const invokeResponseBody = (await invokeResponse.json()) as unknown;
    const envelope = parseInvokeEnvelope(invokeResponseBody);

    const verifyResponse = await fetch(`${baseUrl}/api/v1/receipts/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        envelope,
        expected: {
          responseBody: invokeBody,
        },
      }),
    });

    assert.equal(verifyResponse.status, 200);

    const verifyResponseBody = (await verifyResponse.json()) as unknown;
    const verifyChecks = parseVerifyChecks(verifyResponseBody);
    assert.equal(verifyChecks.valid, true);

    const mismatchVerifyResponse = await fetch(`${baseUrl}/api/v1/receipts/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        envelope,
        expected: {
          requestHash: "request-hash-mismatch",
        },
      }),
    });

    assert.equal(mismatchVerifyResponse.status, 200);

    const mismatchVerifyResponseBody = (await mismatchVerifyResponse.json()) as unknown;
    const mismatchChecks = parseVerifyChecks(mismatchVerifyResponseBody);
    assert.equal(mismatchChecks.valid, false);
    assert.equal(mismatchChecks.requestHash, false);
  } finally {
    await close(gateway.server);
  }
});
