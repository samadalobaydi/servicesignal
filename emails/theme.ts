/**
 * ServiceSignal Email Design System — shared tokens.
 *
 * These values deliberately mirror components/auth/AuthShell.tsx so email
 * and the authentication pages read as one product. If the auth palette
 * changes, update it here too.
 */

export const emailTheme = {
  colors: {
    // Backgrounds
    pageBg: "#fafbfd",          // Outlook-safe solid fallback (see EmailLayout)
    cardBg: "#ffffff",
    cardBorder: "#e5e7eb",
    sectionMuted: "#f8fafc",

    // Text
    text: "#0f172a",
    textMuted: "#64748b",
    textSoft: "#94a3b8",

    // Brand
    brand: "#2A5FE3",
    brandHover: "#2350C4",

    // Semantic (mirrors the dashboard's --dash-* tones)
    success: "#059669",
    successSoft: "#ecfdf5",
    warning: "#d97706",
    warningSoft: "#fffbeb",
    danger: "#dc2626",
    dangerSoft: "#fef2f2",
    info: "#2A5FE3",
    infoSoft: "#eef3fe",

    divider: "#e5e7eb",
  },
  font: {
    // System font stack — renders natively (and identically to the app) in
    // every mail client with zero webfont loading risk.
    family:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  layout: {
    emailWidth: 600, // the email-industry-standard safe width
    radius: 16,       // ignored by Outlook desktop — degrades to square corners
  },
  assetsBaseUrl:
    // IMAGES ONLY. Email clients fetch images from a live URL over the
    // public internet — Gmail can never reach localhost, in ANY
    // environment the sending code happens to run in. This must always
    // be the real production origin, with no exception. Update if the
    // production domain ever changes.
    "https://servicesignal.app",
} as const;

/**
 * LINKS ONLY (e.g. the dashboard CTA) — the opposite rule from
 * assetsBaseUrl above. A person testing locally wants "Go to your
 * dashboard" to open their local dev server, where their test session
 * actually lives — not production, where that account doesn't exist.
 *
 * Reads NEXT_PUBLIC_APP_URL (checked against the existing env var
 * architecture first — no such variable existed anywhere in this
 * codebase, so this introduces it, matching the naming already
 * suggested alongside NEXT_PUBLIC_SUPABASE_URL's own convention).
 * Falls back to the production origin if unset, so an email correctly
 * still points at production even if the variable is never configured.
 * Trailing slash is stripped so `${appUrl}/dashboard` can never become
 * malformed regardless of how the variable was set.
 */
export const appUrl = (
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || "https://servicesignal.app"
);

/**
 * The approved email banner logo (v8.9.0) — a single central config value
 * so no template hardcodes this path directly. Used today by WelcomeEmail;
 * available for any future email that wants the same banner treatment.
 *
 * Natural size 2048x826 (measured directly from the asset, not assumed).
 * Rendered at 440px wide — mid-point of the approved 420-460px range —
 * with height computed from the true aspect ratio so the image is never
 * stretched or distorted. Both width and height are passed as explicit
 * pixel attributes (not just CSS) for reliable rendering in Outlook and
 * older clients that don't respect height:auto; max-width:100% in the
 * inline style is what makes it shrink responsively on mobile.
 */
export const emailBanner = {
  src: `${emailTheme.assetsBaseUrl}/branding/servicesignal-email-logo.png`,
  width: 440,
  height: 178, // 2048:826 aspect ratio preserved at 440px wide (177.5, rounded)
  alt: "ServiceSignal — automated invoice chasing for UK businesses",
} as const;
