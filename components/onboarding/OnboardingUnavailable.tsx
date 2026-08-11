import Link from "next/link";
import styles from "./onboarding.module.css";

/**
 * Shown at /onboarding when onboarding state cannot be read or written.
 *
 * Covers three causes that are identical from the user's side — migration not
 * applied, unexpected database failure, and a stored status outside the
 * approved vocabulary — and are kept apart in the server logs, where the
 * distinction is actionable. Nothing here reveals which: a visitor should
 * never learn that a column is missing or that their row is malformed.
 *
 * DELIBERATELY INERT. No form, no invoice creation, no reminder preparation,
 * no skip control. The whole point is that the flow's last act — recording
 * completion — cannot succeed right now, so asking the user to type a real
 * invoice first would waste their work and then refuse to bank it.
 *
 * It also makes no all-set claim. "You're all set" would be a statement about
 * a status we just failed to read.
 */
export function OnboardingUnavailable() {
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

        <h1 className={styles.title}>Setup isn&rsquo;t available right now</h1>
        <p className={styles.sub}>
          We can&rsquo;t open guided setup at the moment. Nothing on your account has
          changed, and your dashboard is working normally — you can add invoices and
          review reminders there as usual. Please try setup again a little later.
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
