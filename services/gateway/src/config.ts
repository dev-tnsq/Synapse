export type LogLevel = "debug" | "info" | "warn" | "error";
export type PaymentProvider = "x402" | "mpp";

export interface GatewayConfig {
  readonly env: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly receipt: {
    readonly signerId: string;
    readonly signingSecret: string;
  };
  readonly payment: {
    readonly provider: PaymentProvider;
    readonly networkPassphrase: string;
    readonly payToAddress: string;
    readonly challengeTtlSeconds: number;
    readonly maxProofAgeMs: number;
    readonly horizonUrl?: string;
    readonly maxTxAgeMs: number;
    readonly facilitatorUrl?: string;
    readonly mppSecretKey?: string;
    readonly mppCurrency?: string;
  };
  readonly idempotency: {
    readonly ttlMs: number;
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return raw;
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePaymentProvider(env: NodeJS.ProcessEnv): PaymentProvider {
  const raw = optionalEnv(env, "GATEWAY_PAYMENT_PROVIDER") ?? "x402";
  if (raw === "x402" || raw === "mpp") {
    return raw;
  }
  throw new Error("Environment variable GATEWAY_PAYMENT_PROVIDER must be either x402 or mpp");
}

function isValidStellarRecipientAddress(value: string): boolean {
  return /^[GC][A-Z2-7]{55}$/.test(value);
}

function parseRequiredIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  opts: { min: number; max?: number },
): number {
  const raw = requiredEnv(env, name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  if (parsed < opts.min) {
    throw new Error(`Environment variable ${name} must be >= ${opts.min}`);
  }
  if (typeof opts.max === "number" && parsed > opts.max) {
    throw new Error(`Environment variable ${name} must be <= ${opts.max}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const mode = env.NODE_ENV;
  const normalizedMode: GatewayConfig["env"] =
    mode === "production" || mode === "test" ? mode : "development";

  const logLevelRaw = requiredEnv(env, "GATEWAY_LOG_LEVEL");
  const logLevel: LogLevel =
    logLevelRaw === "debug" ||
    logLevelRaw === "info" ||
    logLevelRaw === "warn" ||
    logLevelRaw === "error"
      ? logLevelRaw
      : (() => {
          throw new Error(
            "Environment variable GATEWAY_LOG_LEVEL must be one of: debug, info, warn, error",
          );
        })();

  const provider = parsePaymentProvider(env);
  const payToAddress = requiredEnv(env, "GATEWAY_PAY_TO_ADDRESS");
  if (!isValidStellarRecipientAddress(payToAddress)) {
    throw new Error(
      "Environment variable GATEWAY_PAY_TO_ADDRESS must start with G or C and be 56 base32 characters",
    );
  }

  const facilitatorUrl = provider === "x402"
    ? requiredEnv(env, "GATEWAY_X402_FACILITATOR_URL")
    : optionalEnv(env, "GATEWAY_X402_FACILITATOR_URL");
  const mppSecretKey = provider === "mpp"
    ? requiredEnv(env, "MPP_SECRET_KEY")
    : optionalEnv(env, "MPP_SECRET_KEY");
  const receiptSignerId = optionalEnv(env, "GATEWAY_RECEIPT_SIGNER_ID") ?? "synapse-gateway";
  const receiptSigningSecret = optionalEnv(env, "GATEWAY_RECEIPT_SIGNING_SECRET") ?? "dev-receipt-secret";

  return {
    env: normalizedMode,
    host: requiredEnv(env, "GATEWAY_HOST"),
    port: parseRequiredIntEnv(env, "GATEWAY_PORT", { min: 1, max: 65535 }),
    logLevel,
    receipt: {
      signerId: receiptSignerId,
      signingSecret: receiptSigningSecret,
    },
    payment: {
      provider,
      networkPassphrase: requiredEnv(env, "STELLAR_NETWORK_PASSPHRASE"),
      payToAddress,
      challengeTtlSeconds: parseRequiredIntEnv(env, "GATEWAY_CHALLENGE_TTL_SECONDS", {
        min: 1,
      }),
      maxProofAgeMs: parseRequiredIntEnv(env, "GATEWAY_MAX_PROOF_AGE_MS", { min: 1 }),
      horizonUrl: requiredEnv(env, "GATEWAY_HORIZON_URL"),
      maxTxAgeMs: parseRequiredIntEnv(env, "GATEWAY_MAX_TX_AGE_MS", { min: 1 }),
      facilitatorUrl,
      mppSecretKey,
      mppCurrency: optionalEnv(env, "MPP_CURRENCY"),
    },
    idempotency: {
      ttlMs: parseRequiredIntEnv(env, "GATEWAY_IDEMPOTENCY_TTL_MS", { min: 1 }),
    },
  };
}
