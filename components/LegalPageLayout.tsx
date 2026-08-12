import Link from "next/link";
import { resolveLegalReturn } from "@/lib/legal";
import { LegalCloseTabControl } from "./LegalCloseTabControl";

export interface LegalSection {
  id: string;
  label: string;
}

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  version: string;
  /** Raw `?from=` value. Resolved against a closed allow-list — never a URL. */
  from?: string | string[];
  /** Section anchors for the desktop contents column. */
  sections?: readonly LegalSection[];
  children: React.ReactNode;
}

/**
 * Shared chrome for /terms and /privacy.
 *
 * One shell for both documents so they cannot drift apart, and so the
 * contextual return link is managed in a single place. The pages themselves
 * contain nothing but their own prose and section list — no legal wording,
 * section order, effective date or version number lives here.
 *
 * A white document page rather than a tinted background with a floating card:
 * the header and body share one surface, so it reads as a single document.
 * The contents column is plain anchor links — no JavaScript, no scroll-spy.
 */
export default function LegalPageLayout({
  title,
  effectiveDate,
  version,
  from,
  sections,
  children,
}: LegalPageLayoutProps) {
  const back = resolveLegalReturn(from);
  const hasContents = Boolean(sections && sections.length > 0);

  // Every context except signup is an ordinary in-tab link. Signup opened this
  // page in its own tab, so it gets the close control instead — the one client
  // component on these pages.
  const backLink = back.closeTab ? (
    <LegalCloseTabControl fallbackHref={back.href} />
  ) : (
    <Link href={back.href} className="v2-legal-back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M10 19l-7-7m0 0l7-7m-7 7h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {back.label}
    </Link>
  );

  return (
    <main className="v2-root v2-legal">
      <header className="v2-legal-bar">
        <div className="v2-legal-bar-in">
          {/* REVIEW BRANCH: the wordmark always points at the /v2 preview,
              independent of ?from=. Change back to "/" when v2 becomes the
              root landing page. */}
          <Link href="/" className="v2-legal-lockup" aria-label="ServiceSignal home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/servicesignal-mark.png" alt="" className="v2-legal-mark" />
            <span className="v2-legal-word">
              Service<span className="v2-legal-word-b">Signal</span>
            </span>
          </Link>
          {backLink}
        </div>
      </header>

      <div className="v2-legal-page">
        <div className="v2-legal-head">
          <h1 className="v2-legal-title">{title}</h1>
          <p className="v2-legal-meta">
            Version {version}
            <span className="v2-legal-dot" aria-hidden="true">·</span>
            Effective {effectiveDate}
            <span className="v2-legal-dot" aria-hidden="true">·</span>
            Founding beta
          </p>
        </div>

        <div className={`v2-legal-body${hasContents ? " has-toc" : ""}`}>
          {hasContents && (
            <nav className="v2-legal-toc" aria-labelledby="toc-heading">
              <p id="toc-heading" className="v2-legal-toc-h">On this page</p>
              <ul>
                {sections!.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="v2-legal-toc-l">{s.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <article className="v2-legal-prose">{children}</article>
        </div>

        <div className="v2-legal-foot">{backLink}</div>
      </div>
    </main>
  );
}
