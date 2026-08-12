"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,
  SubmitButton, BRAND_BLUE,
} from "@/components/auth/AuthShell";
import { LoginAside } from "@/components/auth/LoginAside";
import splitStyles from "@/components/auth/auth-split.module.css";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const callbackError = searchParams.get("auth_error");

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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
    <AuthShell
      aside={<LoginAside />}
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
