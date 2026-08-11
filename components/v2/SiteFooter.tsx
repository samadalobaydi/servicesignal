import Link from "next/link";
import { LEGAL_CONFIG } from "@/lib/legal";

/**
 * Minimal footer. Continues the navy of the founding beta section above it, so
 * the two read as one closing block.
 *
 * Deliberately omitted: social icons, product/company/resource columns, a
 * newsletter form, and any link that leads nowhere.
 *
 * The contact address comes from LEGAL_CONFIG.supportEmail — one monitored
 * mailbox for support, account, beta-access and privacy correspondence, and
 * the same address the legal pages and every ServiceSignal email use.
 */
export default function SiteFooter() {
  return (
    <footer className="v2-foot">
      <div className="v2-section v2-foot-grid">
        <div className="v2-foot-brand">
          <span className="v2-foot-lockup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/servicesignal-mark.png" alt="" className="v2-foot-mark" />
            <span className="v2-foot-word">
              Service<span className="v2-foot-word-b">Signal</span>
            </span>
          </span>
          <p className="v2-foot-line">
            ServiceSignal helps UK trades prepare professional invoice reminders
            they review before sending.
          </p>
        </div>

        <nav className="v2-foot-links" aria-label="Footer">
          <Link href="/privacy?from=landing" className="v2-foot-link">Privacy</Link>
          <Link href="/terms?from=landing" className="v2-foot-link">Terms</Link>
          <Link href="/login" className="v2-foot-link">Sign in</Link>
          <a href={`mailto:${LEGAL_CONFIG.supportEmail}`} className="v2-foot-link">
            {LEGAL_CONFIG.supportEmail}
          </a>
        </nav>
      </div>

      <div className="v2-section v2-foot-base">
        <p className="v2-foot-copy">© 2026 ServiceSignal</p>
      </div>
    </footer>
  );
}
