"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getAuthCallbackUrl } from "@/lib/app-urls";
import split from "./auth-split.module.css";

/**
 * v8.6.0 — shared shell + primitives for the authentication pages
 * (login, signup, forgot-password, reset-password).
 *
 * Pure presentation: no auth logic lives here. Light, premium, spacious —
 * white background with extremely soft blue glows, the light logo centred
 * above a floating card.
 *
 * The supplied light logo PNG has a baked-in white background (it is not
 * actually transparent), so it is rendered with CSS mix-blend-mode:
 * multiply — white pixels blend invisibly into the light page without the
 * asset itself being edited.
 */

export const BRAND_BLUE = "#2A5FE3";        // ServiceSignal logo blue
export const BRAND_BLUE_HOVER = "#2350C4";

/**
 * OAuth providers confirmed working in the Supabase project.
 *
 * Deliberately EMPTY. The repository cannot prove dashboard configuration, and
 * a provider that is enabled here but not in Supabase renders a prominent
 * button that fails on click — worse for trust than offering no social sign-in
 * at all. SocialButtons renders nothing while this list is empty.
 *
 * To enable one later: confirm it in Supabase → Authentication → Providers,
 * then add its key here. No other change is required.
 */
export const ENABLED_OAUTH_PROVIDERS: readonly OAuthProvider[] = [];

export type OAuthProvider = "google" | "apple" | "azure";

interface AuthShellProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Optional reassurance panel. When omitted — signup, forgot-password and
   * reset-password — the centred-card layout below is used unchanged.
   */
  aside?: React.ReactNode;
}

export function AuthShell({ children, footer, aside }: AuthShellProps) {
  // ── Split layout: /login only ────────────────────────────────────────────
  if (aside) {
    return (
      <div className={split.root}>
        <div className={split.formCol}>
          <div className={split.formInner}>
            {/* The Landing Page 2.0 lockup: the mark asset plus real HTML
                text. servicesignal-auth-logo.png is NOT used here — it is a
                stacked lockup carrying the retired "AUTOMATED INVOICE CHASING
                FOR UK BUSINESSES" tagline, which contradicts the approval-first
                product. No image was edited; this composes the same two parts
                Nav and SiteFooter already use.
                REVIEW BRANCH: points at the /v2 preview. Change back to "/"
                when v2 becomes the root landing page. */}
            <Link href="/v2" aria-label="ServiceSignal home" className={split.lockup}>
              <Image
                src="/branding/servicesignal-mark.png"
                alt=""
                width={875}
                height={1366}
                priority
                sizes="30px"
                className={split.lockupMark}
              />
              <span className={split.lockupWord}>
                Service<span className={split.lockupWordAccent}>Signal</span>
              </span>
            </Link>

            {children}

            {footer && <div className={split.footer}>{footer}</div>}
          </div>
        </div>

        {aside}
      </div>
    );
  }

  // ── Centred card: every other auth page, byte-identical to before ────────
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{
        background: `
          radial-gradient(600px 400px at 15% 10%, rgba(42,95,227,0.07), transparent 70%),
          radial-gradient(700px 500px at 85% 90%, rgba(14,165,196,0.06), transparent 70%),
          #fafbfd
        `,
      }}
    >
      {/* Logo — final approved transparent asset (v8.6.0.5), rendered
          directly: no cropping, clipping, masking, blend modes or wrappers.
          min(440px, 100%) wide, natural aspect ratio, mobile-safe.
          Gap note: the PNG itself contains ~58px of transparent padding
          below the artwork at this display size (measured: 31.2% of image
          height), so the -22px margin lands the VISUAL bottom of the logo
          ~36px above the card — inside the requested 32-40px window. The
          image is untouched; this is layout positioning only. */}
      {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
      <Link href="/v2" aria-label="ServiceSignal home" className="block max-w-full" style={{ marginBottom: -22, width: "min(440px, 100%)" }}>
        <Image
          src="/branding/servicesignal-auth-logo.png"
          alt="ServiceSignal"
          width={6400}
          height={2722}
          priority
          style={{ width: "min(440px, 100%)", height: "auto" }}
        />
      </Link>

      {/* Floating card */}
      <div
        className="w-full rounded-2xl"
        style={{
          maxWidth: 530,
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
          padding: "2.5rem",
        }}
      >
        {children}
      </div>

      {footer && <div className="mt-8 text-center space-y-2">{footer}</div>}
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-7">
      <h1 style={{ fontSize: "1.55rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>{title}</h1>
      <p className="text-sm mt-1.5" style={{ color: "#64748b", lineHeight: 1.55 }}>{subtitle}</p>
    </div>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg px-4 py-3 text-sm mb-5" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>
      {message}
    </div>
  );
}

export function AuthInput(props: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  labelRight?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={props.id} className="text-sm" style={{ fontWeight: 600, color: "#0f172a" }}>{props.label}</label>
        {props.labelRight}
      </div>
      <input
        id={props.id}
        type={props.type ?? "text"}
        className="dash-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        required
      />
    </div>
  );
}

