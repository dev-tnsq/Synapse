import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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
import { InMemoryIdempotencyStore } from "./x402/idempotency-store";
import { InMemoryPaymentVerifier } from "./x402/verifier";

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
  const config = options.config ?? loadConfig();
  const registry = new OperationRegistry(options.operations);
  const idempotencyStore = new InMemoryIdempotencyStore<CanonicalOperationResult>(
    config.idempotency.ttlMs,
  );
  const paymentInspector = new StellarPaymentInspector(
    config.payment.horizonUrl,
    config.payment.maxTxAgeMs,
    config.payment.payToAddress,
  );
  const facilitatorClient = new X402FacilitatorClient(config.payment.facilitatorUrl);
  const paymentVerifier = new InMemoryPaymentVerifier(
    config.payment.maxProofAgeMs,
    paymentInspector,
    facilitatorClient,
  );
  const execute = options.execute;

  const operationsHandler = createOperationsRouteHandler({
    registry,
    idempotencyStore,
    paymentVerifier,
    paymentConfig: {
      networkPassphrase: config.payment.networkPassphrase,
      payToAddress: config.payment.payToAddress,
      challengeTtlSeconds: config.payment.challengeTtlSeconds,
    },
    execute,
  });

  const mcpRuntime = new McpGatewayRuntime({
    registry,
    idempotencyStore,
    paymentVerifier,
    execute,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const handled = await operationsHandler(req, res);
    if (!handled) {
      notFound(res);
    }
  });

  return {
    config,
    registry,
    server,
    mcpRuntime,
  };
}

export async function startGateway(options: GatewayServerOptions): Promise<void> {
  const instance = createGatewayServer(options);

  await new Promise<void>((resolve) => {
    instance.server.listen(instance.config.port, instance.config.host, () => {
      resolve();
    });
  });

  process.stdout.write(
    `gateway listening on http://${instance.config.host}:${instance.config.port}\n`,
  );
}
