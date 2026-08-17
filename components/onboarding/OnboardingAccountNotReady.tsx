import Link from "next/link";
import styles from "./onboarding.module.css";

/**
 * Shown at /onboarding when there IS a session but no verified context.
 *
 * ── WHAT THIS REPLACED, AND WHY IT WAS WRONG ─────────────────────────────
 *
 * The page used to answer this case with `redirect("/login?next=/onboarding")`.
 * That looks reasonable and is a silent loop:
 *
 *   1. /onboarding redirects to /login
 *   2. middleware.ts sees a session cookie and redirects any signed-in visitor
 *      away from /login to /dashboard — the `next` parameter is discarded
 *   3. the customer arrives on an empty Overview having asked for setup, with
 *      nothing said about why
 *
 * The symptom is indistinguishable from "onboarding is not wired up at all",
 * which is exactly the confusion that cost a Preview cycle.
 *
 * ── WHY THE CAUSE IS NARROW ──────────────────────────────────────────────
 *
 * middleware's matcher already covers /onboarding and redirects when there is
 * no user, so a user always exists by the time the page component runs. The
 * only remaining way getVerifiedContext() returns null is the confirmation
 * check in lib/onboarding.ts — `if (!user.email_confirmed_at) return null` —
 * or a transient failure of getUser() itself.
 *
 * The copy therefore hedges deliberately. "Usually means" is true of both, and
 * this screen must not assert a specific fact about an account whose identity
 * we have just failed to establish. It states no onboarding status, because no
 * status was read; the status vocabulary and its semantics are untouched.
 *
 * INERT, like OnboardingUnavailable: no form, no invoice creation, no skip
 * control. The one action is a link the customer chooses to follow, which is
 * the difference between an explanation and a bounce.
 */
export function OnboardingAccountNotReady() {
  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <span className={styles.lockup}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/servicesignal-mark.png" alt="" className={styles.mark} />
            <span className={styles.word}>
              Service<span className={styles.wordB}>Signal</span>
            </span>
          </span>
        </header>

        <h1 className={styles.title}>We couldn&rsquo;t open setup for this account</h1>
        <p className={styles.sub}>
          We weren&rsquo;t able to confirm your account just now. This usually means the
          email address on it hasn&rsquo;t been confirmed yet. Nothing on your account has
          changed, and your dashboard works normally — you can add invoices and review
          reminders there.
        </p>

        <div className={styles.actions}>
          <Link href="/dashboard" className={styles.primary}>
            Go to my dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
