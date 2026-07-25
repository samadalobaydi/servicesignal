"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { AuthShell, AuthHeading, AuthError, PasswordInput, SubmitButton, BRAND_BLUE } from "@/components/auth/AuthShell";

const RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: "len",     label: "Minimum 8 characters", test: (p) => p.length >= 8 },
  { id: "upper",   label: "Uppercase letter",     test: (p) => /[A-Z]/.test(p) },
  { id: "lower",   label: "Lowercase letter",     test: (p) => /[a-z]/.test(p) },
  { id: "number",  label: "Number",               test: (p) => /[0-9]/.test(p) },
  { id: "special", label: "Special character",    test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("auth_error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(callbackError);
  const [done, setDone]         = useState(false);

  const allRulesPass = RULES.every((r) => r.test(password));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!allRulesPass) {
      setError("Please choose a stronger password — all requirements must be met.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();
    // The recovery link signs the user in temporarily; updateUser sets the new password.
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(
        updateError.message.toLowerCase().includes("session")
          ? "This reset link has expired or already been used. Please request a new one."
          : updateError.message
      );
      setLoading(false);
      return;
    }

    // The password is changed, but the recovery link's session is still a
    // real, valid Supabase session — middleware would treat the user as
    // logged in and send /login straight to /dashboard. Sign it out
    // explicitly so "Go to sign in" leads to an actual sign-in, using the
    // password just set.
    await supabase.auth.signOut();

    setDone(true);
    setLoading(false);
  };

  if (done) {
    return (
      <AuthShell>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: "#ecfdf5", border: "2px solid #059669" }}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>Password updated</h1>
          <p className="text-sm mt-2" style={{ color: "#64748b", lineHeight: 1.6 }}>
            Your password has been changed successfully. You can now sign in with your new password.
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
        <p className="text-sm" style={{ color: "#64748b" }}>
          Link expired?{" "}
          <Link href="/forgot-password" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Request a new one →</Link>
        </p>
      }
    >
      <AuthHeading title="Choose a new password" subtitle="Set a strong password for your ServiceSignal account." />
      <AuthError message={error} />
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <PasswordInput id="password" label="New Password" value={password} onChange={setPassword} autoComplete="new-password" />

        {password.length > 0 && (
          <ul className="rounded-lg p-3.5 space-y-1" style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }} aria-label="Password requirements">
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
        )}

        <PasswordInput id="confirm" label="Confirm New Password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {confirm.length > 0 && password !== confirm && (
          <p className="text-xs -mt-3" style={{ color: "#dc2626" }}>Passwords do not match yet.</p>
        )}

        <SubmitButton loading={loading} idleText="Update Password" loadingText="Updating…" />
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
