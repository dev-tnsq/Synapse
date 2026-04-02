import { startGateway } from "./server";

void startGateway().catch((error: unknown) => {
  process.stderr.write(`failed to start gateway: ${String(error)}\n`);
  process.exitCode = 1;
});