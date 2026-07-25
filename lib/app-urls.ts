/**
 * ServiceSignal — central application URL configuration.
 *
 * ONE source of truth for every in-app LINK ServiceSignal generates —
 * signup confirmation, password recovery, OAuth callbacks, the
 * Welcome-email dashboard CTA — used identically from both client
 * components and server-side email rendering.
 *
 * Do NOT use this for email IMAGE urls. Those must always resolve to
 * the production asset domain regardless of environment, since mail
 * clients can never reach localhost — see emails/theme.ts's
 * `assetsBaseUrl`, a deliberately separate, fixed constant. Merging the
 * two would risk a broken-in-every-inbox image the moment someone tests
 * locally; keeping them apart is a deliberate safety boundary, not an
 * oversight.
 */

const PRODUCTION_ORIGIN = "https://servicesignal.app";

function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * The app's own base origin. Resolution order:
 *
 *   1. NEXT_PUBLIC_APP_URL, if set — the explicit, preferred
 *      configuration (`.env.local` for local dev, Vercel env vars for
 *      production), trailing slash stripped so `${base}/x` can never
 *      become malformed.
 *   2. window.location.origin, if running in a browser and the env var
 *      is unset — self-detects correctly with zero configuration. This
 *      is what every one of these call sites did before this file
 *      existed, and is kept as a safety net: forgetting to set
 *      NEXT_PUBLIC_APP_URL locally previously never broke anything
 *      (window.location.origin is always accurate), and removing that
 *      safety net would make local testing WORSE, not better, if the
 *      variable is ever forgotten.
 *   3. The hard-coded production origin — the only sensible option left
 *      when running server-side (rendering an email has no `window`)
 *      with no env var set.
 */
export function getAppBaseUrl(): string {
  const envValue = process.env.NEXT_PUBLIC_APP_URL;
  if (envValue && envValue.trim()) return stripTrailingSlashes(envValue);
  if (typeof window !== "undefined") return window.location.origin;
  return PRODUCTION_ORIGIN;
}

/** The PKCE code-exchange callback. Optionally forwards a `next` destination. */
export function getAuthCallbackUrl(next?: string): string {
  const base = `${getAppBaseUrl()}/auth/callback`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * The redirectTo value for supabase.auth.resetPasswordForEmail(). Routes
 * through /auth/callback (PKCE code exchange) rather than /reset-password
 * directly — recovery links carry the same ?code= as OAuth, and without
 * this hop updateUser() would run with no session, failing every time.
 */
export function getResetPasswordRedirectUrl(): string {
  return getAuthCallbackUrl("/reset-password");
}

/** Where the Welcome-email Dashboard CTA (and similar in-app links) should point. */
export function getDashboardUrl(): string {
  return `${getAppBaseUrl()}/dashboard`;
}
