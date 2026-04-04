type FetchState<T> = {
  data: T | null;
  error: string | null;
};

type ManifestSummary = {
  contracts: number;
  operations: number;
  paidOperations: number;
  freeOperations: number;
};

type ManifestPaymentDefaults = {
  payToAddress: string;
  challengeTtlSeconds: number;
};

type ManifestLatestProof = {
  file: string;
  paymentChallengeStatus: number | null;
  invokeHttpStatus: number | null;
  txHash: string | null;
};

type ManifestProof = {
  availableProofs: number;
  latestProof: ManifestLatestProof | null;
};

type ManifestContract = {
  contractId: string;
  paidOperations: number;
  freeOperations: number;
  minPriceStroops: number;
  maxPriceStroops: number;
};

type Manifest = {
  network: string;
  summary: ManifestSummary;
  paymentDefaults: ManifestPaymentDefaults;
  proof: ManifestProof;
  contracts: ManifestContract[];
};

type Health = {
  status?: string;
  network?: string;
};

type DiscoveryProof = {
  file: string;
  generatedAt: number;
  paymentChallengeStatus: number | null;
  invokeHttpStatus: number | null;
  txHash: string | null;
  proofTxExplorerUrl?: string;
};

type DiscoveryProofsResponse = {
  network: string;
  generatedAt: number;
  availableProofs: number;
  proofs: DiscoveryProof[];
};

const gatewayBaseUrl =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";

async function fetchJson<T>(path: string): Promise<FetchState<T>> {
  try {
    const response = await fetch(`${gatewayBaseUrl}${path}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return { data: null, error: `${response.status} ${response.statusText}` };
    }

    const data = (await response.json()) as T;
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

function truncateMiddle(value: string, keep = 8): string {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

function formatGenerated(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }

  return new Date(seconds * 1000).toLocaleString();
}

export default async function Home() {
  const [manifest, health, proofs] = await Promise.all([
    fetchJson<Manifest>("/api/v1/discovery/manifest"),
    fetchJson<Health>("/health"),
    fetchJson<DiscoveryProofsResponse>("/api/v1/discovery/proofs?limit=6"),
  ]);

  const inlineErrors = [
    manifest.error
      ? `manifest: ${manifest.error} (/api/v1/discovery/manifest)`
      : null,
    health.error ? `health: ${health.error} (/health)` : null,
    proofs.error ? `proofs: ${proofs.error} (/api/v1/discovery/proofs?limit=6)` : null,
  ].filter(Boolean) as string[];

  const network = manifest.data?.network ?? health.data?.network ?? "unknown";
  const summary = manifest.data?.summary;
  const proof = manifest.data?.proof;
  const latestProof = proof?.latestProof;
  const recentProofs = proofs.data?.proofs ?? [];
  const contracts = manifest.data?.contracts ?? [];

  return (
    <main className="app-shell">
      <header className="top-strip" aria-label="gateway and network">
        <span>gateway {gatewayBaseUrl}</span>
        <span>network {network}</span>
      </header>

      {inlineErrors.length > 0 ? (
        <p className="inline-error" role="status">
          {inlineErrors.join(" | ")}
        </p>
      ) : null}

      <section className="metric-row" aria-label="summary metrics">
        <article className="mini-card">
          <p className="mini-label">contracts</p>
          <p className="mini-value">{summary?.contracts ?? "-"}</p>
        </article>
        <article className="mini-card">
          <p className="mini-label">operations</p>
          <p className="mini-value">{summary?.operations ?? "-"}</p>
        </article>
        <article className="mini-card">
          <p className="mini-label">paid</p>
          <p className="mini-value">{summary?.paidOperations ?? "-"}</p>
        </article>
        <article className="mini-card">
          <p className="mini-label">free</p>
          <p className="mini-value">{summary?.freeOperations ?? "-"}</p>
        </article>
        <article className="mini-card">
          <p className="mini-label">proofs</p>
          <p className="mini-value">{proof?.availableProofs ?? "-"}</p>
        </article>
      </section>

      <section className="card" aria-label="latest proof">
        <div className="card-head">
          <h2 className="card-title">latest proof</h2>
          <p className="card-meta">
            ttl {manifest.data?.paymentDefaults.challengeTtlSeconds ?? "-"}s
          </p>
        </div>
        {latestProof ? (
          <dl className="kv-grid">
            <div>
              <dt>file</dt>
              <dd>{latestProof.file}</dd>
            </div>
            <div>
              <dt>challenge</dt>
              <dd>{latestProof.paymentChallengeStatus ?? "-"}</dd>
            </div>
            <div>
              <dt>invoke</dt>
              <dd>{latestProof.invokeHttpStatus ?? "-"}</dd>
            </div>
            <div>
              <dt>tx</dt>
              <dd>{latestProof.txHash ? truncateMiddle(latestProof.txHash, 10) : "-"}</dd>
            </div>
          </dl>
        ) : (
          <p className="empty-line">no proof available</p>
        )}
      </section>

      <section className="card" aria-label="recent proofs">
        <div className="card-head">
          <h2 className="card-title">recent proofs</h2>
          <p className="card-meta">latest 6</p>
        </div>
        <div className="contract-table-wrap">
          <table className="contract-table">
            <thead>
              <tr>
                <th>file</th>
                <th>generated</th>
                <th>challenge</th>
                <th>invoke</th>
                <th>tx</th>
                <th>explorer</th>
              </tr>
            </thead>
            <tbody>
              {proofs.error ? (
                <tr>
                  <td colSpan={6} className="empty-line">
                    failed to load proofs: {proofs.error}
                  </td>
                </tr>
              ) : recentProofs.length > 0 ? (
                recentProofs.map((entry) => (
                  <tr key={entry.file}>
                    <td title={entry.file}>{entry.file}</td>
                    <td>{formatGenerated(entry.generatedAt)}</td>
                    <td>{entry.paymentChallengeStatus ?? "-"}</td>
                    <td>{entry.invokeHttpStatus ?? "-"}</td>
                    <td>{entry.txHash ? truncateMiddle(entry.txHash, 8) : "-"}</td>
                    <td>
                      {entry.proofTxExplorerUrl ? (
                        <a href={entry.proofTxExplorerUrl} target="_blank" rel="noreferrer">
                          open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-line">
                    no recent proofs
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-label="contracts">
        <div className="card-head">
          <h2 className="card-title">contracts</h2>
          <p className="card-meta">pay to {manifest.data?.paymentDefaults.payToAddress ?? "-"}</p>
        </div>
        <div className="contract-table-wrap">
          <table className="contract-table">
            <thead>
              <tr>
                <th>id</th>
                <th>paid</th>
                <th>free</th>
                <th>price (stroops)</th>
              </tr>
            </thead>
            <tbody>
              {contracts.length > 0 ? (
                contracts.map((contract) => (
                  <tr key={contract.contractId}>
                    <td title={contract.contractId}>
                      {truncateMiddle(contract.contractId, 10)}
                    </td>
                    <td>{contract.paidOperations}</td>
                    <td>{contract.freeOperations}</td>
                    <td>
                      {contract.minPriceStroops} - {contract.maxPriceStroops}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-line">
                    no contracts available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
