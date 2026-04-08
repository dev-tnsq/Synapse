import Link from "next/link";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/contracts", label: "Contracts" },
  { href: "/explorer", label: "Operations" },
  { href: "/status", label: "Health" },
] as const;

export function TopNav() {
  return (
    <aside className="left-rail" aria-label="primary navigation">
      <div className="rail-brand">
        <Link href="/" className="top-brand" aria-label="synapse home">
          <span className="brand-icon" aria-hidden="true" />
          <span>
            synapse
            <small>stellar mcp gateway</small>
          </span>
        </Link>
      </div>

      <div>
        <p className="rail-section-label">navigation</p>
        <nav className="rail-links" aria-label="route links">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="rail-link">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="rail-quick" aria-label="quick actions">
        <Link href="/explorer" className="top-control" aria-label="search operations">
          search
        </Link>
        <Link href="/status" className="top-control" aria-label="check health">
          health
        </Link>
      </div>

      <div className="rail-cta-stack">
        <Link href="/contracts" className="rail-cta">
          open contracts
        </Link>
        <Link href="/explorer" className="rail-cta">
          open operations
        </Link>
      </div>

      <div className="rail-bottom-spacer" aria-hidden="true" />
    </aside>
  );
}
