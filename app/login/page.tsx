"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readSignupPrefill } from "@/lib/signup-prefill";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,
  SubmitButton, BRAND_BLUE,
} from "@/components/auth/AuthShell";
import splitStyles from "@/components/auth/auth-split.module.css";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const callbackError = searchParams.get("auth_error");

  // ── PREFILLED FROM THE ADDRESS THEY JUST TYPED ────────────────────────
  //
  // The reused-email state on the landing page sends people here, and asking
  // for an address they entered ten seconds ago is the "don't ask twice" rule
  // this product is built on.
  //
  // Read from the EXISTING same-origin sessionStorage mechanism that already
  // carries this value to /signup — deliberately NOT `/login?email=...`, which
  // would put a customer's address into browser history, referrer headers,
  // server access logs and analytics.
  //
  // ── WHY THIS IS NOT A LAZY useState INITIALISER ───────────────────────
  //
  // /login is PRERENDERED (`○ /login` in the build output), so its HTML is
  // generated once at build time with no sessionStorage in scope. A lazy
  // initialiser would return "" on the server and the stored address on the
  // client, so the very first client render would disagree with the served
  // markup about this input's `value` — a hydration mismatch, guaranteed
  // rather than merely possible, because prerendered HTML can never contain
  // the value.
  //
  // Deterministic "" on both sides, then filled after mount. The effect runs
  // only in the browser and only once, so the server HTML and the first client
  // render are identical by construction.
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  // Populated AFTER hydration — see the note on `email` above. Empty deps: a
  // one-shot read at mount. It never clobbers typing, because nothing can have
  // been typed before the first effect runs.
  useEffect(() => {
    const stored = readSignupPrefill()?.email;
    if (stored) setEmail(stored);
  }, []);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(callbackError);

  // Unchanged from the previous version — same auth call, same redirect.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowser();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  };

  return (
    /*
     * FOCUSED, not split.
     *
     * The navy panel that stood here explained what ServiceSignal does and
     * showed an example approval queue. That belongs on /signup, where someone
     * is deciding whether to start. A returning customer has already decided;
     * re-pitching the product to them on the way in is noise, so it has been
     * removed rather than rewritten, and nothing promotional replaces it.
     *
     * `focused` renders the SAME form column on its own — same lockup, same
     * typography, same inputs, same button — so this page is simpler than
     * signup without becoming a different visual language. Deliberately not
     * the centred-card layout, which is a bordered box with a 40px shadow.
     */
    <AuthShell
      focused
      footer={
        <>
          {/* Account creation leads; returning to the landing page is a quieter
              secondary route beneath it. */}
          <p className={splitStyles.footerPrimary}>
            New to ServiceSignal?{" "}
            {/* Points at the founding-beta form, not /signup. During the beta an
                account can only be created through a verified invitation, so
                sending someone to /signup would land them on the "access
                required" state — a dead end dressed as a call to action.
                The ?next= forwarding is gone with it: it only ever mattered
                for a public signup path, which does not exist right now. */}
            <Link href="/#access" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Join the founding beta</Link>
          </p>
          {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
          <Link href="/" className={splitStyles.footerSecondary}>← Back to landing page</Link>
        </>
      }
    >
      <AuthHeading title="Welcome back" subtitle="Sign in to review your reminders and manage your invoices." />
      <AuthError message={error} />

      <form onSubmit={handleLogin} noValidate className="space-y-5">
        <AuthInput id="email" label="Email Address" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />

        <PasswordInput
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          labelRight={
            <Link href="/forgot-password" className="text-sm" style={{ color: BRAND_BLUE, fontWeight: 500 }}>
              Forgot your password?
            </Link>
          }
        />

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: BRAND_BLUE }}
          />
          <span className="text-sm" style={{ color: "#0f172a" }}>Keep me signed in</span>
        </label>

        <SubmitButton loading={loading} idleText="Sign In" loadingText="Signing in…" />
      </form>

    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
