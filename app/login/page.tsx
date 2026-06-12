"use client";

import { Suspense } from "react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

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
        SIGN IN
      </h1>
      <p className="text-sm mb-6" style={{ color: "#64748b" }}>
        Welcome back. Enter your details below.
      </p>

      <form onSubmit={handleLogin} noValidate className="space-y-4">
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
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
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
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      <p className="text-center text-sm mt-6" style={{ color: "#475569" }}>
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-display transition-colors"
          style={{ color: "#00c8ff", fontWeight: 600 }}
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
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

        {/* Wrap form in Suspense — required by Next.js for useSearchParams */}
        <Suspense
          fallback={
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: "#0f1628", border: "1px solid rgba(0,200,255,0.12)" }}
            >
              <p className="text-sm" style={{ color: "#64748b" }}>Loading...</p>
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs mt-6" style={{ color: "#1e2d4f" }}>
          <Link href="/" className="hover:text-[#475569] transition-colors">
            ← Back to landing page
          </Link>
        </p>
      </div>
    </div>
  );
}
