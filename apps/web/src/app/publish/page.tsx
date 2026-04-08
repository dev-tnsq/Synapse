import Link from "next/link";
import { bazaarLinks, discoveryLinks, gatewayBaseUrl } from "@/lib/gateway";

export default function PublishPage() {
  return (
    <main className="page-shell reveal-in">
      <section className="hero-lite surface-earth">
        <div>
          <p className="eyebrow">publish</p>
          <h1>publish a contract operation and verify one paid invocation end to end</h1>
          <p>
            use this workflow for deterministic setup: register contract metadata,
            validate discovery visibility, and confirm where paid call funds settle.
          </p>
        </div>
      </section>

      <section className="surface-card architecture-board surface-sky">
        <div className="section-head">
          <h2 className="section-title">setup checklist</h2>
          <p className="section-sub">checkpoint cards before sharing any paid route with clients</p>
        </div>
        <div className="checkpoint-grid">
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 01</p>
            <h3>payout routing</h3>
            <p>set GATEWAY_PAY_TO_ADDRESS to the seller-controlled payout address before starting the gateway.</p>
          </article>
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 02</p>
            <h3>network and defaults</h3>
            <p>confirm gateway startup uses the intended network and payment defaults visible in manifest.</p>
          </article>
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 03</p>
            <h3>settlement source of truth</h3>
            <p>publishers receive settlement to discovery payment defaults payToAddress unless reconfigured and restarted.</p>
          </article>
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 04</p>
            <h3>listing sequence</h3>
            <p>deploy contract, generate abi, then register contract via /api/v1/contracts/register.</p>
          </article>
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 05</p>
            <h3>discovery visibility</h3>
            <p>verify manifest, contracts, operations, and openapi discovery endpoints before sharing with clients.</p>
          </article>
          <article className="checkpoint-card">
            <p className="checkpoint-label">checkpoint 06</p>
            <h3>proof readiness</h3>
            <p>execute one paid invocation and verify proof output for deterministic evidence.</p>
          </article>
        </div>
        <div className="link-cluster">
          <a href={discoveryLinks.manifest} target="_blank" rel="noreferrer">
            manifest endpoint
          </a>
          <Link href="/status">status page</Link>
          <Link href="/contracts">contracts page</Link>
        </div>
      </section>

      <section className="surface-card payout-architecture surface-earth">
        <div className="section-head">
          <h2 className="section-title">publisher payout flow</h2>
          <p className="section-sub">deterministic paid route timeline with settlement evidence</p>
        </div>
        <div className="arch-rail" aria-hidden="true">
          <span className="arch-rail-pulse" />
        </div>
        <ol className="arch-timeline payout-timeline">
          <li className="arch-step">
            <div className="arch-step-index">1</div>
            <div className="arch-step-body">
              <h3>402 challenge</h3>
              <p>first paid invocation returns 402 challenge for the selected route.</p>
            </div>
          </li>
          <li className="arch-step">
            <div className="arch-step-index">2</div>
            <div className="arch-step-body">
              <h3>external payment</h3>
              <p>payer completes external payment and retries with payment-signature header.</p>
            </div>
          </li>
          <li className="arch-step">
            <div className="arch-step-index">3</div>
            <div className="arch-step-body">
              <h3>verification and settlement</h3>
              <p>gateway verifies payment proof and settles to payTo destination.</p>
            </div>
          </li>
          <li className="arch-step">
            <div className="arch-step-index">4</div>
            <div className="arch-step-body">
              <h3>contract execution</h3>
              <p>gateway executes contract operation after verification succeeds.</p>
            </div>
          </li>
          <li className="arch-step">
            <div className="arch-step-index">5</div>
            <div className="arch-step-body">
              <h3>proof and tx evidence</h3>
              <p>proof and transaction evidence appear in discovery proofs and status surfaces.</p>
            </div>
          </li>
        </ol>
        <p className="callout-warning">idempotency warning: after a 402 challenge, use a new idempotency-key for the paid retry.</p>
      </section>

      <section className="card-grid two-up">
        <article className="surface-card stagger-card">
          <h2>quick start: register contract</h2>
          <div className="command-stack">
            <pre className="command-block">{`curl -i -X POST "${gatewayBaseUrl}/api/v1/contracts/register" \\
  -H "content-type: application/json" \\
  -d @payload.json`}</pre>
          </div>
        </article>

        <article className="surface-card stagger-card">
          <h2>api call: request paid challenge</h2>
          <div className="command-stack">
            <pre className="command-block">{`curl -i -X POST "${gatewayBaseUrl}/replace-with-operation-path" \\
  -H "idempotency-key: challenge-$(date +%s)" \\
  -H "content-type: application/json" \\
  -d '{}'`}</pre>
          </div>
        </article>

        <article className="surface-card stagger-card">
          <h2>api call: paid retry with proof signature</h2>
          <div className="command-stack">
            <pre className="command-block">{`curl -i -X POST "${gatewayBaseUrl}/replace-with-operation-path" \\
  -H "idempotency-key: paid-retry-$(date +%s)" \\
  -H "payment-signature: <x402-payment-signature>" \\
  -H "content-type: application/json" \\
  -d '{}'`}</pre>
          </div>
        </article>

        <article className="surface-card stagger-card">
          <h2>api call: verify discovery proofs</h2>
          <div className="command-stack">
            <pre className="command-block">{`curl -sS "${discoveryLinks.proofs}" | jq '.proofs[0]'`}</pre>
            <pre className="command-block">{`curl -sS "${discoveryLinks.operations}" | jq '.operations[0]'`}</pre>
          </div>
        </article>
      </section>

      <section className="surface-card">
        <h2>discovery and gateway links</h2>
        <div className="inline-links">
          <a href={discoveryLinks.contracts} target="_blank" rel="noreferrer">
            contracts endpoint
          </a>
          <a href={discoveryLinks.operations} target="_blank" rel="noreferrer">
            operations endpoint
          </a>
          <a href={discoveryLinks.openapi} target="_blank" rel="noreferrer">
            openapi
          </a>
          <a href={bazaarLinks.docs} target="_blank" rel="noreferrer">
            docs
          </a>
          <a href={bazaarLinks.testnetDiscovery} target="_blank" rel="noreferrer">
            testnet discovery
          </a>
          <a href={bazaarLinks.cdpDiscovery} target="_blank" rel="noreferrer">
            cdp discovery
          </a>
          <Link href="/status">open /status</Link>
        </div>
      </section>
    </main>
  );
}