export function PasswordInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  labelRight?: React.ReactNode;
  /**
   * Optional accessibility wiring, added for the signup password fields.
   *
   * Both default to undefined/false, so /login, /forgot-password and
   * /reset-password render byte-identically to before — they simply pass
   * neither, and no attribute appears.
   */
  describedBy?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={props.id} className="text-sm" style={{ fontWeight: 600, color: "#0f172a" }}>{props.label}</label>
        {props.labelRight}
      </div>
      <div className="relative">
        <input
          id={props.id}
          type={show ? "text" : "password"}
          className="dash-input"
          style={{ paddingRight: "2.8rem" }}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid || undefined}
          required
        />
        {/* Each PasswordInput owns its own `show` state, so the two fields on
            the signup form toggle independently. type="button" keeps it out of
            the form's submit path. */}
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded"
          style={{ color: "#64748b", width: 24, height: 24 }}
        >
          {show ? (
            <svg width="17" height="17" fill="none" viewBox="0 0 24 24"><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : (
            <svg width="17" height="17" fill="none" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.8" /><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" stroke="currentColor" strokeWidth="1.8" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function SubmitButton({ loading, idleText, loadingText }: { loading: boolean; idleText: string; loadingText: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full inline-flex items-center justify-center gap-2 rounded-lg text-white transition-colors"
      style={{
        background: loading ? BRAND_BLUE_HOVER : BRAND_BLUE,
        padding: "0.8rem 1rem",
        fontWeight: 650,
        fontSize: "0.95rem",
        opacity: loading ? 0.85 : 1,
        cursor: loading ? "default" : "pointer",
      }}
      onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = BRAND_BLUE_HOVER; }}
      onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = BRAND_BLUE; }}
    >
      {loading && (
        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.35)" strokeWidth="3.5" />
          <path d="M22 12a10 10 0 00-10-10" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
      )}
      {loading ? loadingText : idleText}
    </button>
  );
}

/** ──────── OR ──────── divider */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 my-6" aria-hidden="true">
      <div className="flex-1 h-px" style={{ background: "#e5e7eb" }} />
      <span className="text-xs" style={{ color: "#94a3b8", fontWeight: 600, letterSpacing: "0.08em" }}>OR</span>
      <div className="flex-1 h-px" style={{ background: "#e5e7eb" }} />
    </div>
  );
}

/**
 * Social sign-in via Supabase OAuth (PKCE → /auth/callback).
 * Providers must be enabled in Supabase → Authentication → Providers.
 * Until then, Supabase returns "provider is not enabled" and the button
 * shows a clear message inline — it never fails silently.
 */
