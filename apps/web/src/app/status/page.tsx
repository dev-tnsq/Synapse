import Link from "next/link";
import {
  bazaarLinks,
  discoveryLinks,
  fetchGatewaySnapshot,
  formatGeneratedAt,
  formatStroops,
  getTopEarningOperations,
  shorten,
} from "@/lib/gateway";

export default async function StatusPage() {
  const snapshot = await fetchGatewaySnapshot();
  const operations = snapshot.operations.data?.operations ?? snapshot.manifest.data?.operations ?? [];
  const proofs = snapshot.proofs.data?.proofs ?? [];
  const manifestSummary = snapshot.manifest.data?.summary;

  const topPriced = getTopEarningOperations(
    operations.filter((operation) => operation.paymentRequired),
    5,
  );

  const latestProofs = [...proofs]
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, 5);

  const checks = [
    {
      label: "health endpoint reachable",
      ok: Boolean(snapshot.health.data) && !snapshot.health.error,
      detail: snapshot.health.error ?? (snapshot.health.data?.status ?? "ok"),
    },
    {
      label: "manifest loaded",
      ok: Boolean(snapshot.manifest.data) && !snapshot.manifest.error,
      detail: snapshot.manifest.error ?? `generated ${formatGeneratedAt(snapshot.manifest.data?.generatedAt ?? 0)}`,
    },
    {
      label: "paid operations available",
      ok: operations.some((operation) => operation.paymentRequired),
      detail: `${operations.filter((operation) => operation.paymentRequired).length} paid ops`,
    },
    {
      label: "proof artifacts available",
      ok: proofs.length > 0,
      detail: `${proofs.length} proofs`,
    },
  ];

  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-cloud">
        <div>
          <p className="eyebrow">health / operations</p>
          <h1>gateway reliability, paid coverage, and proof observability</h1>
          <p>
            this board tracks gateway readiness and proof integrity so operators can validate the
            payment path in one place.
          </p>
        </div>
        <div className="hero-chip-row">
          <p className="hero-chip">health: {snapshot.health.data?.ok === false ? "degraded" : "ok"}</p>
          <p className="hero-chip">network: {snapshot.network}</p>
          <p className="hero-chip">generated: {formatGeneratedAt(snapshot.generatedAt)}</p>
        </div>
      </section>

      {snapshot.inlineErrors.length > 0 ? (
        <section className="surface-card">
          <p className="error-note">{snapshot.inlineErrors.join(" | ")}</p>
        </section>
      ) : null}

      <section className="card-grid three-up">
        <article className="surface-card">
          <h2>totals</h2>
          <dl className="stats-grid compact">
            <div>
              <dt>contracts</dt>
              <dd>{manifestSummary?.contracts ?? snapshot.contracts.data?.contracts.length ?? 0}</dd>
            </div>
            <div>
              <dt>operations</dt>
              <dd>{manifestSummary?.operations ?? operations.length}</dd>
            </div>
            <div>
              <dt>paid operations</dt>
              <dd>
                {manifestSummary?.paidOperations ?? operations.filter((operation) => operation.paymentRequired).length}
              </dd>
            </div>
            <div>
              <dt>free operations</dt>
              <dd>
                {manifestSummary?.freeOperations ?? operations.filter((operation) => !operation.paymentRequired).length}
              </dd>
            </div>
          </dl>
        </article>

        <article className="surface-card">
          <h2>system checks</h2>
          <ul className="clean-list">
            {checks.map((check) => (
              <li key={check.label}>
                <span className={check.ok ? "badge free" : "badge paid"}>{check.ok ? "pass" : "fail"}</span>
                <span className="muted"> {check.label}: {check.detail}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="surface-card">
          <h2>highest priced operations</h2>
          <ul className="clean-list">
            {topPriced.map((operation) => (
              <li key={operation.id}>
                <Link href={`/contracts/${encodeURIComponent(operation.contractId)}`}>
                  {operation.functionName}
                </Link>
                <span className="muted"> {formatStroops(operation.priceStroops)}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="surface-card">
        <h2>latest proofs</h2>
        {latestProofs.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>file</th>
                  <th>generated</th>
                  <th>payment status</th>
                  <th>invoke status</th>
                  <th>tx</th>
                </tr>
              </thead>
              <tbody>
                {latestProofs.map((proof) => (
                  <tr key={proof.file}>
                    <td>{proof.file}</td>
                    <td>{formatGeneratedAt(proof.generatedAt)}</td>
                    <td>{proof.paymentChallengeStatus ?? "-"}</td>
                    <td>{proof.invokeHttpStatus ?? "-"}</td>
                    <td>
                      {proof.proofTxExplorerUrl && proof.txHash ? (
                        <a href={proof.proofTxExplorerUrl} target="_blank" rel="noreferrer">
                          {shorten(proof.txHash, 10)}
                        </a>
                      ) : proof.txHash ? (
                        shorten(proof.txHash, 10)
                      ) : (
                        "pending"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-note">no proof entries available yet.</p>
        )}
      </section>

      <section className="surface-card">
        <h2>operator links</h2>
        <div className="inline-links">
          <Link href="/agent">agent runbook</Link>
          <a href={bazaarLinks.testnetDiscovery} target="_blank" rel="noreferrer">
            testnet discovery
          </a>
          <a href={bazaarLinks.cdpDiscovery} target="_blank" rel="noreferrer">
            cdp discovery
          </a>
          <a href={bazaarLinks.docs} target="_blank" rel="noreferrer">
            gateway docs
          </a>
          <a href={discoveryLinks.health} target="_blank" rel="noreferrer">
            health json
          </a>
          <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
            manifest json
          </a>
          <a href={discoveryLinks.proofs} target="_blank" rel="noreferrer">
            proofs json
          </a>
        </div>
      </section>
    </main>
  );
}