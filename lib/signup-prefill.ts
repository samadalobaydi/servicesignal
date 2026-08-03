/**
 * Carries the business name and email from the Founding Beta form into
 * /signup, without ever putting them in a URL.
 *
 * Why sessionStorage rather than the alternatives:
 *
 *   - Query string — rejected. The address would land in browser history, in
 *     the Referer header sent to any third party the page loads, and in
 *     server access logs. That is exactly what we are avoiding.
 *   - Cookie — rejected. Cookies are transmitted to the server on every
 *     matching request, so the email would end up in request logs anyway,
 *     and would persist beyond the tab.
 *   - React context / router state — rejected. It survives only a client-side
 *     navigation; a refresh, a middle-click or opening the link in a new tab
 *     loses it, and it would need a provider spanning both routes.
 *   - Server-side session — rejected as disproportionate: a store, a session
 *     cookie and a cleanup policy for two strings the user just typed.
 *
 * sessionStorage is same-origin, scoped to the one tab, never transmitted to
 * the server, and discarded when the tab closes. localStorage is deliberately
 * NOT used: this data must not outlive the tab it was created in.
 *
 * Lifecycle: written when the beta form submits successfully, read (without
 * being consumed) on every /signup mount, and cleared at exactly one point —
 * a successful supabase.auth.signUp. Reading does not clear, so a refresh, a
 * trip to Terms or Privacy, or a failed signup attempt all keep the prefill.
 * Storage is never left indefinitely: the tab closing is the backstop.
 *
 * Every function here is safe to call anywhere. Storage can be unavailable
 * (server render, Safari private mode quota, storage disabled by policy) or
 * hold malformed data; nothing throws, and the signup page works normally
 * when it returns null.
 */

const KEY = "servicesignal:signup-prefill";

export interface SignupPrefill {
  businessName: string;
  email: string;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Access itself can throw when storage is blocked by browser policy.
    return null;
  }
}

/** Stores the handover values. Silently does nothing if storage is unavailable. */
export function writeSignupPrefill(data: SignupPrefill): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      KEY,
      JSON.stringify({
        businessName: data.businessName.trim(),
        email: data.email.trim(),
      })
    );
  } catch {
    // Quota exceeded or private-mode restriction. Prefill is a convenience,
    // never a requirement — the signup form still works empty.
  }
}

/** Reads the handover values, or null if absent, unusable or malformed. */
export function readSignupPrefill(): SignupPrefill | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { businessName, email } = parsed as Record<string, unknown>;
    if (typeof businessName !== "string" || typeof email !== "string") return null;

    // Both empty is the same as nothing stored.
    if (!businessName.trim() && !email.trim()) return null;

    return { businessName, email };
  } catch {
    return null;
  }
}

/** Removes the handover values. Called once, on successful account creation. */
export function clearSignupPrefill(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
