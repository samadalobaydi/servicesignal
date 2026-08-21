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
/**
 * Distinct from null: "this IS a preview, and it is misconfigured".
 *
 * null means "not a preview, carry on with the normal resolution". This
 * sentinel means "stop — do not fall back to production", which is a different
 * instruction and must not collapse into the same value.
 */
const PREVIEW_MISCONFIGURED = Symbol("preview-misconfigured");

/**
 * An explicitly configured Preview origin — the escape hatch for a project
 * where Vercel's system variables are not exposed to the runtime.
 *
 * ── WHY ITS OWN VARIABLE, AND NOT NEXT_PUBLIC_APP_URL ─────────────────────
 *
 * NEXT_PUBLIC_APP_URL is one project-wide value meaning "the app's origin". On
 * a Preview it holds production, because production also needs it. Reusing it
 * as a Preview override would make the SAME value mean two different things
 * depending on where it was set — and being unable to tell those apart is the
 * original bug in this file.
 *
 * PREVIEW_APP_URL has exactly one meaning: someone deliberately set this
 * Preview's origin. If it is present it was intended; if it is absent there is
 * nothing to disambiguate.
 *
 * Server-only, with no NEXT_PUBLIC_ prefix: it is used to build token links
 * during server-side email rendering and must never be inlined into the client
 * bundle.
 */
/**
 * Can this runtime POSITIVELY prove it is local development?
 *
 * ── WHY ABSENCE IS NOT EVIDENCE ───────────────────────────────────────────
 *
 * The resolver used to treat "no VERCEL_ENV" as "must be local" and fall
 * through to NEXT_PUBLIC_APP_URL. But a Vercel Preview with system variables
 * switched off exposes no VERCEL_ENV either — so a misconfigured Preview was
 * indistinguishable from `next dev`, and silently emailed the production
 * origin. That is the original 404 bug, reached by a different route.
 *
 * Local must therefore be established by something POSITIVE:
 *
 *   NODE_ENV === "development"  — set by `next dev`. Vercel builds and runs
 *                                 with NODE_ENV=production, so this is never
 *                                 true on a deployment.
 *   a loopback origin           — localhost / 127.0.0.1 / ::1. Local by
 *                                 construction: no deployed environment can
 *                                 legitimately mail a link to loopback, and
 *                                 nobody can receive one there.
 *
 * Either is sufficient. Both are deployment configuration, never
 * request-derived.
 */
function isPositivelyLocal(): boolean {
  if (process.env.NODE_ENV === "development") return true;

  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return false;
  try {
    const host = new URL(stripTrailingSlashes(raw)).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function explicitPreviewOrigin(): string | null {
  const raw = process.env.PREVIEW_APP_URL?.trim();
  if (!raw) return null;

  const cleaned = stripTrailingSlashes(raw);
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`unsupported protocol "${parsed.protocol}"`);
    }
    if (!parsed.hostname) throw new Error("missing hostname");

    // Refused, loudly. Pointing a Preview override at production is almost
    // certainly a copy-paste of NEXT_PUBLIC_APP_URL, and honouring it would
    // rebuild the exact 404 link this whole contract exists to prevent.
    if (cleaned === PRODUCTION_ORIGIN) {
      console.error(
        "[app-urls] PREVIEW_APP_URL is set to the production origin, which " +
          "would email a verification link into an environment this Preview " +
          "is not. Ignoring it; set the Preview's own URL or unset it."
      );
      return null;
    }
    return cleaned;
  } catch {
    console.error(
      `[app-urls] PREVIEW_APP_URL is malformed: ${JSON.stringify(cleaned)}. ` +
        "Expected an absolute origin such as https://my-branch.vercel.app."
    );
    return null;
  }
}

