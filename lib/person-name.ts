/**
 * The account holder's own name — the PERSON, never the business.
 *
 * WHY THIS EXISTS
 *
 * The Welcome email greeted people with their business name ("Welcome,
 * test1!") because the template's own note said no personal name existed
 * anywhere in the data model. That was true when the template was written and
 * stopped being true the moment the founding-beta form started collecting
 * `name` alongside `business_name` — the comment was never revisited, so the
 * business name stayed in as a stand-in long after a real name was available.
 *
 * Greeting someone by their trading name is not a small blemish. It is the
 * first email a paying customer receives, and it reads as though nobody at
 * ServiceSignal knows who they are.
 *
 * Pure and dependency-free so both the mailer and its tests can use it.
 */

/**
 * The first name from a full name field.
 *
 * Deliberately NOT clever — no title stripping, no name-order detection, no
 * library. Those get non-Western names wrong in ways worse than being slightly
 * formal. A single-word name is returned whole rather than mangled.
 *
 * KNOWN LIMITATION, accepted: "Dr Smith" greets as "Dr". Rare, and the
 * alternative is a title list that will always be incomplete.
 */
export function firstNameFrom(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

/**
 * The Welcome-email heading.
 *
 * Falls back to a warm, complete sentence rather than to anything derived from
 * the business — a greeting is either personal or it is not, and "Welcome,
 * <trading name>!" is the failure this function exists to prevent. It can
 * never produce "Welcome, !", because an unusable name takes the fallback.
 */
export function welcomeGreeting(personName: string | null | undefined): string {
  const first = firstNameFrom(personName);
  return first ? `Welcome, ${first}!` : "Welcome to ServiceSignal";
}
