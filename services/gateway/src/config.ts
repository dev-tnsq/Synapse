export type LogLevel = "debug" | "info" | "warn" | "error";

export interface GatewayConfig {
  readonly env: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly payment: {
    readonly networkPassphrase: string;
    readonly payToAddress: string;
    readonly challengeTtlSeconds: number;
    readonly maxProofAgeMs: number;
    readonly horizonUrl?: string;
    readonly maxTxAgeMs: number;
  };
  readonly idempotency: {
    readonly ttlMs: number;
  };
}

const DEFAULT_CONFIG: GatewayConfig = {
  env: "development",
  host: "0.0.0.0",
  port: 8787,
  logLevel: "info",
  payment: {
    networkPassphrase: "Test SDF Network ; September 2015",
    payToAddress: "GATEWAY_RECEIVER",
    challengeTtlSeconds: 60,
    maxProofAgeMs: 5 * 60 * 1000,
    horizonUrl: undefined,
    maxTxAgeMs: 5 * 60 * 1000,
  },
  idempotency: {
    ttlMs: 10 * 60 * 1000,
  },
};

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const mode = env.NODE_ENV;
  const normalizedMode: GatewayConfig["env"] =
    mode === "production" || mode === "test" ? mode : "development";

  return {
    env: normalizedMode,
    host: env.GATEWAY_HOST ?? DEFAULT_CONFIG.host,
    port: parsePort(env.GATEWAY_PORT, DEFAULT_CONFIG.port),
    logLevel:
      env.GATEWAY_LOG_LEVEL === "debug" ||
      env.GATEWAY_LOG_LEVEL === "info" ||
      env.GATEWAY_LOG_LEVEL === "warn" ||
      env.GATEWAY_LOG_LEVEL === "error"
        ? env.GATEWAY_LOG_LEVEL
        : DEFAULT_CONFIG.logLevel,
    payment: {
      networkPassphrase:
        env.STELLAR_NETWORK_PASSPHRASE ?? DEFAULT_CONFIG.payment.networkPassphrase,
      payToAddress: env.GATEWAY_PAY_TO_ADDRESS ?? DEFAULT_CONFIG.payment.payToAddress,
      challengeTtlSeconds: parsePositiveInt(
        env.GATEWAY_CHALLENGE_TTL_SECONDS,
        DEFAULT_CONFIG.payment.challengeTtlSeconds,
      ),
      maxProofAgeMs: parsePositiveInt(
        env.GATEWAY_MAX_PROOF_AGE_MS,
        DEFAULT_CONFIG.payment.maxProofAgeMs,
      ),
      horizonUrl: env.GATEWAY_HORIZON_URL ?? DEFAULT_CONFIG.payment.horizonUrl,
      maxTxAgeMs: parsePositiveInt(env.GATEWAY_MAX_TX_AGE_MS, DEFAULT_CONFIG.payment.maxTxAgeMs),
    },
    idempotency: {
      ttlMs: parsePositiveInt(env.GATEWAY_IDEMPOTENCY_TTL_MS, DEFAULT_CONFIG.idempotency.ttlMs),
    },
  };
}
