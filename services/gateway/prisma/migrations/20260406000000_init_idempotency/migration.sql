CREATE TYPE "IdempotencyStatus" AS ENUM ('pending', 'completed', 'failed');

CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
