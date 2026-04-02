import { Horizon } from "@stellar/stellar-sdk";

export interface StellarPaymentInspectionResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly paidAt?: number;
}

interface HorizonTransactionLike {
  readonly created_at?: string;
}

interface HorizonOperationLike {
  readonly type?: string;
  readonly to?: string;
}

const TX_HASH_REGEX = /^[0-9a-fA-F]{64}$/;
const PAYMENT_OPERATION_TYPES = new Set([
  "payment",
  "path_payment_strict_receive",
  "path_payment_strict_send",
]);

export class StellarPaymentInspector {
  private readonly server?: Horizon.Server;

  public constructor(
    horizonUrl: string | undefined,
    private readonly maxTxAgeMs: number,
    private readonly expectedDestination?: string,
  ) {
    const normalizedUrl = horizonUrl?.trim();
    if (normalizedUrl) {
      this.server = new Horizon.Server(normalizedUrl);
    }
  }

  public async inspect(txHash: string, now = Date.now()): Promise<StellarPaymentInspectionResult> {
    if (!TX_HASH_REGEX.test(txHash)) {
      return { ok: false, reason: "INVALID_TX_HASH_FORMAT" };
    }

    if (!this.server) {
      return { ok: true };
    }

    let transaction: HorizonTransactionLike;
    try {
      transaction = (await this.server.transactions().transaction(txHash).call()) as HorizonTransactionLike;
    } catch {
      return { ok: false, reason: "TX_NOT_FOUND" };
    }

    const paidAt = this.toTimestamp(transaction.created_at);
    if (paidAt === undefined) {
      return { ok: false, reason: "TX_MISSING_CREATED_AT" };
    }

    if (now - paidAt > this.maxTxAgeMs) {
      return { ok: false, reason: "TX_TOO_OLD", paidAt };
    }

    const destination = this.expectedDestination?.trim();
    if (!destination) {
      return { ok: true, paidAt };
    }

    let operationsPage: { readonly records?: readonly HorizonOperationLike[] };
    try {
      operationsPage = (await this.server.operations().forTransaction(txHash).call()) as {
        readonly records?: readonly HorizonOperationLike[];
      };
    } catch {
      return { ok: false, reason: "TX_OPS_UNAVAILABLE", paidAt };
    }

    const hasExpectedPayment = (operationsPage.records ?? []).some((operation) => {
      if (!operation.type || !PAYMENT_OPERATION_TYPES.has(operation.type)) {
        return false;
      }
      return operation.to === destination;
    });

    if (!hasExpectedPayment) {
      return { ok: false, reason: "PAYMENT_DESTINATION_MISMATCH", paidAt };
    }

    return { ok: true, paidAt };
  }

  private toTimestamp(raw: string | undefined): number | undefined {
    if (!raw) {
      return undefined;
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return parsed;
  }
}
