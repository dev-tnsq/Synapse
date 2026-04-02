export interface FacilitatorVerifyResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export class X402FacilitatorClient {
  private readonly normalizedBaseUrl?: string;

  public constructor(baseUrl?: string) {
    const normalized = baseUrl?.trim();
    this.normalizedBaseUrl = normalized ? normalized.replace(/\/+$/, "") : undefined;
  }

  public isEnabled(): boolean {
    return Boolean(this.normalizedBaseUrl);
  }

  public async verifyTx(input: {
    txHash: string;
    operationId: string;
    resource: string;
    minAmountStroops: number;
  }): Promise<FacilitatorVerifyResult> {
    if (!this.normalizedBaseUrl) {
      return { ok: false, reason: "FACILITATOR_DISABLED" };
    }

    try {
      const response = await fetch(`${this.normalizedBaseUrl}/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        return { ok: false, reason: "FACILITATOR_REJECTED" };
      }

      const payload = (await response.json()) as { readonly ok?: unknown; readonly reason?: unknown };
      if (payload.ok) {
        return { ok: true };
      }

      return {
        ok: false,
        reason: typeof payload.reason === "string" ? payload.reason : "FACILITATOR_REJECTED",
      };
    } catch {
      return { ok: false, reason: "FACILITATOR_UNAVAILABLE" };
    }
  }
}