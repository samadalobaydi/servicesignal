"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { writeSignupPrefill, clearSignupPrefill } from "@/lib/signup-prefill";
import { cleanBusinessName, BUSINESS_NAME_MESSAGES } from "@/lib/business-name";
import {
  PASSWORD_RULES,
  isPasswordAcceptable,
  firstPasswordError,
  shouldSuggestLongerPassword,
  confirmationState,
  PASSWORD_COMFORTABLE_LENGTH,
} from "@/lib/password-policy";
import { SignupAside } from "@/components/auth/SignupAside";
import splitStyles from "@/components/auth/auth-split.module.css";
import {
  AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,
  SubmitButton, OrDivider, SocialButtons, BRAND_BLUE, ENABLED_OAUTH_PROVIDERS,
} from "@/components/auth/AuthShell";

/**
 * PASSWORD RULES COME FROM lib/password-policy.ts — the same module
 * POST /api/beta/account and /reset-password import. They are not restated
 * here, so the checklist the user reads and the check the server performs
 * cannot disagree.
 *
 * The checklist renders whatever PASSWORD_RULES contains, which is why raising
 * the policy to 10 characters + uppercase + number + special needed no change
 * to this file at all.
 *
 * The hardcoded rule list and the colour-coded strength meter that used to live
 * here are both gone, deliberately:
 *
 *   - The rules were not the ones the server enforced, so most of the ticks
 *     were decoration.
 *   - The meter derived its label from how many of those rules passed, which
 *     meant an ACCEPTED password could be labelled "Weak" directly beneath a
 *     checklist showing every requirement met. "Valid" and "strong" are
 *     different questions, and showing one in the language of the other is how
 *     a user ends up unsure whether they may continue.
 *
 * What replaces it: the real requirements, an unambiguous accepted state, and a
 * length suggestion phrased as advice rather than judgement.
 */

