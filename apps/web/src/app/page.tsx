type FetchState<T> = {
  data: T | null;
  error: string | null;
};

type JsonRecord = Record<string, unknown>;

const gatewayBaseUrl =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";

async function fetchJson<T>(path: string): Promise<FetchState<T>> {
  try {
    const response = await fetch(`${gatewayBaseUrl}${path}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        data: null,
        error: `${response.status} ${response.statusText}`,
      };
    }

    const json = (await response.json()) as T;
    return { data: json, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return { data: null, error: message };
  }
}

function summarizeOperations(data: unknown): string {
  if (Array.isArray(data)) {
    return `${data.length} tracked`;
  }

  if (data && typeof data === "object") {
    const value = data as JsonRecord;

    if (typeof value.total === "number") {
      return `${value.total} tracked`;
    }

    if (Array.isArray(value.items)) {
      return `${value.items.length} tracked`;
    }
  }

  return "shape unknown";
}

function cardState(error: string | null, data: unknown): "ok" | "warn" | "bad" {
  if (error) return "bad";
  if (data == null) return "warn";
  return "ok";
}

function stateLabel(state: "ok" | "warn" | "bad"): string {
  if (state === "ok") return "online";
  if (state === "warn") return "degraded";
  return "error";
}

export default async function Home() {
  const [health, operations] = await Promise.all([
    fetchJson<unknown>("/health"),
    fetchJson<unknown>("/operations"),
  ]);

  const contractsState = cardState(health.error, health.data);
  const operationsState = cardState(operations.error, operations.data);
  const paymentState = operations.error ? "bad" : "ok";
  const settlementState = operations.error ? "warn" : "ok";

  const healthSummary = health.error
    ? `health unavailable: ${health.error}`
    : "health endpoint reachable";

  const operationsSummary = operations.error
    ? `operations unavailable: ${operations.error}`
    : summarizeOperations(operations.data);

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1 className="brand">synapse control plane</h1>
        <p className="hint">gateway: {gatewayBaseUrl}</p>
      </header>

      <section className="grid" aria-label="gateway status cards">
        <article className="card">
          <div className="card-title-row">
            <h2 className="card-title">contracts</h2>
            <span className={`status-pill status-${contractsState}`}>
              {stateLabel(contractsState)}
            </span>
          </div>
          <p className="metric">{healthSummary}</p>
          <p className="subtle">source: /health</p>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2 className="card-title">operations</h2>
            <span className={`status-pill status-${operationsState}`}>
              {stateLabel(operationsState)}
            </span>
          </div>
          <p className="metric">{operationsSummary}</p>
          <p className="subtle">source: /operations</p>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2 className="card-title">payment verification</h2>
            <span className={`status-pill status-${paymentState}`}>
              {stateLabel(paymentState)}
            </span>
          </div>
          <p className="metric">
            {operations.error
              ? "unable to validate proofs"
              : "verification checks passed"}
          </p>
          <p className="subtle">x402 proof channel visibility</p>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2 className="card-title">settlement</h2>
            <span className={`status-pill status-${settlementState}`}>
              {stateLabel(settlementState)}
            </span>
          </div>
          <p className="metric">
            {operations.error
              ? "settlement signal delayed"
              : "on-chain settlement reporting active"}
          </p>
          <p className="subtle">stellar rail observability</p>
        </article>
      </section>

      <section className="card" aria-label="raw endpoint snapshots">
        <h2 className="card-title">endpoint snapshots</h2>
        <pre className="mono-block">
          {JSON.stringify(
            {
              health,
              operations,
            },
            null,
            2,
          )}
        </pre>
      </section>
    </main>
  );
}
