import { startGateway } from "./server";
import { GatewayError, type CanonicalOperationInvocation, type JsonValue } from "./types/canonical";

const operationExecutor = async (
  _invocation: CanonicalOperationInvocation,
): Promise<JsonValue> => {
  throw new GatewayError("INTERNAL_ERROR", "Operation executor is not configured", 500);
};

void startGateway({
  operations: [],
  execute: operationExecutor,
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway startup failed: ${message}\n`);
  process.exitCode = 1;
});