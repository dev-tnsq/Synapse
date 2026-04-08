import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { PrismaClient } from "@prisma/client";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import {
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  getUsdcAddress,
} from "@x402/stellar";
import { ExactStellarScheme as ExactStellarServerScheme } from "@x402/stellar/exact/server";

import { loadConfig, type GatewayConfig } from "./config";
import { OperationRegistry } from "./core/operation-registry";
import { createOperationsRouteHandler } from "./http/routes/operations";
import { McpGatewayRuntime } from "./mcp/runtime";
import { StellarPaymentInspector } from "./stellar/horizon";
import type {
  CanonicalOperationInvocation,
  CanonicalOperationResult,
  CanonicalOperationSpec,
  JsonValue,
} from "./types/canonical";
import { X402FacilitatorClient } from "./x402/facilitator";
import { PrismaIdempotencyStore } from "./x402/prisma-idempotency-store";
import { InMemoryPaymentVerifier } from "./x402/verifier";

function mapNetworkPassphraseToCaip2(passphrase: string): `${string}:${string}` {
  if (passphrase.includes("Test SDF Network")) {
    return STELLAR_TESTNET_CAIP2;
  }
  if (passphrase.includes("Public Global Stellar Network")) {
    return STELLAR_PUBNET_CAIP2;
  }
  throw new Error("Unsupported STELLAR_NETWORK_PASSPHRASE for x402 Stellar scheme");
}

function atomicUnitsToDecimalString(amount: number, decimals: number): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const base = 10 ** decimals;
  const whole = Math.floor(abs / base);
  const fraction = String(abs % base)
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const rendered = fraction.length > 0 ? `${whole}.${fraction}` : String(whole);
  return negative ? `-${rendered}` : rendered;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

async function tryParseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface GatewayServerOptions {
  readonly config?: GatewayConfig;
  readonly operations: readonly CanonicalOperationSpec[];
  readonly execute: (invocation: CanonicalOperationInvocation) => Promise<JsonValue>;
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "OPERATION_NOT_FOUND",
        message: "Route not found",
      },
    }),
  );
}

