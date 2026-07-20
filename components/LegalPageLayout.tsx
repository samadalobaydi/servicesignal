import Link from "next/link";
import Image from "next/image";

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  version: string;
  children: React.ReactNode;
}

/**
 * Shared chrome for /terms and /privacy — reuses the existing .lp-* landing
 * design system (no new CSS introduced) so these pages read as part of the
 * same product, not a bolted-on legal template.
 */
export default function LegalPageLayout({ title, effectiveDate, version, children }: LegalPageLayoutProps) {
  return (
    <main className="lp-root">
      <div style={{ borderBottom: "1px solid #e5e7eb", background: "#ffffff" }}>
        <div className="lp-section flex items-center justify-between" style={{ paddingTop: "1.25rem", paddingBottom: "1.25rem" }}>
          <Link href="/signup" aria-label="ServiceSignal — back to sign up" style={{ textDecoration: "none" }}>
            <Image
              src="/branding/servicesignal-legal-logo.png"
              alt="ServiceSignal"
              width={2048}
              height={826}
              priority
              style={{ width: 168, maxWidth: "40vw", height: "auto", display: "block" }}
            />
          </Link>
          <Link href="/signup" className="lp-btn-ghost" style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem" }}>
            ← Back to sign up
          </Link>
        </div>
      </div>

      <div className="lp-section" style={{ paddingTop: "3rem", paddingBottom: "5rem", maxWidth: 780 }}>
        <span className="lp-eyebrow">Beta — MVP legal document</span>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, marginTop: "1rem", marginBottom: "0.5rem", letterSpacing: "-0.02em" }}>
          {title}
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.95rem", marginBottom: "2.5rem" }}>
          Effective {effectiveDate} · Version {version}
        </p>

        <div
          className="lp-card legal-prose"
          style={{ padding: "2.5rem", lineHeight: 1.7, color: "#1e293b", fontSize: "0.95rem" }}
        >
          {children}
        </div>

        <div style={{ marginTop: "2.5rem", textAlign: "center" }}>
          <Link href="/signup" className="lp-btn-ghost" style={{ padding: "0.7rem 1.5rem" }}>
            ← Back to sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
