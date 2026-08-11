import Link from "next/link";
import type { OnboardingStatus } from "@/lib/onboarding";
import styles from "./onboarding.module.css";

/**
 * Shown at /onboarding to someone who has nothing to do here.
 *
 * A page rather than a redirect. Someone who typed this URL or followed an old
 * link asked a question — "is my setup finished?" — and bouncing them silently
 * to the dashboard answers it only by implication. This says yes, and offers
 * the way on.
 *
 * The two states are worded differently on purpose. `completed` describes
 * something the user did. `exempt` covers accounts that predate the flow
 * entirely, and telling those users they "completed setup" would be a small
 * untruth about their own history.
 */
export function OnboardingAllSet({ status }: { status: OnboardingStatus | null }) {
  const finished = status === "completed";

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

        <h1 className={styles.title}>
          {finished ? "You're all set" : "Your account is ready"}
        </h1>
        <p className={styles.sub}>
          {finished
            ? "You've finished setting up ServiceSignal. Your invoices and prepared reminders are on your dashboard."
            : "There's nothing to set up on this account. Your invoices and prepared reminders are on your dashboard."}
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
