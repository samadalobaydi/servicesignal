"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { getResetPasswordRedirectUrl } from "@/lib/app-urls";
import { AuthShell, AuthHeading, AuthError, AuthInput, SubmitButton, BRAND_BLUE } from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [sent, setSent]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowser();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      // Recovery links use the same PKCE flow as OAuth: Supabase appends
      // ?code=... which must be exchanged for a session before updateUser()
      // can change the password. Route through the existing /auth/callback
      // (built for OAuth) so it does that exchange, then forwards on to
      // /reset-password. Without this hop, a fresh link fails with a
      // misleading "expired" error because no session was ever established.
      redirectTo: getResetPasswordRedirectUrl(),
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  };

  /*
   * FOCUSED, like /login.
   *
   * Both states previously fell through to AuthShell's centred-card branch,
   * which renders the oversized servicesignal-auth-logo.png — a stacked lockup
   * carrying the retired "AUTOMATED INVOICE CHASING FOR UK BUSINESSES" tagline
   * — above a bordered, shadowed box. Beside the new sign-in page that read as
   * a different product.
   *
   * `focused` is the mode built for /login: the same small mark-plus-wordmark
   * lockup, the same ~460px measure, no card. Reused rather than reimplemented,
   * so these three pages cannot drift apart, and /login is untouched.
   *
   * Left-aligned, not centred. The success state used `text-center`, which sat
   * a centred block under a left-aligned lockup. Nothing else about it changed:
   * same icon, same copy, same destination.
   */
  if (sent) {
    return (
      <AuthShell
        focused
        footer={
          <p className="text-sm" style={{ color: "#64748b" }}>
            <Link href="/login" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Back to sign in →</Link>
          </p>
        }
      >
        <div>
          <div className="w-14 h-14 rounded-full mb-5 flex items-center justify-center" style={{ background: "#ecfdf5", border: "2px solid #059669" }}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          {/* Matches AuthHeading's scale so "Check your inbox" and "Reset your
              password" are the same size — they are alternate states of one
              page. AuthHeading itself is not used here because this subtitle
              contains the address as markup, and its `subtitle` prop is a
              string. */}
          <h1 style={{ fontSize: "1.55rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>Check your inbox</h1>
          <p className="text-sm mt-1.5" style={{ color: "#64748b", lineHeight: 1.55 }}>
            If an account exists for <span style={{ fontWeight: 600, color: "#0f172a" }}>{email}</span>,
            we&apos;ve sent a link to reset your password.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      focused
      footer={
        <p className="text-sm" style={{ color: "#64748b" }}>
          Remembered it?{" "}
          <Link href="/login" style={{ color: BRAND_BLUE, fontWeight: 600 }}>Back to sign in →</Link>
        </p>
      }
    >
      <AuthHeading
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a secure link to set a new password."
      />
      <AuthError message={error} />
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <AuthInput id="email" label="Email Address" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />
        <SubmitButton loading={loading} idleText="Send Reset Link" loadingText="Sending…" />
      </form>
    </AuthShell>
  );
}
