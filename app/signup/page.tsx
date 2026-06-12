"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowser();

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // If email confirmation is disabled in Supabase, session is created immediately
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    // Email confirmation is enabled — tell the user to check inbox
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "linear-gradient(180deg, #05080f 0%, #0a0e1a 100%)" }}
      >
        <div className="w-full max-w-md text-center">
          <div
            className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center"
            style={{ background: "rgba(0,230,118,0.1)", border: "2px solid #00e676" }}
          >
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                stroke="#00e676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="font-display text-white mb-2" style={{ fontSize: "1.6rem", fontWeight: 800 }}>
            CHECK YOUR EMAIL
          </h2>
          <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click it to activate your account, then sign in.
          </p>
          <Link href="/login" className="btn-primary inline-block">
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 bg-grid"
      style={{ background: "linear-gradient(180deg, #05080f 0%, #0a0e1a 100%)" }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded bg-[#00c8ff] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 13H2L8 1Z" fill="#0a0e1a" />
              <circle cx="8" cy="10" r="1.5" fill="#00c8ff" />
            </svg>
          </div>
          <span
            className="font-display text-white text-xl"
            style={{ fontWeight: 800, letterSpacing: "0.04em" }}
          >
            SERVICE<span style={{ color: "#00c8ff" }}>SIGNAL</span>
          </span>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "#0f1628",
            border: "1px solid rgba(0,200,255,0.12)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <h1
            className="font-display text-white mb-1"
            style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "0.02em" }}
          >
            CREATE ACCOUNT
          </h1>
          <p className="text-sm mb-6" style={{ color: "#64748b" }}>
            Set up your ServiceSignal account.
          </p>

          <form onSubmit={handleSignup} noValidate className="space-y-4">
            <div>
              <label
                className="block text-xs mb-1.5 font-display uppercase tracking-wider"
                style={{ color: "#64748b", fontWeight: 600, letterSpacing: "0.08em" }}
              >
                Email Address
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label
                className="block text-xs mb-1.5 font-display uppercase tracking-wider"
                style={{ color: "#64748b", fontWeight: 600, letterSpacing: "0.08em" }}
              >
                Password
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div>
              <label
                className="block text-xs mb-1.5 font-display uppercase tracking-wider"
                style={{ color: "#64748b", fontWeight: 600, letterSpacing: "0.08em" }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="Repeat your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{
                  background: "rgba(255,107,107,0.08)",
                  border: "1px solid rgba(255,107,107,0.2)",
                  color: "#ff6b6b",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: "#475569" }}>
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-display font-600 transition-colors"
              style={{ color: "#00c8ff", fontWeight: 600 }}
            >
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "#1e2d4f" }}>
          <Link href="/" className="hover:text-[#475569] transition-colors">
            ← Back to landing page
          </Link>
        </p>
      </div>
    </div>
  );
}
