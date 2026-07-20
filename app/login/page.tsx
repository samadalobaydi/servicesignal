"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,
  SubmitButton, OrDivider, SocialButtons, BRAND_BLUE,
} from "@/components/auth/AuthShell";

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
      footer={
        <>
          <Link href="/" className="text-sm inline-block" style={{ color: "#64748b" }}>← Back to landing page</Link>
          <p className="text-sm" style={{ color: "#64748b" }}>
            Don&apos;t have an account?{" "}
            <Link href={next !== "/dashboard" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} style={{ color: BRAND_BLUE, fontWeight: 600 }}>Create one →</Link>
          </p>
        </>
      }
    >
      <AuthHeading title="Welcome back" subtitle="Sign in to manage your invoices, reminders and payments." />
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

      <OrDivider />
      <SocialButtons next={next} />
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
