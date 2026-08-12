/**
 * Central configuration for ServiceSignal's legal documents.
 *
 * This is the SINGLE source of truth for version numbers and effective
 * dates — /terms and /privacy display these values, and the signup flow
 * (app/api/profile/route.ts) reads the same constants when durably
 * recording acceptance, guaranteeing the displayed and stored versions
 * can never drift apart.
 *
 * Bump the relevant *_VERSION string and *_EFFECTIVE_DATE whenever the
 * corresponding document's substance changes.
 */

export const LEGAL_CONFIG = {
  termsVersion: "1.0",
  termsEffectiveDate: "20 July 2026",

  privacyVersion: "1.0",
  privacyEffectiveDate: "20 July 2026",

  // NOT a confirmed registered legal entity — see the placeholder list
  // returned in the implementation report. Using the trading name only
  // until incorporation/registration details are supplied.
  tradingName: "ServiceSignal",
  legalEntityName: null as string | null,
  companyNumber: null as string | null,
  registeredAddress: null as string | null,

  jurisdiction: "England and Wales",

  // One monitored mailbox handles support, account, beta-access and privacy
  // correspondence. privacyEmail is kept as a distinct key so a dedicated
  // privacy inbox can be introduced later without touching the legal pages.
  supportEmail: "support@servicesignal.app",
  privacyEmail: "support@servicesignal.app",
} as const;

/**
 * Where a legal page's back link should return to.
 *
 * A CLOSED allow-list, deliberately. The page accepts a short source key
 * (`?from=landing`), never a return URL — so no caller, and no crafted link,
 * can redirect a reader to an arbitrary destination off the back of our
 * legal pages. Anything missing or unrecognised falls back to the root
 * landing page, which is safe from every entry point including the v1 site
 * and external links.
 *
 * Browser history is deliberately not used: a reader who arrives from a
 * bookmark, a search result or an email has no meaningful history to go back
 * to, and `history.back()` would strand them.
 */
const LEGAL_RETURNS = {
  // REVIEW BRANCH: `landing` points at the /v2 preview. Change to "/" when v2
  // becomes the root landing page.
  landing: { href: "/", label: "Back to landing page", closeTab: false },
  // Opened in a NEW TAB from the signup consent line, so the correct action is
  // to close this tab and reveal the original — navigating this tab to /signup
  // would produce a second, empty signup form and make the visitor's entered
  // details look erased.
  signup: { href: "/signup", label: "Back to sign up", closeTab: true },
  login: { href: "/login", label: "Back to sign in", closeTab: false },
} as const;

const LEGAL_RETURN_FALLBACK = {
  href: "/",
  label: "Back to landing page",
  closeTab: false,
} as const;

export type LegalReturn = {
  href: string;
  label: string;
  /** True when this context was opened in its own tab and should close it. */
  closeTab: boolean;
};

/** Resolves `?from=` to a known destination, or the safe fallback. */
export function resolveLegalReturn(from?: string | string[]): LegalReturn {
  // A repeated query param arrives as an array — take the first value only.
  const key = Array.isArray(from) ? from[0] : from;
  if (key && key in LEGAL_RETURNS) {
    return LEGAL_RETURNS[key as keyof typeof LEGAL_RETURNS];
  }
  return LEGAL_RETURN_FALLBACK;
}
