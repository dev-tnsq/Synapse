import Link from "next/link";
import { fetchGatewaySnapshot, formatStroops, shorten } from "@/lib/gateway";

export default async function ContractsPage() {
  const snapshot = await fetchGatewaySnapshot();
  const contracts = snapshot.contracts.data?.contracts ?? snapshot.manifest.data?.contracts ?? [];
  const paidTotal = contracts.reduce((sum, contract) => sum + contract.paidOperations, 0);
  const freeTotal = contracts.reduce((sum, contract) => sum + contract.freeOperations, 0);

  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-earth">
        <div>
          <p className="eyebrow">contracts / registry</p>
          <h1>published contracts available for paid invocation discovery</h1>
          <p>
            each listing keeps the paid versus free operation mix, price band, and direct explorer links
            in one scan.
          </p>
        </div>
        <div className="hero-chip-row">
          <p className="hero-chip">{contracts.length} contracts indexed</p>
          <p className="hero-chip">{paidTotal} paid ops</p>
          <p className="hero-chip">{freeTotal} free ops</p>
        </div>
      </section>

      <section className="card-grid two-up">
        {contracts.map((contract) => (
          <article key={contract.contractId} className="surface-card stagger-card">
            <div className="card-headline">
              <h2>{shorten(contract.contractId, 10)}</h2>
              <span className="badge paid">{contract.paidOperations} paid</span>
            </div>
            <p className="muted">{contract.freeOperations} free operations</p>
            <p className="muted">
              price band: {formatStroops(contract.minPriceStroops)} to {formatStroops(contract.maxPriceStroops)}
            </p>
            <div className="inline-links">
              <Link href={`/contracts/${encodeURIComponent(contract.contractId)}`}>details</Link>
              {contract.contractExplorerUrl ? (
                <a href={contract.contractExplorerUrl} target="_blank" rel="noreferrer">
                  stellar explorer
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
