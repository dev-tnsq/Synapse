import { createHash } from "node:crypto";

import { GatewayError } from "../types/canonical";

export interface IdempotencyRecord<TValue> {
  readonly key: string;
  readonly fingerprint: string;
  readonly status: "pending" | "completed" | "failed";
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly value?: TValue;
}

export type IdempotencyBeginResult<TValue> =
  | { readonly state: "started" }
  | { readonly state: "in_progress" }
  | { readonly state: "replay"; readonly record: IdempotencyRecord<TValue> };

export interface IdempotencyStore<TValue> {
  begin(key: string, fingerprint: string, now?: number): Promise<IdempotencyBeginResult<TValue>>;
  complete(key: string, fingerprint: string, value: TValue, now?: number): Promise<void>;
  fail(key: string, fingerprint: string, value: TValue, now?: number): Promise<void>;
}

export class InMemoryIdempotencyStore<TValue> implements IdempotencyStore<TValue> {
  private readonly records = new Map<string, IdempotencyRecord<TValue>>();

  public constructor(private readonly ttlMs: number) {}

  public async begin(
    key: string,
    fingerprint: string,
    now = Date.now(),
  ): Promise<IdempotencyBeginResult<TValue>> {
    this.purge(now);
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, {
        key,
        fingerprint,
        status: "pending",
        createdAt: now,
        expiresAt: now + this.ttlMs,
      });
      return { state: "started" };
    }

    if (existing.fingerprint !== fingerprint) {
      throw new GatewayError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for a different request payload",
        409,
      );
    }

    if (existing.status === "pending") {
      return { state: "in_progress" };
    }

    return { state: "replay", record: existing };
  }

  public async complete(
    key: string,
    fingerprint: string,
    value: TValue,
    now = Date.now(),
  ): Promise<void> {
    const existing = this.mustMatch(key, fingerprint);
    this.records.set(key, {
      ...existing,
      status: "completed",
      value,
      expiresAt: now + this.ttlMs,
    });
  }

  public async fail(
    key: string,
    fingerprint: string,
    value: TValue,
    now = Date.now(),
  ): Promise<void> {
    const existing = this.mustMatch(key, fingerprint);
    this.records.set(key, {
      ...existing,
      status: "failed",
      value,
      expiresAt: now + this.ttlMs,
    });
  }

  private mustMatch(key: string, fingerprint: string): IdempotencyRecord<TValue> {
    const existing = this.records.get(key);
    if (!existing || existing.fingerprint !== fingerprint) {
      throw new GatewayError("IDEMPOTENCY_CONFLICT", "Idempotency state mismatch", 409);
    }
    return existing;
  }

  private purge(now: number): void {
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
      }
    }
  }
}

export function createIdempotencyFingerprint(operationId: string, payload: string): string {
  return createHash("sha256").update(operationId).update("|").update(payload).digest("hex");
}