function vercelPreviewOrigin(): string | null | typeof PREVIEW_MISCONFIGURED {
  const env = process.env.VERCEL_ENV;

  // ── A DEPLOYMENT VERCEL HAS IDENTIFIED AS A PREVIEW ─────────────────────
  if (env === "preview") {
    const host = process.env.VERCEL_URL?.trim();

    if (host && /^[a-z0-9.-]+$/i.test(host)) return `https://${host}`;

    if (host) {
      // Present but unusable — a value carrying a scheme, path, credentials or
      // whitespace would build a malformed or off-origin link.
      console.error(
        `[app-urls] VERCEL_URL is not a bare hostname: ${JSON.stringify(host)}.`
      );
    }

    const explicit = explicitPreviewOrigin();
    if (explicit) return explicit;

    console.error(
      "[app-urls] VERCEL_ENV is \"preview\" but no usable Preview origin is " +
        "available (VERCEL_URL missing or invalid, PREVIEW_APP_URL unset). " +
        "Account-journey email SUPPRESSED rather than sent with a production " +
        "link that would 404."
    );
    return PREVIEW_MISCONFIGURED;
  }

  // ── NO VERCEL_ENV AT ALL ────────────────────────────────────────────────
  //
  // This runtime looks EXACTLY like local development: with system variables
  // switched off, a Vercel Preview exposes neither VERCEL_ENV nor VERCEL_URL,
  // and there is nothing left to distinguish it from `next dev`.
  //
  // That is why PREVIEW_APP_URL is honoured here. Setting a server-only
  // environment variable IS the operator declaring "this deployment is not
  // production, and this is its origin" — trusted deployment configuration,
  // never request-derived, so it carries the same trust as VERCEL_URL.
  //
  // Without this branch the previous contract was self-contradictory: it
  // offered PREVIEW_APP_URL as the answer to missing system variables, while
  // gating it behind VERCEL_ENV — which is itself one of the missing system
  // variables. A Preview in that state silently resolved to production and
  // rebuilt the 404 this file exists to prevent.
  if (env === undefined || env.trim() === "") {
    const explicit = explicitPreviewOrigin();
    if (explicit) return explicit;
  }

  // "production", or any other value: never overridden. A stray
  // PREVIEW_APP_URL must not be able to redirect production's token links.
  return null;
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
  // Lenient by design — this builds in-app links, where a wrong origin is
  // visible immediately and harmless. Only the email resolver fails closed.
  if (typeof preview === "string") return preview;

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

/**
 * The origin a PKCE code must be exchanged on.
 *
 * ── WHY THIS IS NOT getAppBaseUrl() ───────────────────────────────────────
 *
 * THE BUG. A password reset requested from a Vercel Preview arrived correctly,
 * and clicking it landed on PRODUCTION with "This password reset link has
 * expired or already been used".
 *
 * The link was wrong before Supabase ever saw it. getAppBaseUrl() begins with
 * vercelPreviewOrigin(), which reads VERCEL_ENV, VERCEL_URL and
 * PREVIEW_APP_URL — all deliberately server-only. In the browser Next inlines
 * only NEXT_PUBLIC_* variables, so those three evaluate to `undefined`, the
 * preview correction can never fire, and resolution falls through to
 * NEXT_PUBLIC_APP_URL. That is one project-wide value naming production, and
 * it is compiled into the client bundle as a literal:
 *
 *     let e = r.env.VERCEL_ENV;          // undefined in the browser
 *     let t = "https://servicesignal.app";  // NEXT_PUBLIC_APP_URL, inlined
 *
 * So every Preview asked Supabase to send the customer to production.
 *
 * ── WHY window.location.origin IS THE CORRECT ANSWER, NOT A WORKAROUND ────
 *
 * PKCE stores its code_verifier in a cookie on the origin that STARTED the
 * flow (createBrowserClient, lib/supabase-browser.ts). The exchange has to
 * happen on that same origin or the cookie is never sent and
 * exchangeCodeForSession fails with no verifier — which is exactly the
 * "expired or already used" message, arrived at by a completely different
 * cause. The browser's own origin is therefore not merely a good guess here;
 * it is the ONLY value that can work.
 *
 * ── AND WHY IT IS NOT THE SPOOFING RISK THIS FILE GUARDS AGAINST ──────────
 *
 * The warning at the top of vercelPreviewOrigin() is about SERVER-rendered
 * emails, where a request-derived origin (Host, X-Forwarded-Host, Origin)
 * would let an attacker have someone else's token mailed to a host they
 * control. Nothing of that shape applies here: this runs in the victim's own
 * browser, on a page they are already looking at, and an attacker who can
 * change window.location.origin already owns the page. The real control is
 * Supabase's redirect allow-list, which rejects any origin not listed —
 * server-side, where it cannot be bypassed.
 *
 * Server-side callers keep the existing resolution untouched.
 */
function getPkceExchangeOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return getAppBaseUrl();
}

/**
 * The PKCE code-exchange callback. Optionally forwards a `next` destination.
 *
 * SHARED WITH OAUTH — SocialButtons passes its own `next`. That is not a
 * collision to work around: OAuth is the same PKCE flow with the same
 * browser-held verifier, so it had the identical latent fault and takes the
 * identical fix. It is dormant today only because ENABLED_OAUTH_PROVIDERS is
 * empty, which means this correction lands before the first provider is
 * switched on rather than after someone reports it.
 */
export function getAuthCallbackUrl(next?: string): string {
  const base = `${getPkceExchangeOrigin()}/auth/callback`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

/**
 * The redirectTo value for supabase.auth.resetPasswordForEmail(). Routes
 * through /auth/callback (PKCE code exchange) rather than /reset-password
 * directly — recovery links carry the same ?code= as OAuth, and without
 * this hop updateUser() would run with no session, failing every time.
 *
 * Called from a client component, so it resolves to the browser's own origin
 * — see getPkceExchangeOrigin. Supabase must have that origin in
 * Authentication → URL Configuration → Redirect URLs, or it substitutes the
 * Site URL and the customer lands on production again.
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
  // A misconfigured Preview fails CLOSED. The signup row is already saved by
  // the caller, so nothing is lost but the email — and an unsent email with a
  // loud log is recoverable, while one carrying a token to a 404 is not.
  if (preview === PREVIEW_MISCONFIGURED) return null;
  if (preview) return preview;

  // ── AN UNCLASSIFIABLE DEPLOYED RUNTIME FAILS CLOSED ─────────────────────
  //
  // Reaching here means: not a Preview by any trusted signal, and no explicit
  // Preview origin. That is correct for production and for local development —
  // but it is ALSO what a Vercel Preview looks like when system variables are
  // switched off, and returning NEXT_PUBLIC_APP_URL there would mail a token
  // to production and 404, which is the whole bug.
  //
  // So the environment must positively identify itself. Production says so via
  // VERCEL_ENV; local proves it via NODE_ENV or a loopback origin. Anything
  // else is ambiguous, and an ambiguous environment does not get to send a
  // security-sensitive link.
  if (process.env.VERCEL_ENV !== "production" && !isPositivelyLocal()) {
    console.error(
      "[app-urls] This runtime cannot be classified as Production, Preview or " +
        "local development (VERCEL_ENV unset, no PREVIEW_APP_URL, NODE_ENV not " +
        "development, configured origin is not loopback). Account-journey " +
        "email SUPPRESSED rather than sent with a possibly wrong origin. On " +
        "Vercel, expose the system environment variables or set PREVIEW_APP_URL."
    );
    return null;
  }

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
