import Link from "next/link";
import {
  discoveryLinks,
  fetchGatewaySnapshot,
  formatGeneratedAt,
  formatStroops,
  gatewayBaseUrl,
  shorten,
} from "@/lib/gateway";

export default async function HomePage() {
  const snapshot = await fetchGatewaySnapshot();
  const operations = snapshot.operations.data?.operations ?? snapshot.manifest.data?.operations ?? [];
  const contracts = snapshot.contracts.data?.contracts ?? snapshot.manifest.data?.contracts ?? [];
  const proofs = snapshot.proofs.data?.proofs ?? [];

  const paidOperations = operations.filter((operation) => operation.paymentRequired);
  const latestProofAt = proofs.reduce((latest, proof) => Math.max(latest, proof.generatedAt ?? 0), 0);
  const hasNoKeyLists = operations.length === 0 && contracts.length === 0 && proofs.length === 0;
  const gatewayOrigin = (() => {
    try {
      return new URL(discoveryLinks.health).origin;
    } catch {
      return discoveryLinks.health;
    }
  })();

  const proofsAvailable = snapshot.manifest.data?.proof.availableProofs ?? snapshot.proofs.data?.availableProofs ?? proofs.length;
  const payToAddress =
    snapshot.manifest.data?.paymentDefaults.payToAddress ??
    paidOperations[0]?.payment.payToAddress ??
    "-";

  const topContracts = [...contracts]
    .sort((left, right) => {
      if (right.paidOperations !== left.paidOperations) {
        return right.paidOperations - left.paidOperations;
      }

      return right.maxPriceStroops - left.maxPriceStroops;
    })
    .slice(0, 8);

  const topOperations = [...operations]
    .sort((left, right) => {
      if (right.paymentRequired !== left.paymentRequired) {
        return Number(right.paymentRequired) - Number(left.paymentRequired);
      }

      return right.priceStroops - left.priceStroops;
    })
    .slice(0, 10);

  const priceLadderBars = (() => {
    const ladder = [...paidOperations]
      .sort((left, right) => right.priceStroops - left.priceStroops)
      .slice(0, 16);
    const maxPrice = Math.max(...ladder.map((operation) => operation.priceStroops), 1);

    return ladder.map((operation) => {
      const ratio = operation.priceStroops / maxPrice;
      return {
        id: operation.id,
        height: Math.max(12, Math.round(ratio * 100)),
        label: `${operation.method} ${operation.path}`,
      };
    });
  })();

  const routeDensityBars = (() => {
    const densitySource = [...operations]
      .sort((left, right) => {
        if (right.paymentRequired !== left.paymentRequired) {
          return Number(right.paymentRequired) - Number(left.paymentRequired);
        }

        return right.priceStroops - left.priceStroops;
      })
      .slice(0, 16);

    return densitySource.map((operation) => {
      const baseHeight = operation.paymentRequired ? 84 : 24;
      const priceLift = operation.paymentRequired ? Math.min(14, Math.round(operation.priceStroops / 150000)) : 0;

      return {
        id: operation.id,
        height: Math.min(100, baseHeight + priceLift),
        label: `${operation.paymentRequired ? "paid" : "free"} ${operation.method} ${operation.path}`,
      };
    });
  })();

  const proofHealthLine = (() => {
    const recentProofs = [...proofs]
      .sort((left, right) => (right.generatedAt ?? 0) - (left.generatedAt ?? 0))
      .slice(0, 20)
      .reverse();

    return recentProofs.map((proof, index) => {
      const paymentOk = proof.paymentChallengeStatus !== null && proof.paymentChallengeStatus >= 200 && proof.paymentChallengeStatus < 300;
      const invokeOk = proof.invokeHttpStatus !== null && proof.invokeHttpStatus >= 200 && proof.invokeHttpStatus < 300;
      const bothMissing = proof.paymentChallengeStatus === null && proof.invokeHttpStatus === null;

      let height = 30;
      if (paymentOk && invokeOk) {
        height = 92;
      } else if (paymentOk || invokeOk) {
        height = 62;
      } else if (bothMissing) {
        height = 42;
      }

      return {
        id: `${proof.file}-${index}`,
        height,
        label: `${proof.file} payment:${proof.paymentChallengeStatus ?? "na"} invoke:${proof.invokeHttpStatus ?? "na"}`,
      };
    });
  })();

  const paidRatio = operations.length > 0 ? Math.round((paidOperations.length / operations.length) * 100) : 0;
  const healthyProofs = proofs.filter((proof) => {
    const paymentOk = proof.paymentChallengeStatus !== null && proof.paymentChallengeStatus >= 200 && proof.paymentChallengeStatus < 300;
    const invokeOk = proof.invokeHttpStatus !== null && proof.invokeHttpStatus >= 200 && proof.invokeHttpStatus < 300;
    return paymentOk && invokeOk;
  }).length;
  const proofHealthPercent = proofs.length > 0 ? Math.round((healthyProofs / proofs.length) * 100) : 0;

  return (
    <main className="page-shell reveal-in">
      <section className="overview-hero surface-card surface-cloud">
        <div className="overview-hero-grid">
          <div className="overview-copy">
            <p className="eyebrow">synapse overview</p>
            <h1>paid contract intelligence with verifiable settlement signals</h1>
            <p>discover routes, compare pricing, and inspect proof health from one compact control surface.</p>
            <div className="inline-links">
              <Link href="/contracts">contracts</Link>
              <Link href="/explorer">operations</Link>
              <Link href="/status">health</Link>
            </div>
          </div>
          <div className="overview-media" aria-label="overview media loop">
            <video className="overview-loop" autoPlay muted loop playsInline preload="metadata">
              <source src="/hemooverview.mp4" type="video/mp4" />
              your browser does not support the overview video.
            </video>
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">agentic discovery</h2>
          <p className="section-sub">essential machine endpoints for discovery and integration</p>
        </div>
        <div className="start-grid">
          <article className="surface-card">
            <h3>agent tools</h3>
            <p className="muted">callable tools and argument surfaces for autonomous clients.</p>
            <div className="link-cluster">
              <a href={`${gatewayBaseUrl}/api/v1/discovery/agent-tools`} target="_blank" rel="noreferrer">
                /api/v1/discovery/agent-tools
              </a>
            </div>
          </article>
          <article className="surface-card">
            <h3>operations index</h3>
            <p className="muted">payment requirement, method, route, and listed price in one feed.</p>
            <div className="link-cluster">
              <a href={`${gatewayBaseUrl}/api/v1/discovery/operations`} target="_blank" rel="noreferrer">
                /api/v1/discovery/operations
              </a>
            </div>
          </article>
          <article className="surface-card">
            <h3>openapi schema</h3>
            <p className="muted">integration-ready schema for generated clients and toolchains.</p>
            <div className="link-cluster">
              <a href={`${gatewayBaseUrl}/api/v1/discovery/openapi.json`} target="_blank" rel="noreferrer">
                /api/v1/discovery/openapi.json
              </a>
            </div>
          </article>
        </div>
      </section>

      {snapshot.inlineErrors.length > 0 ? (
        <section className="surface-card">
          <p className="error-note">{snapshot.inlineErrors.join(" | ")}</p>
        </section>
      ) : null}

      {snapshot.inlineErrors.length > 0 && hasNoKeyLists ? (
        <section className="surface-card surface-earth recovery-panel">
          <div className="recovery-head">
            <h2>gateway offline or uninitialized</h2>
            <p>no contracts, operations, or proofs are available yet. restore gateway and run one paid call.</p>
            <p className="muted">expected gateway origin: {gatewayOrigin}</p>
          </div>
          <div className="link-cluster">
            <Link href="/contracts">open contracts</Link>
            <Link href="/explorer">open operations</Link>
            <Link href="/status">open status</Link>
            <a href={discoveryLinks.health} target="_blank" rel="noreferrer">
              health endpoint
            </a>
          </div>
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2 className="section-title">live overview</h2>
          <p className="section-sub">generated {formatGeneratedAt(snapshot.generatedAt)} on {snapshot.network} | executive telemetry</p>
        </div>
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">contracts</p>
            <p className="metric-value">{contracts.length.toLocaleString()}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">operations</p>
            <p className="metric-value">{operations.length.toLocaleString()}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">paid ops</p>
            <p className="metric-value">{paidOperations.length.toLocaleString()}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">proofs</p>
            <p className="metric-value">{proofsAvailable.toLocaleString()}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">payout address</p>
            <p className="metric-value">{shorten(payToAddress, 10)}</p>
            <p className="metric-trend">latest proof: {latestProofAt > 0 ? formatGeneratedAt(latestProofAt) : "-"}</p>
          </article>
        </div>
        <div className="insight-grid" style={{ marginTop: "0.6rem" }}>
          <article className="insight-card">
            <p className="metric-label">paid route density</p>
            <p className="insight-value">{paidRatio}%</p>
            <p className="insight-note">share of routes requiring payment challenge and settlement proof</p>
          </article>
          <article className="insight-card">
            <p className="metric-label">proof success rate</p>
            <p className="insight-value">{proofHealthPercent}%</p>
            <p className="insight-note">latest proof set with successful payment + invoke status</p>
          </article>
          <article className="insight-card">
            <p className="metric-label">network footprint</p>
            <p className="insight-value">{snapshot.network}</p>
            <p className="insight-note">active chain context for all listed contracts and operations</p>
          </article>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">market telemetry</h2>
          <p className="section-sub">pricing pressure, route monetization, and proof reliability</p>
        </div>
        <div className="graphs-grid">
          <article className="graph-card">
            <h3>price ladder (top paid ops)</h3>
            <div className="spark-bars" role="img" aria-label="price ladder of paid operations">
              {(priceLadderBars.length > 0
                ? priceLadderBars
                : [{ id: "price-ladder-empty", height: 8, label: "no paid operations" }]
              ).map((bar) => (
                <span key={bar.id} style={{ height: `${bar.height}%` }} title={bar.label} />
              ))}
            </div>
            <p className="insight-note">higher bars indicate higher stroop pricing among currently paid routes</p>
          </article>
          <article className="graph-card">
            <h3>paid route density</h3>
            <div className="spark-bars" role="img" aria-label="density of paid and free routes">
              {(routeDensityBars.length > 0
                ? routeDensityBars
                : [{ id: "route-density-empty", height: 8, label: "no operations" }]
              ).map((bar) => (
                <span key={bar.id} style={{ height: `${bar.height}%` }} title={bar.label} />
              ))}
            </div>
            <p className="insight-note">paid routes render high to separate monetized paths from free endpoints</p>
          </article>
          <article className="graph-card">
            <h3>proof health trend</h3>
            <div className="spark-line" role="img" aria-label="proof success trend over latest snapshots">
              {(proofHealthLine.length > 0
                ? proofHealthLine
                : [{ id: "proof-health-empty", height: 14, label: "no proofs yet" }]
              ).map((point) => (
                <span key={point.id} style={{ height: `${point.height}%` }} title={point.label} />
              ))}
            </div>
            <p className="insight-note">line rises where payment challenge and invoke status both pass</p>
          </article>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">contract explorer</h2>
          <p className="section-sub">top contracts by paid operations</p>
        </div>
        <div className="resource-table-wrap surface-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>contract id</th>
                <th>paid ops</th>
                <th>price range</th>
                <th>quick links</th>
              </tr>
            </thead>
            <tbody>
              {topContracts.map((contract) => {
                return (
                  <tr key={contract.contractId}>
                    <td>{shorten(contract.contractId, 10)}</td>
                    <td>{contract.paidOperations.toLocaleString()}</td>
                    <td>
                      {contract.paidOperations > 0
                        ? `${formatStroops(contract.minPriceStroops)} to ${formatStroops(contract.maxPriceStroops)}`
                        : "-"}
                    </td>
                    <td>
                      <div className="inline-links">
                        <Link href={`/contracts/${encodeURIComponent(contract.contractId)}`}>details</Link>
                        {contract.contractExplorerUrl ? (
                          <a href={contract.contractExplorerUrl} target="_blank" rel="noreferrer">
                            explorer
                          </a>
                        ) : (
                          <span className="muted">explorer -</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">operation explorer</h2>
          <p className="section-sub">compact paid-route inventory</p>
        </div>
        <div className="resource-table-wrap surface-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>method</th>
                <th>path</th>
                <th>payment</th>
                <th>price</th>
                <th>schema</th>
              </tr>
            </thead>
            <tbody>
              {topOperations.map((operation) => {
                return (
                  <tr key={operation.id}>
                    <td>{operation.method}</td>
                    <td>{operation.path}</td>
                    <td>{operation.paymentRequired ? "required" : "free"}</td>
                    <td>{formatStroops(operation.priceStroops)}</td>
                    <td>
                      <a href={discoveryLinks.openapi} target="_blank" rel="noreferrer">
                        openapi
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
