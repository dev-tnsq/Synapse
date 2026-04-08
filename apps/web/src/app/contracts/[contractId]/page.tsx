import Link from "next/link";
import {
  discoveryLinks,
  fetchGatewaySnapshot,
  formatGeneratedAt,
  formatStroops,
  gatewayBaseUrl,
  shorten,
} from "@/lib/gateway";

type MaybePromise<T> = T | Promise<T>;

type ContractDetailProps = {
  params: MaybePromise<{ contractId: string }>;
};

function buildCurl(method: "GET" | "POST", path: string): string {
  const base = `curl -i -X ${method} \"${gatewayBaseUrl}${path}\" -H \"idempotency-key: demo-${Date.now()}\"`;
  if (method === "POST") {
    return `${base} -H \"content-type: application/json\" -d '{}'`;
  }

  return base;
}

export default async function ContractDetailPage({ params }: ContractDetailProps) {
  const { contractId: rawContractId } = await params;
  const contractId = decodeURIComponent(rawContractId);
  const snapshot = await fetchGatewaySnapshot();

  const contracts = snapshot.contracts.data?.contracts ?? snapshot.manifest.data?.contracts ?? [];
  const operations = snapshot.operations.data?.operations ?? snapshot.manifest.data?.operations ?? [];
  const proofs = snapshot.proofs.data?.proofs ?? [];

  const contract = contracts.find((item) => item.contractId === contractId);
  const relatedOperations = operations.filter((operation) => operation.contractId === contractId);

  if (!contract) {
    return (
      <main className="page-shell reveal-in">
        <section className="surface-card">
          <h1>contract not found</h1>
          <p>the requested contract id does not exist in the current discovery snapshot.</p>
          <Link href="/contracts">return to contracts</Link>
        </section>
      </main>
    );
  }

  const paymentConfig = relatedOperations[0]?.payment ?? snapshot.manifest.data?.paymentDefaults;

  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-cloud">
        <div>
          <p className="eyebrow">contracts / detail</p>
          <h1>{shorten(contract.contractId, 14)} overview</h1>
          <p>
            payment profile, operation inventory, and proof links for this contract surface.
          </p>
        </div>
        <div className="stats-grid">
          <div>
            <dt>paid operations</dt>
            <dd>{contract.paidOperations}</dd>
          </div>
          <div>
            <dt>free operations</dt>
            <dd>{contract.freeOperations}</dd>
          </div>
          <div>
            <dt>recent proofs</dt>
            <dd>{proofs.length}</dd>
          </div>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <h2 className="section-title">payment</h2>
          <p className="section-sub">x402 challenge and settlement defaults</p>
        </div>
        <dl className="stats-grid compact">
          <div>
            <dt>pay to</dt>
            <dd>{paymentConfig?.payToAddress ?? "-"}</dd>
          </div>
          <div>
            <dt>challenge ttl</dt>
            <dd>{snapshot.manifest.data?.paymentDefaults.challengeTtlSeconds ?? "-"}s</dd>
          </div>
          <div>
            <dt>network passphrase</dt>
            <dd>{paymentConfig?.networkPassphrase ?? "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <h2 className="section-title">operations</h2>
          <p className="section-sub">callable functions and quick curl commands</p>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>operation</th>
                <th>path</th>
                <th>payment</th>
                <th>price</th>
                <th>quick curl</th>
              </tr>
            </thead>
            <tbody>
              {relatedOperations.map((operation) => (
                <tr key={operation.id}>
                  <td>{operation.functionName}</td>
                  <td>{operation.path}</td>
                  <td>
                    <span className={operation.paymentRequired ? "badge paid" : "badge free"}>
                      {operation.paymentRequired ? "paid" : "free"}
                    </span>
                  </td>
                  <td>{formatStroops(operation.priceStroops)}</td>
                  <td>
                    <pre className="command-block">{buildCurl(operation.method, operation.path)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-head">
          <h2 className="section-title">links</h2>
          <p className="section-sub">discovery feeds and proof visibility</p>
        </div>
        <div className="inline-links">
          <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
            manifest
          </a>
          <a href={discoveryLinks.contracts} target="_blank" rel="noreferrer">
            contracts
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
          {contract.contractExplorerUrl ? (
            <a href={contract.contractExplorerUrl} target="_blank" rel="noreferrer">
              contract explorer
            </a>
          ) : null}
        </div>
        {proofs.length > 0 ? (
          <p className="muted">
            latest proof: {proofs[0].file} at {formatGeneratedAt(proofs[0].generatedAt)} ({shorten(proofs[0].txHash ?? "n/a", 9)})
          </p>
        ) : (
          <p className="muted">no proof artifacts were returned by the gateway.</p>
        )}
      </section>
    </main>
  );
}