export function SocialButtons({
  next = "/dashboard",
  providers = ENABLED_OAUTH_PROVIDERS,
}: {
  next?: string;
  providers?: readonly OAuthProvider[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const oauth = async (provider: "google" | "apple" | "azure", label: string) => {
    setBusy(provider);
    setOauthError(null);

    const { getSupabaseBrowser } = await import("@/lib/supabase-browser");
    const supabase = getSupabaseBrowser();

    // PKCE: the provider returns a ?code= to /auth/callback, which exchanges
    // it for a session cookie and then forwards to `next`.
    const redirectTo = getAuthCallbackUrl(next);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    if (error) {
      setOauthError(
        /not enabled|unsupported/i.test(error.message)
          ? `${label} sign-in isn't switched on for ServiceSignal yet. Please sign in with your email and password.`
          : `${label} sign-in failed: ${error.message}`
      );
      setBusy(null);
      return;
    }

    // supabase-js normally redirects the browser itself. If no URL came back,
    // say so rather than leaving a dead button.
    if (!data?.url) {
      setOauthError(`${label} sign-in couldn't start. Please sign in with your email and password.`);
      setBusy(null);
    }
    // Otherwise the browser is navigating to the provider now.
  };

  // No confirmed provider — render nothing rather than a button that fails.
  if (providers.length === 0) return null;

  const btnStyle: React.CSSProperties = {
    border: "1px solid #d3dae3",
    background: "#ffffff",
    padding: "0.7rem 1rem",
    fontWeight: 600,
    fontSize: "0.9rem",
    color: "#0f172a",
  };

  const spinner = (
    <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#cbd5e1" strokeWidth="3.5" />
      <path d="M22 12a10 10 0 00-10-10" stroke="#64748b" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="space-y-2.5">
      {providers.includes("google") && <button type="button" onClick={() => oauth("google", "Google")} disabled={!!busy}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg transition-colors hover:bg-[#f8fafc]"
        style={{ ...btnStyle, opacity: busy && busy !== "google" ? 0.55 : 1 }}>
        {busy === "google" ? spinner : (
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        )}
        {busy === "google" ? "Redirecting to Google…" : "Continue with Google"}
      </button>}

      {providers.includes("apple") && <button type="button" onClick={() => oauth("apple", "Apple")} disabled={!!busy}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg transition-colors hover:bg-[#f8fafc]"
        style={{ ...btnStyle, opacity: busy && busy !== "apple" ? 0.55 : 1 }}>
        {busy === "apple" ? spinner : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#0f172a" aria-hidden="true"><path d="M16.62 12.9c.03 3.22 2.83 4.29 2.86 4.3-.02.08-.45 1.53-1.47 3.03-.89 1.3-1.81 2.59-3.26 2.62-1.43.03-1.89-.85-3.52-.85-1.63 0-2.14.82-3.49.88-1.4.05-2.47-1.4-3.36-2.7C2.55 17.55 1.14 12.7 3.01 9.5a5.2 5.2 0 014.39-2.67c1.38-.03 2.68.93 3.52.93.84 0 2.42-1.15 4.08-.98.7.03 2.65.28 3.9 2.12-.1.06-2.33 1.36-2.28 4zM13.9 4.31c.74-.9 1.24-2.15 1.1-3.4-1.07.04-2.35.71-3.12 1.6-.68.8-1.28 2.07-1.12 3.29 1.19.1 2.4-.6 3.14-1.49z"/></svg>
        )}
        {busy === "apple" ? "Redirecting to Apple…" : "Continue with Apple"}
      </button>}

      {providers.includes("azure") && <button type="button" onClick={() => oauth("azure", "Microsoft")} disabled={!!busy}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg transition-colors hover:bg-[#f8fafc]"
        style={{ ...btnStyle, opacity: busy && busy !== "azure" ? 0.55 : 1 }}>
        {busy === "azure" ? spinner : (
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="13" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="13" width="10" height="10" fill="#00A4EF"/><rect x="13" y="13" width="10" height="10" fill="#FFB900"/></svg>
        )}
        {busy === "azure" ? "Redirecting to Microsoft…" : "Continue with Microsoft"}
      </button>}

      {/* Errors show HERE, right under the buttons that caused them. */}
      {oauthError && (
        <div role="alert" className="rounded-lg px-3.5 py-2.5 text-xs" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>
          {oauthError}
        </div>
      )}
    </div>
  );
}
