import { Prisma, PrismaClient, type IdempotencyStatus } from "@prisma/client";

import type { CanonicalOperationResult } from "../types/canonical";
import { GatewayError } from "../types/canonical";
import type {
  IdempotencyBeginResult,
  IdempotencyRecord,
  IdempotencyStore,
} from "./idempotency-store";

function toDomainStatus(status: IdempotencyStatus): IdempotencyRecord<CanonicalOperationResult>["status"] {
  if (status === "pending" || status === "completed" || status === "failed") {
    return status;
  }
  throw new GatewayError("INTERNAL_ERROR", "Unsupported idempotency status", 500);
}

export class PrismaIdempotencyStore implements IdempotencyStore<CanonicalOperationResult> {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs: number,
  ) {}

  public async begin(
    key: string,
    fingerprint: string,
    now = Date.now(),
  ): Promise<IdempotencyBeginResult<CanonicalOperationResult>> {
    const nowDate = new Date(now);

    await this.prisma.idempotencyRecord.deleteMany({
      where: {
        expiresAt: {
          lte: nowDate,
        },
      },
    });

    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!existing) {
      try {
        await this.prisma.idempotencyRecord.create({
          data: {
            key,
            fingerprint,
            status: "pending",
            expiresAt: new Date(now + this.ttlMs),
          },
        });
        return { state: "started" };
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const raced = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
          if (raced) {
            return this.resolveExistingRecord(raced, fingerprint);
          }
        }
        throw error;
      }
    }

    return this.resolveExistingRecord(existing, fingerprint);
  }

  public async complete(
    key: string,
    fingerprint: string,
    value: CanonicalOperationResult,
    now = Date.now(),
  ): Promise<void> {
    const existing = await this.mustMatch(key, fingerprint);
    await this.prisma.idempotencyRecord.update({
      where: { key: existing.key },
      data: {
        status: "completed",
        value: value as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(now + this.ttlMs),
      },
    });
  }

  public async fail(
    key: string,
    fingerprint: string,
    value: CanonicalOperationResult,
    now = Date.now(),
  ): Promise<void> {
    const existing = await this.mustMatch(key, fingerprint);
    await this.prisma.idempotencyRecord.update({
      where: { key: existing.key },
      data: {
        status: "failed",
        value: value as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(now + this.ttlMs),
      },
    });
  }

  private async mustMatch(key: string, fingerprint: string) {
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!existing || existing.fingerprint !== fingerprint) {
      throw new GatewayError("IDEMPOTENCY_CONFLICT", "Idempotency state mismatch", 409);
    }
    return existing;
  }

  private resolveExistingRecord(
    existing: {
      key: string;
      fingerprint: string;
      status: IdempotencyStatus;
      value: Prisma.JsonValue | null;
      createdAt: Date;
      expiresAt: Date;
    },
    fingerprint: string,
  ): IdempotencyBeginResult<CanonicalOperationResult> {
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

    return {
      state: "replay",
      record: {
        key: existing.key,
        fingerprint: existing.fingerprint,
        status: toDomainStatus(existing.status),
        createdAt: existing.createdAt.getTime(),
        expiresAt: existing.expiresAt.getTime(),
        ...(existing.value !== null
          ? { value: existing.value as unknown as CanonicalOperationResult }
          : {}),
      },
    };
  }
}
