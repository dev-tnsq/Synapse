import Link from "next/link";
import {
  bazaarLinks,
  discoveryLinks,
  fetchGatewaySnapshot,
  formatGeneratedAt,
  formatStroops,
  shorten,
} from "@/lib/gateway";

export default async function AgentPage() {
  const snapshot = await fetchGatewaySnapshot();
  const operations = snapshot.operations.data?.operations ?? snapshot.manifest.data?.operations ?? [];
  const proofs = snapshot.proofs.data?.proofs ?? [];

  const freeOperation = operations.find((operation) => !operation.paymentRequired) ?? null;
  const paidOperation =
    [...operations]
      .filter((operation) => operation.paymentRequired)
      .sort((left, right) => right.priceStroops - left.priceStroops)[0] ?? null;

  const freeCommand = freeOperation
    ? `curl -sS "${discoveryLinks.health}"\n# then invoke free endpoint\ncurl -sS "${snapshot.network === "unknown" ? "http://localhost:8787" : discoveryLinks.health.replace("/health", "")}${freeOperation.path}"`
    : "# no free operations discovered yet\ncurl -sS \"http://localhost:8787/api/v1/discovery/operations\"";

    const paidCommand = paidOperation
      ? [
          `# 1) request challenge for paid endpoint`,
          `curl -i -X ${paidOperation.method} \\\n  -H "idempotency-key: <challenge-key>" \\\n  "${snapshot.network === "unknown" ? "http://localhost:8787" : discoveryLinks.health.replace("/health", "")}${paidOperation.path}"`,
          "",
          "# 2) pay challenge and retry with payment-signature + new idempotency key",
          "# use a fresh key because 402 response is stored under the challenge key",
          `curl -sS -X ${paidOperation.method} \\\n  -H "idempotency-key: <paid-retry-key>" \\\n  -H "payment-signature: <encoded-payment-signature>" \\\n  "${snapshot.network === "unknown" ? "http://localhost:8787" : discoveryLinks.health.replace("/health", "")}${paidOperation.path}"`,
          "",
          "# 3) verify latest receipt in discovery proofs",
          `curl -sS "${discoveryLinks.proofs}"`,
        ].join("\n")
      : "# no paid operations discovered yet\ncurl -sS \"http://localhost:8787/api/v1/discovery/operations\"";

  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-sky">
        <div>
          <p className="eyebrow">agent runbook</p>
          <h1>from discovery to paid invocation proof in one workflow</h1>
          <p>
            follow the sequence for autonomous callers: discover route, request challenge,
            attach payment proof, invoke, and verify receipt.
          </p>
        </div>
        <dl className="stats-grid compact">
          <div>
            <dt>network</dt>
            <dd>{snapshot.network}</dd>
          </div>
          <div>
            <dt>generated</dt>
            <dd>{formatGeneratedAt(snapshot.generatedAt)}</dd>
          </div>
          <div>
            <dt>operations</dt>
            <dd>{operations.length}</dd>
          </div>
          <div>
            <dt>proofs</dt>
            <dd>{proofs.length}</dd>
          </div>
        </dl>
      </section>

      {snapshot.inlineErrors.length > 0 ? (
        <section className="surface-card">
          <p className="error-note">{snapshot.inlineErrors.join(" | ")}</p>
        </section>
      ) : null}

      <section className="card-grid two-up">
        <article className="surface-card surface-cloud">
          <div className="card-headline">
            <h2>quick start: free call</h2>
            <span className="badge free">no payment</span>
          </div>
          <p className="muted">
            {freeOperation
              ? `${freeOperation.method} ${freeOperation.path}`
              : "waiting for a free operation to be indexed"}
          </p>
          <pre className="command-block">{freeCommand}</pre>
        </article>

        <article className="surface-card surface-earth">
          <div className="card-headline">
            <h2>api calls: paid flow</h2>
            <span className="badge paid">x402 payment</span>
          </div>
          <p className="muted">
            {paidOperation
              ? `${paidOperation.method} ${paidOperation.path} · ${formatStroops(paidOperation.priceStroops)}`
              : "waiting for a paid operation to be indexed"}
          </p>
          <pre className="command-block">{paidCommand}</pre>
        </article>
      </section>

      <section className="surface-card">
        <h2>api links</h2>
        <div className="inline-links">
          <a href={bazaarLinks.docs} target="_blank" rel="noreferrer">
            gateway docs
          </a>
          <a href={bazaarLinks.testnetDiscovery} target="_blank" rel="noreferrer">
            testnet discovery
          </a>
          <a href={bazaarLinks.cdpDiscovery} target="_blank" rel="noreferrer">
            cdp discovery
          </a>
          <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
            manifest
          </a>
          <a href={discoveryLinks.operations} target="_blank" rel="noreferrer">
            operations
          </a>
          <a href={discoveryLinks.proofs} target="_blank" rel="noreferrer">
            proofs
          </a>
          <a href={discoveryLinks.openapi} target="_blank" rel="noreferrer">
            openapi
          </a>
          <Link href="/status">open status board</Link>
        </div>
        <p className="muted">cache discovery results with short ttl and paginate operations to keep agent loops fast.</p>
      </section>

      <section className="surface-card">
        <h2>latest proof sample</h2>
        {proofs.length > 0 ? (
          <ul className="clean-list">
            {proofs.slice(0, 3).map((proof) => (
              <li key={proof.file}>
                <strong>{proof.file}</strong>
                <span className="muted">
                  {" "}
                  tx: {proof.txHash ? shorten(proof.txHash, 10) : "pending"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">no proof files reported yet.</p>
        )}
      </section>
    </main>
  );
}