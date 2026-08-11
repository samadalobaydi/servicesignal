/**
 * Carrying a verified beta invitation from the email click to account setup.
 *
 * WHY A COOKIE
 *
 * The token must survive the hop from /api/beta/verify to /signup, and the
 * alternatives are all worse:
 *
 *   query string  — the token would sit in browser history, in the Referer
 *                   header of every outbound link on the page, and in any
 *                   analytics that records URLs.
 *   sessionStorage — readable by any script on the origin, and lost if the
 *                   link opens in a different tab from the one that finishes.
 *   localStorage  — the same exposure, but persisted.
 *
 * An httpOnly cookie is unreadable by JavaScript, is never in a URL, and is
 * sent only to this origin. The prefill and account-creation routes read it
 * server-side; the browser never sees the token at all.
 *
 * The cookie is scoped to the beta routes' needs and is short-lived — it holds
 * a capability, so it should outlive the click by hours, not weeks.
 */

export const BETA_CONTINUATION_COOKIE = "ss_beta_continuation";

/** Long enough to set a password without rushing; short enough to matter. */
const MAX_AGE_SECONDS = 60 * 60 * 2; // 2 hours

export function continuationCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // "lax" rather than "strict": the user arrives by clicking a link in an
    // email client, which is a cross-site navigation. "strict" would withhold
    // the cookie on exactly that first request and break the journey.
    sameSite: "lax",
    // Secure in production; off locally so http://localhost works. Driven by
    // NODE_ENV rather than a URL parse so there is nothing to mis-configure.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Options for clearing it — same attributes, zero lifetime. */
export function clearedContinuationCookieOptions() {
  return { ...continuationCookieOptions(), maxAge: 0 };
}