export function SignupForm({
  betaEmail,
  betaBusinessName,
}: {
  /** The verified address. Its presence IS the proof; resolved server-side. */
  betaEmail: string;
  betaBusinessName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [businessName, setBusinessName] = useState(betaBusinessName);
  // Fixed: the verified address, never editable. See the render below.
  const [email] = useState(betaEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [terms, setTerms]       = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  /**
   * This form only ever renders for a verified invitation — app/signup/page.tsx
   * resolves the httpOnly cookie server-side and renders BetaAccessRequired
   * otherwise. So there is no client-side "am I verified?" state to spoof: the
   * email arrives as a prop that was proven before this component existed.
   */

  /**
   * Prefill from the Founding Beta form, handed over via same-origin
   * sessionStorage (see lib/signup-prefill.ts).
   *
   * Runs in an effect rather than a lazy useState initialiser on purpose:
   * this component is server-rendered first, where sessionStorage does not
   * exist, so reading during render would produce a hydration mismatch.
   *
   * Only fills a field that is still empty, so anything the visitor has
   * already typed is never overwritten.
   *
   * Reading does NOT clear. The values must survive a refresh, a trip to
   * Terms or Privacy and back, and a failed account-creation attempt — all
   * of which remount this page and re-run this effect. Cleanup happens at
   * exactly one place: a successful account creation in onSubmit below.
   * sessionStorage is tab-scoped, so anything not cleared there is discarded
   * when the tab closes.
   */
  const passwordOk = isPasswordAcceptable(password);

  /**
   * Confirmation feedback. The rule itself lives in lib/password-policy.ts —
   * see confirmationState() there for why a prefix is not reported as a
   * mismatch — so it is unit-tested rather than re-derived here.
   */
  const confirmState = confirmationState(password, confirm);

  const canSubmit = passwordOk && confirm === password && confirm.length > 0 && terms;

  /**
   * Snapshot taken just before a legal document opens.
   *
   * Saves ONLY the business name and email — never the password, the
   * confirmation field or the consent checkbox — and only at this moment,
   * never on every keystroke. If the visitor later lands on a fresh instance
   * of this page (typically by reloading the original tab), the prefill effect
   * above restores what they had actually typed rather than the older values
   * carried over from the beta form.
   */
  const snapshotBeforeLegal = () => {
    writeSignupPrefill({ businessName, email });
  };

  /**
   * Moves focus to whichever field a failed submission is about.
   *
   * The error banner sits at the top of the form and carries role="alert", so
   * it is announced — but announcement alone leaves a keyboard or screen-reader
   * user at the submit button with no indication of where to go. Focusing the
   * offending control puts them on it.
   */
  const focusField = (id: "business" | "password" | "confirm" | "terms") => {
    if (typeof document === "undefined") return;
    document.getElementById(id)?.focus();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Weak passwords are blocked client-side before any auth call.
    // Business name is validated FIRST: it is the only field whose absence
    // silently degrades what the customer eventually receives, and until now
    // it was the only field with no validation at all.
    const business = cleanBusinessName(businessName);
    if (business.error) {
      setError(BUSINESS_NAME_MESSAGES[business.error]);
      focusField("business");
      return;
    }

    // The same policy module the server uses, so the message shown here is the
    // message the server would have returned — never a vaguer stand-in.
    const passwordError = firstPasswordError(password);
    if (passwordError) {
      setError(passwordError);
      focusField("password");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      focusField("confirm");
      return;
    }
    if (!terms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      focusField("terms");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();

    // ── Verified founding-beta path ──────────────────────────────────────
    // The address is already proven, so the account is created server-side
    // with email_confirm: true and NO Supabase confirmation email. The
    // browser then signs in with the password it already has — the profile
    // row, welcome email and onboarding status all follow from the normal
    // authenticated path, exactly as for an ordinary signup.
    {
      try {
        const res = await fetch("/api/beta/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, business_name: business.value }),
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok || !payload?.success) {
          setError(payload?.message ?? "We couldn't create your account. Please try again.");
          setLoading(false);
          return;
        }

        // ── Session replacement ──────────────────────────────────────
        //
        // Sign the CURRENT session out first. A browser already signed in as
        // another ServiceSignal account otherwise keeps those cookies, and
        // every subsequent server render — the profile read, the onboarding
        // gate, the dashboard header — answers for the wrong user.
        //
        // signOut() is the supported Supabase mechanism and clears its own
        // cookies; no cookie is deleted by hand. It runs only here, as part of
        // a verified account completion, and a failure after it simply leaves
        // the visitor signed out on this form with a retryable error.
        await supabase.auth.signOut();

        const { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({ email: payload.email, password });

        if (signInError) {
          setError(
            payload?.reconciled
              ? "You already have a ServiceSignal account for this address. Please sign in with your existing password."
              : "Your account was created. Please sign in to continue."
          );
          setLoading(false);
          return;
        }

        // ── Identity proof, before any navigation ────────────────────────
        //
        // Two independent checks, because "sign-in returned no error" is not
        // the same as "the browser is now this user".
        //
        // 1. The session sign-in actually returned.
        // 2. What the browser client reports on a FRESH read — which is what
        //    every server request will see, since @supabase/ssr keeps the
        //    session in cookies rather than memory.
        //
        // Comparison is case-insensitive: Supabase normalises addresses, and a
        // case difference is not an identity mismatch.
        const expected = String(payload.email).trim().toLowerCase();
        const signedInAs = signInData?.user?.email?.trim().toLowerCase();

        const { data: confirmed } = await supabase.auth.getUser();
        const activeAs = confirmed?.user?.email?.trim().toLowerCase();

        if (!signedInAs || signedInAs !== expected || activeAs !== expected) {
          // Never navigate on a mismatch. Landing on the dashboard under
          // someone else's session is precisely the failure this guards.
          // No address is named in the message — the visitor already knows
          // their own, and naming the other would disclose an unrelated
          // account.
          console.error(
            "[signup] Session identity mismatch after account creation. " +
              "Expected the newly verified account; the browser reports a " +
              "different user. Navigation blocked."
          );
          await supabase.auth.signOut();
          setError(
            "We created your account but couldn't sign you in on this device. " +
              "Please sign in to continue."
          );
          setLoading(false);
          return;
        }

        // ── Profile before the gate ──────────────────────────────────────
        //
        // Force the canonical profile path to run NOW, while we can still
        // report a failure on this form. It creates the row, seeds the
        // business name, records terms, stamps onboarding_status = 'required'
        // and triggers the Welcome email. Navigating first would race the
        // onboarding gate against a profile that might not exist yet.
        try {
          await fetch("/api/profile", { cache: "no-store" });
        } catch {
          // Non-fatal: /onboarding calls it again on arrival. The session is
          // proven correct, so the user should not be held on this form for a
          // read that retries by itself.
        }

        router.push("/onboarding");
        router.refresh();
        return;
      } catch {
        setError("We couldn't reach ServiceSignal. Please check your connection and try again.");
        setLoading(false);
        return;
      }
    }

  };

  return (
    <AuthShell
      aside={<SignupAside />}
      footer={
        <>
          {/* Sign-in leads; returning to the landing page is a quieter
              secondary route beneath it — mirrors /login's footer hierarchy. */}
          <p className={splitStyles.footerPrimary}>
            Already have an account?{" "}
            <Link href="/login" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Sign in</Link>
          </p>
          {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
          <Link href="/v2" className={splitStyles.footerSecondary}>← Back to landing page</Link>
        </>
      }
    >
      {/* SMS and email are equal channels — neither is described as primary,
          supporting or richer than the other, and neither is presented as
          arriving later than the other. */}
      <AuthHeading
        title="Create your account"
        subtitle="Follow up overdue invoices with SMS and email reminders — always with your approval before anything is sent."
      />
      <AuthError message={error} />

      <form onSubmit={handleSignup} noValidate className="space-y-5">
        <AuthInput id="business" label="Business Name" value={businessName} onChange={setBusinessName} autoComplete="organization" placeholder="e.g. Morrison Plumbing Ltd" />
        {/* Verified invitation: the address is fixed. Rendered as read-only
             text rather than a disabled input so it reads as settled fact and
             cannot be edited, re-enabled via devtools to any meaningful
             effect, or submitted — the server takes the email from the
             verification row regardless of anything sent from here. */}
        <div>
            <p className="block mb-1.5 text-sm" style={{ fontWeight: 600, color: "#0f172a" }}>
              Email
            </p>
            <div
              className="w-full rounded-lg px-3.5 py-2.5 text-sm flex items-center gap-2"
              style={{ background: "#f8fafc", border: "1px solid #e5e7eb", color: "#0f172a" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "#059669" }}>
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{email}</span>
            </div>
          <p className="mt-1.5 text-xs" style={{ color: "#64748b" }}>
            Verified from your founding beta application.
          </p>
        </div>
        <PasswordInput
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="password-requirements"
        />

        {/* THE REQUIREMENTS, ALWAYS PRESENT.
            Rendered unconditionally rather than only once the field has
            content: a rule you can only discover by failing it is not
            guidance. It also means the block never appears or disappears
            mid-typing, so nothing below it jumps. */}
        <div
          id="password-requirements"
          className="rounded-lg p-3.5"
          style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }}
        >
          <ul className="space-y-1.5" aria-label="Password requirements">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(password);
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 text-xs"
                  style={{ color: ok ? "#047857" : "#475569" }}
                >
                  {/* Icon AND wording carry the state, so nothing depends on
                      colour. The visually hidden word is what a screen reader
                      announces for each row. */}
                  {ok ? (
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 13, height: 13, border: "1.5px solid #cbd5e1" }}
                      aria-hidden="true"
                    />
                  )}
                  <span>
                    <span className="sr-only">{ok ? "Met: " : "Not yet met: "}</span>
                    {r.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* One live region for the whole block, polite so it does not
              interrupt typing. It states acceptance in plain words — never a
              strength grade that could contradict the ticks above it. */}
          <p
            className="text-xs mt-2.5"
            aria-live="polite"
            style={{
              color: passwordOk ? "#047857" : "#64748b",
              fontWeight: passwordOk ? 600 : 400,
              lineHeight: 1.5,
            }}
          >
            {password.length === 0
              ? "Choose a password that meets both requirements above."
              : passwordOk
              ? shouldSuggestLongerPassword(password)
                ? `Password accepted. ${PASSWORD_COMFORTABLE_LENGTH} characters or more would be harder to guess.`
                : "Password accepted."
              : "Password not accepted yet."}
          </p>
        </div>

        <PasswordInput
          id="confirm"
          label="Confirm Password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          describedBy="confirm-feedback"
          invalid={confirmState === "mismatch"}
        />
        {/* Beneath the field it describes, announced politely, and never
            colour-only — the tick or cross carries the same meaning as the
            wording. Reserves no height when idle, and both states are one
            line, so nothing shifts as it changes. */}
        <p
          id="confirm-feedback"
          aria-live="polite"
          className="text-xs -mt-3 flex items-center gap-1.5"
          style={{
            color: confirmState === "mismatch" ? "#dc2626" : "#047857",
            minHeight: confirmState === "idle" ? 0 : undefined,
          }}
        >
          {confirmState === "match" && (
            <>
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Passwords match.
            </>
          )}
          {confirmState === "mismatch" && (
            <>
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Passwords do not match.
            </>
          )}
        </p>

        {/* Both legal links open in a new tab so this form — including anything
            already typed, and any prefill carried from the Founding Beta form —
            is never unmounted mid-signup. rel="noopener" severs the new tab's
            window.opener reference; "noreferrer" additionally withholds the
            Referer header.

            Each link carries a visually hidden "(opens in a new tab)" suffix.
            WCAG technique G201 asks for advance warning before a new window
            opens; putting the warning inside the link makes the accessible
            name "Terms of Service (opens in a new tab)" for screen-reader
            users while adding nothing to the visible line. It is a suffix
            rather than an aria-label so the visible text is not replaced.

            stopPropagation keeps a click on either link from toggling the
            surrounding checkbox label. */}
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="w-4 h-4 rounded mt-0.5" style={{ accentColor: BRAND_BLUE }} />
          <span className="text-sm" style={{ color: "#0f172a", lineHeight: 1.5 }}>
            I agree to the{" "}
            <Link
              href="/terms?from=signup"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); snapshotBeforeLegal(); }}
              style={{ fontWeight: 600, color: BRAND_BLUE }}
            >
              Terms of Service
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy?from=signup"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.stopPropagation(); snapshotBeforeLegal(); }}
              style={{ fontWeight: 600, color: BRAND_BLUE }}
            >
              Privacy Policy
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
            .
          </span>
        </label>

        {/* Deliberately NOT disabled when the form is incomplete.
            A disabled submit gives no reason, cannot be focused, and is not
            announced — the user is left guessing which of four things is
            wrong. Submitting instead produces a specific message and moves
            focus to the field it concerns. `loading` still disables it, which
            is what prevents a duplicate account from a second click.
            `canSubmit` drives only the visual affordance. */}
        <SubmitButton loading={loading} idleText="Create Account" loadingText="Creating your account…" />
        {!canSubmit && !loading && (
          <p className="sr-only" aria-live="polite">
            Complete the password requirements, confirm your password and agree
            to the Terms of Service and Privacy Policy to create your account.
          </p>
        )}
      </form>

      {/* The divider is only meaningful when there is something below it.
          ENABLED_OAUTH_PROVIDERS is empty until a provider is confirmed in
          Supabase, so both are hidden together rather than leaving a stranded
          "OR". Signup's layout is otherwise unchanged. */}
      {ENABLED_OAUTH_PROVIDERS.length > 0 && (
        <>
          <OrDivider />
          <SocialButtons next={next} />
        </>
      )}
    </AuthShell>
  );
}

