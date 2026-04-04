import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GatewayError, type CanonicalOperationInvocation, type JsonValue } from "../types/canonical";

const execFileAsync = promisify(execFile);

export interface StellarInvokerOptions {
  readonly sourceAccount: string;
  readonly networkArgs: readonly string[];
  readonly cliCommand: "stellar" | "soroban";
}

export function parseOperationId(operationId: string): {
  contractId: string;
  functionName: string;
} {
  const separatorIndex = operationId.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= operationId.length - 1) {
    throw new Error(`Invalid operationId format: ${operationId}`);
  }

  return {
    contractId: operationId.slice(0, separatorIndex),
    functionName: operationId.slice(separatorIndex + 1),
  };
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCliValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function parseCommandResult(stdout: string): JsonValue {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return trimmed;
  }
}

function parseTransactionHash(stderr: string): string | undefined {
  const patterns = [/Transaction hash is\s+([a-f0-9]{64})/i, /Signing transaction:\s*([a-f0-9]{64})/i];

  for (const pattern of patterns) {
    const match = pattern.exec(stderr);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function normalizeOutput(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

export function createStellarOperationExecutor(options: StellarInvokerOptions) {
  return async (invocation: CanonicalOperationInvocation): Promise<JsonValue> => {
    const { contractId, functionName } = parseOperationId(invocation.operationId);

    const args: string[] = [
      "contract",
      "invoke",
      "--id",
      contractId,
      ...options.networkArgs,
      "--source-account",
      options.sourceAccount,
      "--",
      functionName,
    ];

    const input: Record<string, JsonValue> = isRecord(invocation.body)
      ? invocation.body
      : Object.keys(invocation.query).length > 0
        ? invocation.query
        : {};

    for (const [key, rawValue] of Object.entries(input)) {
      args.push(`--${key}`, toCliValue(rawValue));
    }

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    const isNetworkOnlyMode =
      options.networkArgs.includes("--network") && !options.networkArgs.includes("--rpc-url");
    if (isNetworkOnlyMode) {
      delete childEnv.STELLAR_NETWORK_PASSPHRASE;
      delete childEnv.SOROBAN_NETWORK_PASSPHRASE;
    }

    try {
      const { stdout, stderr } = await execFileAsync(options.cliCommand, args, { env: childEnv });
      const stderrText = normalizeOutput(stderr);
      const txHash = parseTransactionHash(stderrText);

      return {
        contractId,
        functionName,
        result: parseCommandResult(normalizeOutput(stdout)),
        ...(typeof txHash === "string" ? { txHash } : {}),
        invokedAt: Date.now(),
      };
    } catch (error: unknown) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };

      throw new GatewayError("INTERNAL_ERROR", "Soroban invocation failed", 500, {
        contractId,
        functionName,
        stderr: normalizeOutput(execError.stderr).slice(0, 400),
        stdout: normalizeOutput(execError.stdout).slice(0, 400),
      });
    }
  };
}