export function createGatewayServer(options: GatewayServerOptions) {
  const databaseUrl = process.env.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
    throw new Error("Missing required environment variable: DATABASE_URL (Postgres+Prisma is required)");
  }

  const config = options.config ?? loadConfig();
  const paymentProvider = config.payment.provider;
  const registry = new OperationRegistry(options.operations);
  const prisma = new PrismaClient();
  const idempotencyStore = new PrismaIdempotencyStore(prisma, config.idempotency.ttlMs);
  const paymentInspector = new StellarPaymentInspector(
    config.payment.horizonUrl,
    config.payment.maxTxAgeMs,
    config.payment.payToAddress,
  );
  const legacyFacilitatorClient = new X402FacilitatorClient(config.payment.facilitatorUrl ?? "");
  const paymentVerifier = new InMemoryPaymentVerifier(
    config.payment.maxProofAgeMs,
    paymentInspector,
    legacyFacilitatorClient,
  );
  const execute = options.execute;
  const x402Network = mapNetworkPassphraseToCaip2(config.payment.networkPassphrase);
  const x402Server = config.payment.facilitatorUrl
    ? new x402ResourceServer(
        new HTTPFacilitatorClient({
          url: config.payment.facilitatorUrl,
        }),
      ).register(x402Network, new ExactStellarServerScheme())
    : undefined;

  if (paymentProvider === "x402" && !x402Server) {
    throw new Error("x402 payment provider requires a configured x402 resource server");
  }

  const mppRuntimePromises = new Map<
    string,
    Promise<{
      charge: (params: { amount: string; description: string }) => (request: Request) => Promise<unknown>;
    }>
  >();

  const getMppRuntimeForRecipient = (recipient: string) => {
    const existingRuntimePromise = mppRuntimePromises.get(recipient);
    if (existingRuntimePromise) {
      return existingRuntimePromise;
    }

    const mppSecretKey = config.payment.mppSecretKey;
    if (!mppSecretKey) {
      throw new Error("Missing MPP_SECRET_KEY while GATEWAY_PAYMENT_PROVIDER=mpp");
    }

    const runtimePromise = (async () => {
      const [{ Mppx, stellar }, mpp] = await Promise.all([
        import("@stellar/mpp/charge/server"),
        import("@stellar/mpp"),
      ]);

      const currency =
        config.payment.mppCurrency ||
        (x402Network === STELLAR_TESTNET_CAIP2 ? mpp.USDC_SAC_TESTNET : mpp.USDC_SAC_MAINNET);
      const mppNetwork: "stellar:testnet" | "stellar:pubnet" =
        x402Network === STELLAR_TESTNET_CAIP2 ? "stellar:testnet" : "stellar:pubnet";

      const runtime = Mppx.create({
        secretKey: mppSecretKey,
        methods: [
          stellar.charge({
            recipient,
            currency,
            network: mppNetwork,
            ...(typeof process.env.SOROBAN_RPC_URL === "string" && process.env.SOROBAN_RPC_URL.length > 0
              ? { rpcUrl: process.env.SOROBAN_RPC_URL }
              : {}),
          }),
        ],
      }) as {
        charge: (params: { amount: string; description: string }) => (request: Request) => Promise<unknown>;
      };

      return runtime;
    })();

    mppRuntimePromises.set(recipient, runtimePromise);
    return runtimePromise;
  };

  const processMppPayment =
    paymentProvider === "mpp"
      ? async (input: {
          method: "GET" | "POST";
          pathWithQuery: string;
          operation: CanonicalOperationSpec;
          headers: Record<string, string>;
          body: JsonValue;
        }) => {
          const recipient = input.operation.beneficiaryAddress ?? config.payment.payToAddress;
          const runtime = await getMppRuntimeForRecipient(recipient);
          const requestHeaders = new Headers(input.headers);
          requestHeaders.delete("content-length");

          const request = new Request(`http://localhost${input.pathWithQuery}`, {
            method: input.method,
            headers: requestHeaders,
            ...(input.method === "POST"
              ? {
                  body: input.body === null ? "" : JSON.stringify(input.body),
                }
              : {}),
          });

          const chargeResult = (await runtime.charge({
            amount: atomicUnitsToDecimalString(input.operation.priceStroops, 7),
            description: input.operation.description,
          })(request)) as
            | { status: number; challenge: Response }
            | { withReceipt: (response: Response) => Response };

          if ("status" in chargeResult && chargeResult.status === 402) {
            const challengeBody = await tryParseResponseBody(chargeResult.challenge);
            return {
              status: "payment_required" as const,
              headers: headersToRecord(chargeResult.challenge.headers),
              body: {
                ok: false as const,
                error: {
                  code: "PAYMENT_REQUIRED" as const,
                  message: "MPP payment required",
                  details: challengeBody as JsonValue,
                },
              },
            };
          }

          if (!("withReceipt" in chargeResult)) {
            throw new Error("Unexpected MPP charge result without receipt handler");
          }

          const withReceiptResponse = chargeResult.withReceipt(new Response(null, { status: 200 }));
          const mppHeaders = headersToRecord(withReceiptResponse.headers);

          return {
            status: "paid" as const,
            headers: mppHeaders,
            paymentProofId:
              mppHeaders["payment-response"] ??
              mppHeaders["x-payment-response"] ??
              mppHeaders["receipt"] ??
              undefined,
          };
        }
      : undefined;

  const operationsHandler = createOperationsRouteHandler({
    registry,
    idempotencyStore,
    x402Server,
    paymentProvider,
    processMppPayment,
    paymentConfig: {
      x402Network,
      assetAddress: getUsdcAddress(x402Network),
      networkPassphrase: config.payment.networkPassphrase,
      payToAddress: config.payment.payToAddress,
      challengeTtlSeconds: config.payment.challengeTtlSeconds,
    },
    receiptConfig: {
      signerId: config.receipt.signerId,
      signingSecret: config.receipt.signingSecret,
      payToAddress: config.payment.payToAddress,
    },
    execute,
  });

  const mcpRuntime = new McpGatewayRuntime({
    registry,
    idempotencyStore,
    paymentProvider,
    processMppPayment,
    paymentVerifier,
    receiptConfig: {
      signerId: config.receipt.signerId,
      signingSecret: config.receipt.signingSecret,
      payToAddress: config.payment.payToAddress,
    },
    execute,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const handled = await operationsHandler(req, res);
    if (!handled) {
      notFound(res);
    }
  });

  server.once("close", () => {
    void prisma.$disconnect();
  });

  return {
    config,
    registry,
    paymentProvider,
    x402Server,
    prisma,
    server,
    mcpRuntime,
  };
}

export async function startGateway(options: GatewayServerOptions): Promise<void> {
  const instance = createGatewayServer(options);
  if (instance.paymentProvider === "x402" && instance.x402Server) {
    await instance.x402Server.initialize();
  }

  await new Promise<void>((resolve) => {
    instance.server.listen(instance.config.port, instance.config.host, () => {
      resolve();
    });
  });

  const shutdown = () => {
    instance.server.close(() => {
      void instance.prisma.$disconnect();
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stdout.write(
    `gateway listening on http://${instance.config.host}:${instance.config.port}\n`,
  );
}
