import Link from "next/link";
import {
  discoveryLinks,
  fetchGatewaySnapshot,
  formatGeneratedAt,
  formatStroops,
  shorten,
} from "@/lib/gateway";

type SearchParams = Record<string, string | string[] | undefined>;

type ExplorerPageProps = {
  searchParams?: SearchParams | Promise<SearchParams>;
};

export default async function ExplorerPage({ searchParams }: ExplorerPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const queryParam = resolvedParams.q;
  const query = (Array.isArray(queryParam) ? queryParam[0] : queryParam ?? "")
    .toLowerCase()
    .trim();

  const snapshot = await fetchGatewaySnapshot();
  const operations = snapshot.operations.data?.operations ?? snapshot.manifest.data?.operations ?? [];

  const filtered = operations.filter((operation) => {
    if (!query) {
      return true;
    }

    return (
      operation.id.toLowerCase().includes(query) ||
      operation.path.toLowerCase().includes(query) ||
      operation.functionName.toLowerCase().includes(query) ||
      operation.contractId.toLowerCase().includes(query)
    );
  });

  const hasInlineErrors = snapshot.inlineErrors.length > 0;

  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-cloud">
        <div>
          <p className="eyebrow">operations / index</p>
          <h1>query operations across paid and free routes</h1>
          <p>
            search by operation id, path, function, or contract id and inspect payment posture in one
            table-centric view.
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
            <dt>results</dt>
            <dd>{filtered.length}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-card">
        <form method="GET" className="search-row" action="/explorer" aria-label="operations filter">
          <label htmlFor="explorer-query">search</label>
          <input
            id="explorer-query"
            name="q"
            defaultValue={query}
            placeholder="find by function, path, contract, id"
          />
          <button type="submit">find</button>
        </form>

        <div className="hero-chip-row">
          <p className="hero-chip">showing {filtered.length} routes</p>
          <p className="hero-chip">generated {formatGeneratedAt(snapshot.generatedAt)}</p>
        </div>

        {filtered.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>operation</th>
                  <th>method</th>
                  <th>path</th>
                  <th>payment</th>
                  <th>price</th>
                  <th>contract</th>
                  <th>links</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((operation) => (
                  <tr key={operation.id} className="stagger-row">
                    <td title={operation.id}>{shorten(operation.id, 10)}</td>
                    <td>{operation.method}</td>
                    <td>{operation.path}</td>
                    <td>
                      <span className={operation.paymentRequired ? "badge paid" : "badge free"}>
                        {operation.paymentRequired ? "paid" : "free"}
                      </span>
                    </td>
                    <td>{formatStroops(operation.priceStroops)}</td>
                    <td>
                      <Link href={`/contracts/${encodeURIComponent(operation.contractId)}`}>
                        {shorten(operation.contractId, 8)}
                      </Link>
                    </td>
                    <td>
                      <div className="inline-links">
                        <a href={discoveryLinks.openapi} target="_blank" rel="noreferrer">
                          openapi
                        </a>
                        <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
                          manifest
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="explorer-empty-state">
            <p className="eyebrow">empty result set</p>
            <h2>no operations match this filter</h2>
            <p>
              try clearing the query or publish a contract route first so discovery can index
              operations for this workspace.
            </p>
            <div className="explorer-empty-actions">
              <Link href="/explorer">clear filter</Link>
              <Link href="/publish">go publish</Link>
              <Link href="/status">open status</Link>
              <a href={discoveryLinks.operations} target="_blank" rel="noreferrer">
                operations endpoint
              </a>
            </div>
          </div>
        )}
      </section>

      {hasInlineErrors && filtered.length === 0 ? (
        <section className="surface-card surface-earth">
          <h2>setup hint</h2>
          <p>
            the gateway returned errors and no operation rows are available. publish a contract first, then recheck
            status to confirm discovery endpoints are healthy.
          </p>
          <div className="link-cluster">
            <Link href="/publish">open publish</Link>
            <Link href="/status">open status</Link>
            <a href={discoveryLinks.operations} target="_blank" rel="noreferrer">
              operations endpoint
            </a>
            <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
              manifest endpoint
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
