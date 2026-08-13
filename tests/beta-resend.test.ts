import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { RESEND_COOLDOWN_SECONDS, VERIFICATION_TTL_HOURS } from "@/lib/beta-verification";

/**
 * Verification resend.
 *
 * A public endpoint that sends email to an address the caller supplies is an
 * abuse target and a potential membership oracle. These tests pin the three
 * properties that make it safe: the cooldown is decided by the database in one
 * statement, a failed send does not strand the customer, and no response
 * distinguishes "this address has an account" from anything else.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Comments must never satisfy a contract assertion. */
const code = (f: string) =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Cooldown is decided by the database, in one statement ──────────────────

test("the cooldown decision and the claim are a single atomic UPDATE", () => {
  const lib = code("lib/beta-verification.ts");
  const fn = lib.slice(lib.indexOf("export async function reissueVerification"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  // THE RACE THIS AVOIDS: SELECT created_at → decide → UPDATE lets two
  // concurrent requests read the same timestamp, both conclude the cooldown
  // has passed, and both send.
  //
  // The age test is part of the UPDATE's own predicate, so the first request
  // to commit removes the row from the matching set and the second matches
  // nothing.
  assert.match(body, /\.update\(\{ superseded_at/, "the claim must be an UPDATE");
  // .lt or .lte — either is a correct "older than the cutoff" bound.
  assert.match(body, /\.lte?\("created_at"/, "the cooldown must be IN the predicate");
  // Scoped to the CLAIM statement. The function also performs a follow-up
  // read with the same predicates, so an unscoped match passed even with the
  // claim's own exclusivity condition deleted.
  const claimStart = body.indexOf(".update({ superseded_at");
  const claim = body.slice(claimStart, body.indexOf(";", claimStart));
  assert.match(claim, /\.is\("superseded_at", null\)/,
    "matching only unsuperseded rows is what makes the winner exclusive");
  assert.match(claim, /\.is\("consumed_at", null\)/);
  assert.match(claim, /\.lte?\("created_at"/, "the cooldown bound belongs to the claim");
  assert.match(claim, /\.select\(/, "the claim must report whether it won");

  // No read-then-decide anywhere in the claim.
  // No read-then-decide before the claim: the UPDATE must be the first
  // statement that touches this row in the request.
  const beforeClaim = body.slice(0, body.indexOf(".update({ superseded_at"));
  assert.equal(/\.select\(/.test(beforeClaim), false,
    "a SELECT before the UPDATE would reintroduce the race");

  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
});

test("client-side disabling is never the only protection", () => {
  // The button's disabled state is UX. An attacker calls the endpoint
  // directly, and serverless instances share no memory, so neither the button
  // nor a module-level counter can be authoritative.
  const route = code("app/api/beta/resend/route.ts");
  assert.match(route, /reissueVerification\(/, "the server must make the decision");
  assert.match(route, /checkSignupRateLimit\(/,
    "broader abuse control must reuse the existing IP limiter");

  // No in-memory counters — they reset per cold start and differ per instance.
  for (const inMemory of [/const \w+ = new Map\(/, /const \w+ = \{\}[\s\S]{0,40}lastSent/i, /globalThis\.\w*[Rr]esend/]) {
    assert.equal(inMemory.test(route), false,
      `serverless makes ${inMemory} unreliable as a limit`);
  }
});

// ── A failed send must not strand the customer ─────────────────────────────

test("a failed send restores the previous verification token", () => {
  // THE FAILURE THE SCHEMA MAKES POSSIBLE: beta_verifications has a partial
  // unique index allowing ONE active row per address, so issuing a new token
  // necessarily supersedes the old one BEFORE the email can be sent. Without
  // compensation, a provider failure would leave the customer with no working
  // link at all — worse off for having asked for help.
  const lib = code("lib/beta-verification.ts");
  assert.match(lib, /restore: \(\) => Promise<void>/,
    "an issued token must come with its own compensation");

  const route = code("app/api/beta/resend/route.ts");
  const sendIdx = route.indexOf("sendBetaAccessEmail(");
  const restoreIdx = route.indexOf("outcome.restore()");
  assert.ok(sendIdx > -1 && restoreIdx > sendIdx,
    "restore must run AFTER a failed send, not before it");
  assert.match(route, /if \(!sent\)[\s\S]{0,200}restore\(\)/,
    "restore must be conditional on the send failing");
});

test("a failed send is reported as a failure, never as sent", () => {
  const route = code("app/api/beta/resend/route.ts");
  // The send result decides the state; nothing else may.
  assert.match(route, /const sent = await sendBetaAccessEmail\(/);

  // Scoped to the !sent branch. The route reports "failed" in several places,
  // so an unscoped match passed even with THIS one flipped to "sent".
  const failStart = route.indexOf("if (!sent)");
  assert.ok(failStart > -1, "there must be an explicit send-failure branch");
  const failBranch = route.slice(failStart, route.indexOf("\n  }", failStart));
  assert.match(failBranch, /state: "failed"/,
    "a failed send must be reported as failed");
  assert.equal(/state: "sent"/.test(failBranch), false,
    "a failed send must never be reported as sent");

  // GENERAL INVARIANT, not just the !sent branch: no refusal anywhere in this
  // route may report a send. The route has several failure exits (no admin
  // client, IP limited, claim error) and each is a place someone could
  // accidentally return "sent".
  const responses = Array.from(route.matchAll(/\{ success: (true|false), state: "(\w+)"/g));
  assert.ok(responses.length >= 4, `expected several response shapes, found ${responses.length}`);
  for (const [, success, state] of responses) {
    if (success === "false") {
      assert.notEqual(state, "sent",
        "a response that reports failure must never carry state \"sent\"");
    }
  }

  // And no internal detail reaches the customer.
  const messages = Array.from(route.matchAll(/message: ([A-Z_]+)/g)).map((m) => m[1]);
  assert.ok(messages.length > 0, "customer copy must come from named constants");
  for (const leak of [/error\.message/, /RESEND_API_KEY/, /process\.env/, /token/]) {
    assert.equal(new RegExp(`message: [^,]*${leak.source}`).test(route), false,
      `customer messages must not carry ${leak}`);
  }
});

// ── Enumeration ────────────────────────────────────────────────────────────

test("the resend endpoint never reveals account existence", () => {
  const route = code("app/api/beta/resend/route.ts");

  // No Auth lookup was added to implement this. The customer already told us
  // their stage by choosing "I'm still setting up"; that intent is sufficient.
  for (const lookup of [
    /auth\.admin\.listUsers/, /auth\.admin\.getUserById/, /getUserByEmail/,
    /from\("profiles"\)/, /hasAccount/, /accountExists/,
  ]) {
    assert.equal(lookup.test(route), false,
      `the public resend endpoint must not ${lookup}`);
  }

  // An address with no active verification — never applied, already used to
  // create an account, or long expired — must be answered EXACTLY as a
  // successful send is. Distinguishing them is the oracle.
  const lib = code("lib/beta-verification.ts");
  assert.match(lib, /status: "not_eligible"/);
  const notEligible = route.slice(route.indexOf('"not_eligible"'));
  assert.match(notEligible.slice(0, 400), /state: "sent"/,
    "a non-eligible address must receive the same answer as a sent one");
});

test("the resend email reuses the hardened URL resolver", () => {
  // No second URL-building path: a resent link must obey the same
  // Preview/production rules as the first one.
  const route = code("app/api/beta/resend/route.ts");
  assert.match(route, /sendBetaAccessEmail\(/);
  assert.equal(/requireAppBaseUrl|NEXT_PUBLIC_APP_URL|VERCEL_URL/.test(route), false,
    "the endpoint must not build its own origin");

  // And nothing request-derived may influence the destination.
  for (const derived of [/headers\(\)\.get\(["']host/, /request\.headers\.get\(["']origin/, /body\.(callback|redirect|url)/]) {
    assert.equal(derived.test(route), false, `the destination must not come from ${derived}`);
  }

  const email = code("lib/beta-access-email.ts");
  assert.match(email, /requireAppBaseUrl\(\)/);
});

// ── The journey it feeds ───────────────────────────────────────────────────

test("a resent token behaves exactly like a first-issued one", () => {
  // Same issuing helper, same hashing, same TTL — so the existing verification
  // route continues to work with no special case.
  const lib = code("lib/beta-verification.ts");
  const fn = lib.slice(lib.indexOf("export async function reissueVerification"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /hashToken\(/, "the resent token is stored hashed, like any other");
  assert.match(body, /expires_at/, "and carries the same expiry column");
  assert.equal(VERIFICATION_TTL_HOURS, 48);

  assert.ok(existsSync(join(ROOT, "app/api/beta/verify/route.ts")),
    "the verification route the resent link targets must still exist");
});

test("[static] the route file exports only what Next.js permits", () => {
  // A stray `export const RESEND_COOLDOWN = ...` compiled fine under tsc and
  // then failed `next build` with "not a valid Route export field" — a class
  // of error the type-checker cannot see, because Next validates route
  // exports separately during the build.
  const route = read("app/api/beta/resend/route.ts");
  const exported = Array.from(route.matchAll(/^export\s+(?:async\s+function|const|let|var)\s+(\w+)/gm))
    .map((m) => m[1]);

  const ALLOWED = new Set([
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
    "dynamic", "revalidate", "runtime", "preferredRegion", "maxDuration",
    "dynamicParams", "fetchCache", "generateStaticParams",
  ]);
  for (const name of exported) {
    assert.ok(ALLOWED.has(name),
      `"${name}" is not a valid Next.js Route export and will fail the build`);
  }
  assert.ok(exported.includes("POST"), "the endpoint must expose POST");
});

// ── Failure semantics: which token survives each path ──────────────────────

test("every compensating write checks its own error", () => {
  // THE STRANDING RULE: an address with at least one ACTIVE row can always
  // self-recover, because the next resend claims it once the cooldown passes.
  // An address with ZERO active rows cannot — every later resend finds nothing
  // to claim and answers `not_eligible`, which sends no email, forever.
  //
  // So every write that could remove the last active row must check whether it
  // worked. Fire-and-forget compensation is what creates the dead state.
  const lib = code("lib/beta-verification.ts");
  // Bounded by the NEXT top-level export, not by a brace pattern: restore()
  // is a nested arrow function, so "\n}\n" closes it long before the function
  // that owns it and the slice came back empty.
  const fnStart = lib.indexOf("export async function reissueVerification");
  assert.ok(fnStart > -1, "reissueVerification must exist");
  const next = lib.indexOf("\nexport ", fnStart + 10);
  const body = lib.slice(fnStart, next === -1 ? undefined : next);

  // Count the compensating updates and the error checks that guard them.
  const supersedeWrites = (body.match(/\.update\(\{ superseded_at/g) ?? []).length;
  assert.ok(supersedeWrites >= 4,
    `expected claim + retire + revive + undo, found ${supersedeWrites}`);

  for (const guarded of [
    /const \{ error: rollbackError \}/,  // insert failed → un-supersede the old
    /const \{ error: retireError \}/,    // restore → retire the new
    /const \{ error: reviveError \}/,    // restore → bring the old back
    /const \{ error: undoError \}/,      // revive failed → reinstate the new
  ]) {
    assert.match(body, guarded, `an unchecked compensating write remains: ${guarded}`);
  }

  // No write whose result is DISCARDED. Line-based, because a regex over the
  // whole statement also matched the claim — which does capture its error via
  // `const { data, error } = await admin...`. What distinguishes a discarded
  // result is the statement beginning with a bare `await`, with nothing bound.
  const discarded = body
    .split("\n")
    .filter((line) => /^\s*await admin\s*$/.test(line));
  assert.deepEqual(discarded, [],
    `a compensating write discards its error: ${discarded.join(" | ")}`);
});

test("restore never leaves the address with zero active rows", () => {
  const lib = code("lib/beta-verification.ts");
  const restore = lib.slice(lib.indexOf("const restore = async () => {"));
  const body = restore.slice(0, restore.indexOf("\n  };"));

  // If retiring the new row fails, stop: the new row stays active, which is
  // undelivered but recoverable after the cooldown.
  assert.match(body, /if \(retireError\) \{[\s\S]*?return;/,
    "a failed retire must abort rather than press on toward an empty state");

  // If reviving the old row fails, put the new one back rather than leaving
  // nothing active.
  const afterRevive = body.slice(body.indexOf("reviveError"));
  assert.match(afterRevive, /\.update\(\{ superseded_at: null \}\)[\s\S]{0,120}token_hash/,
    "a failed revive must reinstate the new row");

  // The one truly unrecoverable combination is escalated, not logged as noise.
  assert.match(body, /CRITICAL/, "the dead state must be escalated");
  assert.match(body, /manual re-issue/i, "and must say what it needs");
});

test("a thrown provider error cannot escape as an unhandled rejection", () => {
  // If sendBetaAccessEmail threw, the route's `await` would reject, restore()
  // would never run, and the customer would be left with a superseded old
  // token and an undelivered new one — recoverable, but the failure state
  // would be a 500 rather than the honest retry copy.
  const email = code("lib/beta-access-email.ts");
  const fn = email.slice(email.indexOf("export async function sendBetaAccessEmail"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  // Everything that can throw — rendering, the provider call — is inside the
  // try, and the catch returns false rather than rethrowing.
  assert.match(body, /try \{[\s\S]*?await render\(/, "rendering must be inside the try");
  assert.match(body, /await resend\.emails\.send\(/);
  assert.match(body, /\} catch \(err\) \{[\s\S]*?return false;/,
    "a thrown provider error must become `false`, not an exception");
  assert.equal(/throw /.test(body), false, "this function must never throw");
});

test("URL and provider misconfiguration are send failures, not crashes", () => {
  // A missing app origin and a missing provider key both return false BEFORE
  // the try block, so they reach the route's `!sent` branch and trigger the
  // same restore as a provider refusal.
  const email = code("lib/beta-access-email.ts");
  const fn = email.slice(email.indexOf("export async function sendBetaAccessEmail"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  const baseUrlGuard = body.indexOf("if (!baseUrl)");
  const providerGuard = body.indexOf("if (!resend)");
  const tryStart = body.indexOf("try {");
  assert.ok(baseUrlGuard > -1 && providerGuard > -1 && tryStart > -1);
  assert.ok(baseUrlGuard < tryStart && providerGuard < tryStart,
    "both configuration guards must precede the send attempt");
  assert.match(body.slice(baseUrlGuard, tryStart), /return false;/);
});
