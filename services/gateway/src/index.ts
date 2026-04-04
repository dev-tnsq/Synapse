import { spawnSync } from "node:child_process";

import { startGateway } from "./server";
import { createStellarOperationExecutor } from "./stellar/invoker";

function pickNonEmptyEnv(...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function hasCommand(command: "stellar" | "soroban"): boolean {
  const result = spawnSync(command, ["--help"], { stdio: "ignore" });
  return !result.error;
}

function resolveCliCommand(): "stellar" | "soroban" {
  if (hasCommand("stellar")) {
    return "stellar";
  }
  if (hasCommand("soroban")) {
    return "soroban";
  }
  throw new Error("Missing Soroban CLI: expected either 'stellar' or 'soroban' in PATH");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveNetworkArgs(): readonly string[] {
  if (process.env.SOROBAN_NETWORK_ONLY === "1") {
    return ["--network", requiredEnv("SOROBAN_NETWORK"), "--global"];
  }

  return [
    "--rpc-url",
    requiredEnv("SOROBAN_RPC_URL"),
    "--network-passphrase",
    requiredEnv("STELLAR_NETWORK_PASSPHRASE"),
  ];
}

async function main(): Promise<void> {
  const cliCommand = resolveCliCommand();
  const sourceAccount = pickNonEmptyEnv(
    "SOROBAN_SOURCE_ALIAS",
    "SOROBAN_SOURCE_ACCOUNT",
    "SOROBAN_ACCOUNT",
  );

  if (!sourceAccount) {
    throw new Error(
      "Missing Soroban source account env: set SOROBAN_SOURCE_ALIAS, SOROBAN_SOURCE_ACCOUNT, or SOROBAN_ACCOUNT",
    );
  }

  const operationExecutor = createStellarOperationExecutor({
    sourceAccount,
    networkArgs: resolveNetworkArgs(),
    cliCommand,
  });

  await startGateway({
    operations: [],
    execute: operationExecutor,
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway startup failed: ${message}\n`);
  process.exitCode = 1;
});
