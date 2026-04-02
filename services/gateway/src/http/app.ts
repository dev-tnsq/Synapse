import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";

import { OperationRegistry } from "../core/operation-registry";
import type { CanonicalOperationInvocation, JsonValue } from "../types/canonical";
import { invokeOperationBodySchema } from "./schemas";

export interface GatewayHttpAppDeps {
  readonly registry: OperationRegistry;
  readonly execute: (invocation: CanonicalOperationInvocation) => Promise<JsonValue>;
}

export function createHttpApp(deps: GatewayHttpAppDeps): FastifyInstance {
  const app = Fastify();

  app.get("/health", async () => ({ ok: true }));

  app.post(
    "/api/v1/ops/:operationId",
    {
      schema: {
        body: invokeOperationBodySchema,
      },
    },
    async (request, reply) => {
      const { operationId } = request.params as { operationId: string };
      const operation = deps.registry.getById(operationId);
      if (!operation) {
        return reply.code(404).send({
          ok: false,
          error: {
            code: "OPERATION_NOT_FOUND",
            message: `Unknown operation: ${operationId}`,
          },
        });
      }

      const parsedBody = invokeOperationBodySchema.parse(request.body);
      const invocation: CanonicalOperationInvocation = {
        requestId: randomUUID(),
        operationId,
        idempotencyKey: parsedBody.idempotencyKey,
        pathParams: {},
        query: parsedBody.query,
        headers: parsedBody.headers,
        body: parsedBody.body ?? null,
      };

      const data = await deps.execute(invocation);
      return reply.code(200).send({ ok: true, operationId, data });
    },
  );

  return app;
}