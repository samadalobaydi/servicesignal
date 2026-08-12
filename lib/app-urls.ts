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
 * The origin of THIS Vercel Preview deployment, or null when not on one.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * NEXT_PUBLIC_APP_URL is a single project-wide value. Set to
 * https://servicesignal.app so production is correct, it also applies to every
 * Preview — so a beta signup submitted on a Preview received a verification
 * link pointing at production, which 404'd because the route only exists on
 * this branch. The whole entry journey was untestable before release.
 *
 * ── WHY THESE TWO VARIABLES ARE TRUSTED ───────────────────────────────────
 *
 * VERCEL_ENV and VERCEL_URL are injected by the platform at build/run time.
 * They are NOT derived from the incoming request, so nothing a caller can send
 * — Host, Origin, Referer, a form field, a query parameter — can influence
 * them. That matters because these links carry one-time verification tokens: a
 * spoofable origin would let an attacker have a real token mailed to a host
 * they control.
 *
 * VERCEL_URL is also the immutable per-deployment host, so the link returns to
 * the exact deployment that sent it rather than to a moving branch alias.
 *
 * Both are server-only (no NEXT_PUBLIC_ prefix), which is correct: emails are
 * rendered server-side. In the browser this returns null and the existing
 * resolution is unchanged.
 */
function vercelPreviewOrigin(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;

  const host = process.env.VERCEL_URL?.trim();
  if (!host) return null;

  // VERCEL_URL is a bare host with no scheme. Validated anyway rather than
  // interpolated blindly — a value carrying a scheme, a path, credentials or
  // whitespace would silently build a malformed or off-origin link.
  if (!/^[a-z0-9.-]+$/i.test(host)) {
    console.error(
      `[app-urls] VERCEL_URL is not a bare hostname: ${JSON.stringify(host)}. Ignoring it.`
    );
    return null;
  }
  return `https://${host}`;
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
  // Same preview correction as requireAppBaseUrl, and for the same reason.
  // Only ever true server-side: VERCEL_URL has no NEXT_PUBLIC_ prefix, so in
  // the browser this is null and the window.location.origin behaviour below is
  // untouched.
  const preview = vercelPreviewOrigin();
  if (preview) return preview;

  const envValue = process.env.NEXT_PUBLIC_APP_URL;

  if (envValue && envValue.trim()) {
    const cleaned = stripTrailingSlashes(envValue);

    // Validated, not trusted. A malformed value here silently mis-targets
    // every account-journey link in every email — and the failure is invisible
    // until a recipient clicks one. This exact class of fault has already cost
    // us a debugging session: a missing newline in .env.local made
    // `REMINDER_MODE=approvalNEXT_PUBLIC_APP_URL=http://localhost:3000` one
    // line, so the variable was never defined, and local testing quietly sent
    // testers to the deployed production app.
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`unsupported protocol "${parsed.protocol}"`);
      }
      return cleaned;
    } catch {
      // Loud, and names the variable and the value, because the symptom
      // (links going to the wrong environment) points nowhere near the cause.
      console.error(
        `[app-urls] NEXT_PUBLIC_APP_URL is malformed: ${JSON.stringify(cleaned)}. ` +
          "Expected an absolute origin such as http://localhost:3000 or " +
          "https://servicesignal.app. Check for a missing newline in .env.local. " +
          "Falling back to " +
          (typeof window !== "undefined" ? "window.location.origin." : `${PRODUCTION_ORIGIN}.`)
      );
    }
  } else if (typeof window === "undefined") {
    // Server-side with no configuration at all. Every email link built here
    // will point at production — correct in production, wrong everywhere else,
    // and worth saying out loud rather than discovering from a click.
    console.warn(
      "[app-urls] NEXT_PUBLIC_APP_URL is not set. Server-generated links will " +
        `use ${PRODUCTION_ORIGIN}. Set it in .env.local for local development, ` +
        "and in the Vercel project settings for every deployed environment."
    );
  }

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

/**
 * The app origin for ACCOUNT-JOURNEY EMAILS — strict, and fails CLOSED.
 *
 * getAppBaseUrl() above is deliberately lenient: it backs off to
 * window.location.origin in the browser (always correct) and to the production
 * origin as a last resort. That is right for in-app links, where a wrong guess
 * is visible immediately and harmless.
 *
 * It is NOT right for an email. A verification link built from a guessed
 * origin is sent to a real person, and the mistake surfaces only when they
 * click it and land in the wrong environment — which is exactly what happened
 * when a missing newline in .env.local left NEXT_PUBLIC_APP_URL undefined and
 * local testing quietly pointed at the deployed production app. Logging alone
 * does not prevent that: the email still goes.
 *
 * So this returns null rather than guessing, and every email sender treats
 * null as "do not send". An unsent email with a loud log is recoverable; a
 * sent one pointing at the wrong environment is not.
 *
 * Requires NEXT_PUBLIC_APP_URL to be set explicitly in EVERY environment —
 * http://localhost:3000 locally, https://servicesignal.app in Vercel
 * production, and the deployment's own URL in Vercel preview.
 */
export function requireAppBaseUrl(): string | null {
  // PREVIEW FIRST. On a Preview deployment the project-wide NEXT_PUBLIC_APP_URL
  // names production, which is precisely the wrong destination for an email
  // sent by this deployment — see vercelPreviewOrigin(). Production and local
  // are untouched: VERCEL_ENV is "production" and undefined respectively, so
  // this returns null there and resolution continues exactly as before.
  const preview = vercelPreviewOrigin();
  if (preview) return preview;

  const raw = process.env.NEXT_PUBLIC_APP_URL;

  if (!raw || !raw.trim()) {
    console.error(
      "[app-urls] NEXT_PUBLIC_APP_URL is not set. Account-journey email " +
        "SUPPRESSED rather than sent with a guessed origin. Set it in " +
        ".env.local (http://localhost:3000) and in Vercel project settings " +
        "for every deployed environment."
    );
    return null;
  }

  const cleaned = stripTrailingSlashes(raw);

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`unsupported protocol "${parsed.protocol}"`);
    }
    if (!parsed.hostname) throw new Error("missing hostname");
    return cleaned;
  } catch {
    console.error(
      `[app-urls] NEXT_PUBLIC_APP_URL is malformed: ${JSON.stringify(cleaned)}. ` +
        "Account-journey email SUPPRESSED. Expected an absolute origin such as " +
        "http://localhost:3000 or https://servicesignal.app. Check for a " +
        "missing newline in .env.local."
    );
    return null;
  }
}
