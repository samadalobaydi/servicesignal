import Link from "next/link";

/**
 * Minimal footer. Continues the navy of the founding beta section above it, so
 * the two read as one closing block.
 *
 * Deliberately omitted: social icons, product/company/resource columns, a
 * newsletter form, and any link that leads nowhere.
 *
 * A contact email is also omitted for now. lib/legal.ts annotates
 * support@ and privacy@servicesignal.app as conventions rather than confirmed
 * inboxes, and the hello@servicesignal.co.uk address used by the v1 footer is
 * on a different domain from the verified sending domain. Pending Sam
 * confirming a monitored address, nothing is guessed here.
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
            ServiceSignal helps UK trades follow up overdue invoices with
            professional email reminders they approve before sending.
          </p>
        </div>

        <nav className="v2-foot-links" aria-label="Footer">
          <Link href="/privacy" className="v2-foot-link">Privacy</Link>
          <Link href="/terms" className="v2-foot-link">Terms</Link>
          <Link href="/login" className="v2-foot-link">Sign in</Link>
        </nav>
      </div>

      <div className="v2-section v2-foot-base">
        <p className="v2-foot-copy">© 2026 ServiceSignal</p>
      </div>
    </footer>
  );
}
