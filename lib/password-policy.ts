/**
 * The ServiceSignal account password policy — ONE definition, imported by
 * every layer that enforces it.
 *
 * WHY THIS MODULE EXISTS
 *
 * Before it, the signup form checked five rules (length, uppercase, lowercase,
 * number, special character) and POST /api/beta/account checked exactly one
 * (length). The visible checklist was therefore not the policy — it was a
 * suggestion the server never verified, and four of its five ticks meant
 * nothing. A user with browser tools, a password manager that pastes, or any
 * non-browser client could create an account the UI said was impossible.
 *
 * Two lists in two files will always drift eventually. One list cannot — and
 * /reset-password proved the point by keeping its own private five-rule list
 * until this change, which meant an account could be reset to a password the
 * signup form would have refused.
 *
 * THE POLICY, as a deliberate product decision:
 *
 *   1. at least 10 characters
 *   2. at least one uppercase letter
 *   3. at least one number
 *   4. at least one special character (any non-alphanumeric)
 *
 * NO LOWERCASE REQUIREMENT, and that omission is intentional rather than an
 * oversight. Nothing in Supabase Auth or in this codebase requires one, and a
 * fifth rule would buy no meaningful entropy while adding another way to fail.
 *
 * A NOTE ON THE TRADE-OFF, so the reasoning is on the record: NIST SP 800-63B
 * advises against composition rules precisely because they push people towards
 * predictable substitutions ("Password1!"). Length is what genuinely helps.
 * ServiceSignal accepts that cost knowingly — the minimum was raised from 8 to
 * 10 at the same time as the character rules were added, so the floor moved in
 * the direction that actually matters, and the UI still encourages going
 * beyond 10 without making it a gate.
 *
 * Deliberately free of React, Next and Supabase so a client component, a route
 * handler and a test can all import it.
 */

export const PASSWORD_MIN_LENGTH = 10;

export type PasswordRuleId = "length" | "uppercase" | "number" | "special";

export interface PasswordRule {
  id: PasswordRuleId;
  /** Shown in the live checklist. Phrased as the requirement, not a scold. */
  label: string;
  test: (password: string) => boolean;
}

/**
 * Order matters: this is the order the checklist renders and the order the
 * first error message is chosen from, so the user is told about the most
 * fundamental problem first.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter",
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: "number",
    label: "At least one number",
    test: (p) => /[0-9]/.test(p),
  },
  {
    id: "special",
    /**
     * ANY non-alphanumeric character, deliberately.
     *
     * Not an allow-list. A curated set ("must contain ! or ?") is worse than
     * useless: it shrinks the search space an attacker has to cover while
     * telling a user their perfectly good `£` or `_` is invalid. This accepts
     * ! ? @ # £ $ % & * _ - and everything else outside [A-Za-z0-9], including
     * spaces and non-ASCII symbols.
     */
    label: "At least one special character",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

/** Server-facing messages. Specific enough to act on, never echoing the value. */
export const PASSWORD_RULE_ERROR: Record<PasswordRuleId, string> = {
  length: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  uppercase: "Password must include at least one uppercase letter.",
  number: "Password must include at least one number.",
  special: "Password must include at least one special character, such as ! ? @ # or £.",
};

/** Which rules a candidate password fails, in rule order. */
export function passwordProblems(password: string): PasswordRuleId[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.id);
}

export function isPasswordAcceptable(password: string): boolean {
  return passwordProblems(password).length === 0;
}

/** The single message to show, or null when the password is acceptable. */
export function firstPasswordError(password: string): string | null {
  const [firstProblem] = passwordProblems(password);
  return firstProblem ? PASSWORD_RULE_ERROR[firstProblem] : null;
}

/**
 * Length at which the advisory "a longer one would be stronger" hint stops.
 *
 * ADVISORY ONLY. Nothing anywhere refuses a password for being shorter than
 * this — the hint exists because length is the one property that genuinely
 * increases resistance to guessing, and because a bare "requirements met" tick
 * teaches nothing. It is deliberately not a rule and not a strength score:
 * a meter that labels an ACCEPTED password "Weak" contradicts the checklist
 * sitting directly above it, which is the confusion this replaces.
 */
export const PASSWORD_COMFORTABLE_LENGTH = 12;

/**
 * The confirmation-field state.
 *
 * Lives here rather than inline in the form so it is testable, and so the
 * approved behaviour is pinned rather than re-derived from memory next time
 * someone touches the component.
 *
 * A mismatch is NOT reported from the first keystroke. While what has been
 * typed is still a prefix of the password the user is simply mid-word, and
 * telling them it does not match is true and useless — it paints the field red
 * for the entire time they are typing correctly. So: silent while it could
 * still become a match, "do not match" the moment it genuinely cannot, and an
 * explicit confirmation once it does. A password manager filling both fields at
 * once lands straight on `match`.
 */
export type ConfirmationState = "idle" | "match" | "mismatch";

export function confirmationState(password: string, confirm: string): ConfirmationState {
  if (confirm.length === 0) return "idle";
  if (confirm === password) return "match";
  return password.startsWith(confirm) ? "idle" : "mismatch";
}

export function shouldSuggestLongerPassword(password: string): boolean {
  return isPasswordAcceptable(password) && password.length < PASSWORD_COMFORTABLE_LENGTH;
}
