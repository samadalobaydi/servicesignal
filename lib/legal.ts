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

  supportEmail: "support@servicesignal.app",
  // Convention, not a confirmed existing inbox — flagged in the report.
  privacyEmail: "privacy@servicesignal.app",
} as const;
