import Link from "next/link";
import styles from "./verify.module.css";

export const metadata = { title: "Verify your email — ServiceSignal" };

// Reflects a just-set cookie, so it must never be statically rendered.
export const dynamic = "force-dynamic";

/**
 * The state shown after clicking "Verify your email".
 *
 * /api/beta/verify does the work — validating the token, recording the
 * verification and moving the token into an httpOnly cookie — then redirects
 * here with only a coarse state word. This page therefore contains no token
 * logic and no secrets; it renders one of four outcomes.
 *
 * The wordmark is the current lockup and every link stays inside this journey.
 * Nothing here returns to the original landing page.
 */

type State = "ok" | "expired" | "used" | "invalid";

const STATES: Record<State, { title: string; body: string; cta?: { href: string; label: string } }> = {
  ok: {
    title: "Email verified",
    body: "Finish setting up your account to continue.",
    cta: { href: "/signup", label: "Create your account" },
  },
  used: {
    // Deliberately not phrased as an error. The overwhelmingly common cause is
    // someone clicking the link a second time after finishing.
    title: "This link has already been used",
    body: "Your ServiceSignal account has already been created with this link. You can sign in to continue.",
    cta: { href: "/login", label: "Sign in" },
  },
  expired: {
    title: "This link has expired",
    body: "Verification links are valid for 48 hours. Email support@servicesignal.app and we'll send you a new one.",
  },
  invalid: {
    // Same wording as expired would be misleading; same LACK of detail is
    // deliberate, so this page can never be used to probe which tokens exist.
    title: "We couldn't verify this link",
    body: "The link may be incomplete or may have been replaced by a newer one. Check you opened the most recent email from us, or contact support@servicesignal.app.",
  },
};

function readState(value: string | string[] | undefined): State {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "ok" || raw === "expired" || raw === "used" ? raw : "invalid";
}

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { state?: string | string[] };
}) {
  const state = readState(searchParams.state);
  const view = STATES[state];

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        {/* Same lockup as the emails and onboarding: transparent mark plus live
            text. The wordmark is not a link — this journey has no "back to the
            landing page" step, and offering one here invites the user out of
            an account they are part-way through creating. */}
        <span className={styles.lockup}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/servicesignal-mark.png" alt="" className={styles.mark} />
          <span className={styles.word}>
            Service<span className={styles.wordB}>Signal</span>
          </span>
        </span>

        <span
          className={state === "ok" ? styles.iconOk : styles.iconNeutral}
          aria-hidden="true"
        >
          {state === "ok" ? "✓" : "!"}
        </span>

        <h1 className={styles.title}>{view.title}</h1>
        <p className={styles.body}>{view.body}</p>

        {view.cta && (
          <Link href={view.cta.href} className={styles.primary}>
            {view.cta.label}
          </Link>
        )}
      </div>
    </main>
  );
}
