"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { getAuthCallbackUrl } from "@/lib/app-urls";
import { updateProfile } from "@/lib/profile";
import {
  AuthShell, AuthHeading, AuthError, AuthInput, PasswordInput,
  SubmitButton, OrDivider, SocialButtons, BRAND_BLUE,
} from "@/components/auth/AuthShell";

// ── Live password rules ────────────────────────────────────────────────
const RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: "len",     label: "Minimum 8 characters", test: (p) => p.length >= 8 },
  { id: "upper",   label: "Uppercase letter",     test: (p) => /[A-Z]/.test(p) },
  { id: "lower",   label: "Lowercase letter",     test: (p) => /[a-z]/.test(p) },
  { id: "number",  label: "Number",               test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "Special character",    test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH = [
  { label: "Weak",      color: "#dc2626" },
  { label: "Weak",      color: "#dc2626" },
  { label: "Fair",      color: "#d97706" },
  { label: "Good",      color: "#eab308" },
  { label: "Strong",    color: "#059669" },
  { label: "Excellent", color: "#059669" },
];

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [businessName, setBusinessName] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [terms, setTerms]       = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  const passed = RULES.filter((r) => r.test(password)).length;
  const allRulesPass = passed === RULES.length;
  const strength = STRENGTH[passed];

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Weak passwords are blocked client-side before any auth call.
    if (!allRulesPass) {
      setError("Please choose a stronger password — all requirements must be met.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!terms) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();

    // Unchanged auth call from the previous version, plus a durable
    // acceptance signal. terms_accepted travels in user_metadata, which
    // Supabase's own auth server stores on auth.users immediately — even
    // when email confirmation is required and no session exists yet. The
    // actual version numbers and timestamp are NOT trusted from the
    // client: app/api/profile/route.ts reads its own LEGAL_CONFIG
    // constants and the database's own now() when it durably persists
    // this to the profiles row.
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: getAuthCallbackUrl(),
        data: { terms_accepted: true },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is disabled in Supabase, session is created immediately
    if (data.session) {
      // Save the business name via the EXISTING profile endpoint.
      // Bug found and fixed during this audit: this previously called
      // fetch(..., { method: "PATCH" }) directly, but app/api/profile's
      // update handler is PUT, not PATCH — lib/profile.ts's own
      // updateProfile() already uses the correct method; this now reuses
      // it instead of a second, inconsistent ad-hoc call.
      if (businessName.trim()) {
        try {
          await updateProfile({ business_name: businessName.trim() });
        } catch {
          // Non-fatal — the user can set it in Settings.
        }
      }
      router.push(next);
      router.refresh();
      return;
    }

    // Email confirmation is enabled — tell the user to check inbox
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <AuthShell>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: "#ecfdf5", border: "2px solid #059669" }}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>Check your inbox</h1>
          <p className="text-sm mt-2" style={{ color: "#64748b", lineHeight: 1.6 }}>
            We&apos;ve sent a confirmation link to <span style={{ fontWeight: 600, color: "#0f172a" }}>{email}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Link href="/login" className="inline-block mt-6 text-sm" style={{ color: BRAND_BLUE, fontWeight: 600 }}>
            Go to sign in →
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={
        <>
          <Link href="/" className="text-sm inline-block" style={{ color: "#64748b" }}>← Back to landing page</Link>
          <p className="text-sm" style={{ color: "#64748b" }}>
            Already have an account?{" "}
            <Link href="/login" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Sign in →</Link>
          </p>
        </>
      }
    >
      <AuthHeading title="Create your account" subtitle="Start chasing unpaid invoices automatically in minutes." />
      <AuthError message={error} />

      <form onSubmit={handleSignup} noValidate className="space-y-5">
        <AuthInput id="business" label="Business Name" value={businessName} onChange={setBusinessName} autoComplete="organization" placeholder="e.g. Morrison Plumbing Ltd" />
        <AuthInput id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />
        <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" />

        {/* Live requirements + strength */}
        {password.length > 0 && (
          <div className="rounded-lg p-3.5" style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }}>
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#e5e7eb" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(passed / RULES.length) * 100}%`, background: strength.color }} />
              </div>
              <span className="text-xs whitespace-nowrap" style={{ color: strength.color, fontWeight: 650 }}>{strength.label}</span>
            </div>
            <ul className="space-y-1" aria-label="Password requirements">
              {RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs" style={{ color: ok ? "#059669" : "#64748b" }}>
                    {ok ? (
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <span className="w-3 h-3 rounded-full inline-block" style={{ border: "1.5px solid #cbd5e1" }} aria-hidden="true" />
                    )}
                    {r.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <PasswordInput id="confirm" label="Confirm Password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {confirm.length > 0 && password !== confirm && (
          <p className="text-xs -mt-3" style={{ color: "#dc2626" }}>Passwords do not match yet.</p>
        )}

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="w-4 h-4 rounded mt-0.5" style={{ accentColor: BRAND_BLUE }} />
          <span className="text-sm" style={{ color: "#0f172a", lineHeight: 1.5 }}>
            I agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 600, color: BRAND_BLUE }}
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 600, color: BRAND_BLUE }}
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <SubmitButton loading={loading} idleText="Create Account" loadingText="Creating your account…" />
      </form>

      <OrDivider />
      <SocialButtons next={next} />
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
