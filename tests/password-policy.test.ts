import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  confirmationState,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  PASSWORD_RULE_ERROR,
  passwordProblems,
  isPasswordAcceptable,
  firstPasswordError,
  shouldSuggestLongerPassword,
  PASSWORD_COMFORTABLE_LENGTH,
} from "@/lib/password-policy";

/**
 * SC5 — the account password policy.
 *
 * The property that actually matters is not "does this regex work" but
 * "does every layer enforce the same thing". Before this module the signup
 * form checked five rules and the account route checked one, so the last two
 * tests here are structural: they assert that neither layer defines its own.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("the policy is exactly: 10 characters, uppercase, number, special", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.deepEqual(
    PASSWORD_RULES.map((r) => r.id),
    ["length", "uppercase", "number", "special"]
  );
  // No lowercase requirement. Its absence is a decision, not an omission, so
  // it is asserted rather than left to be quietly reintroduced.
  assert.equal(
    PASSWORD_RULES.some((r) => r.id === ("lowercase" as string)),
    false,
    "a lowercase rule must not be added without a decision"
  );
});

test("a password one character short is refused, however strong otherwise", () => {
  // 9 characters, uppercase + number + special all present.
  const nine = "Abcdefg1!";
  assert.equal(nine.length, 9);
  assert.deepEqual(passwordProblems(nine), ["length"], "only the length is wrong");
  assert.equal(isPasswordAcceptable(nine), false);
  // Adding one character — nothing else — makes it valid.
  assert.equal(isPasswordAcceptable(nine + "x"), true);
});

test("each missing character class is refused on its own", () => {
  // Each of these is 10+ and fails exactly ONE rule, so no test can pass by
  // accident because another rule happened to catch it.
  assert.deepEqual(passwordProblems("abcdefgh1!"), ["uppercase"], "no uppercase");
  assert.deepEqual(passwordProblems("Abcdefghi!"), ["number"], "no number");
  assert.deepEqual(passwordProblems("Abcdefghi1"), ["special"], "no special character");

  for (const p of ["abcdefgh1!", "Abcdefghi!", "Abcdefghi1"]) {
    assert.equal(isPasswordAcceptable(p), false);
    assert.notEqual(firstPasswordError(p), null);
  }
});

test("a valid password is accepted at the 10-character boundary and beyond", () => {
  const exactlyTen = "Abcdefgh1!";
  assert.equal(exactlyTen.length, 10, "the boundary case is genuinely 10 characters");
  assert.equal(isPasswordAcceptable(exactlyTen), true);
  assert.equal(firstPasswordError(exactlyTen), null);

  const longer = "CorrectHorseBattery9_Staple";
  assert.equal(isPasswordAcceptable(longer), true);
  assert.equal(firstPasswordError(longer), null);
});

test("a special character means any non-alphanumeric, not a curated list", () => {
  // An allow-list would shrink the attacker's search space while rejecting
  // perfectly good characters, so every one of these must be accepted.
  for (const symbol of ["!", "?", "@", "#", "£", "$", "%", "&", "*", "_", "-", "+", "~", " ", "€"]) {
    const candidate = `Abcdefgh1${symbol}`;
    assert.ok(candidate.length >= 10);
    assert.equal(
      isPasswordAcceptable(candidate),
      true,
      `"${symbol}" must count as a special character`
    );
  }
});

test("an empty password reports every unmet rule", () => {
  assert.deepEqual(passwordProblems(""), ["length", "uppercase", "number", "special"]);
});

test("a password with no lowercase letters is accepted", () => {
  // The policy does not require one; this pins that so a fifth rule cannot be
  // added silently.
  assert.equal(isPasswordAcceptable("ABCDEFGH1!"), true);
});

test("the first error names the most fundamental problem first", () => {
  assert.equal(firstPasswordError(""), PASSWORD_RULE_ERROR.length);
  assert.equal(firstPasswordError("abc"), PASSWORD_RULE_ERROR.length);
  assert.equal(firstPasswordError("abcdefgh1!"), PASSWORD_RULE_ERROR.uppercase);
  assert.equal(firstPasswordError("Abcdefghi!"), PASSWORD_RULE_ERROR.number);
  assert.equal(firstPasswordError("Abcdefghi1"), PASSWORD_RULE_ERROR.special);
  // The special-character message names examples rather than a rule the user
  // has to guess at.
  assert.match(PASSWORD_RULE_ERROR.special, /! \? @ # or £/);
  // Messages are actionable and never echo the submitted value.
  for (const message of Object.values(PASSWORD_RULE_ERROR)) {
    assert.match(message, /Password must/);
  }
});

test("the length suggestion is advice, never a gate", () => {
  // Only ever offered about a password that is ALREADY accepted.
  assert.equal(shouldSuggestLongerPassword("Abcdefgh1!"), true, "valid but only 10 characters");
  assert.equal(shouldSuggestLongerPassword("short"), false, "not offered about a refused password");
  assert.equal(shouldSuggestLongerPassword("Abcdefghij12!"), false, "already past the comfortable length");
  assert.ok(PASSWORD_COMFORTABLE_LENGTH > PASSWORD_MIN_LENGTH, "the hint must sit above the gate");
  // And it never changes acceptance.
  assert.equal(isPasswordAcceptable("Abcdefgh1!"), true);
});

test("[static] no layer defines its own password rules", () => {
  // /reset-password is included because it is where the drift actually
  // happened: it kept a private five-rule list long after the shared module
  // existed, so a user could reset to a password signup would have refused.
  const files = [
    "components/auth/SignupForm.tsx",
    "app/api/beta/account/route.ts",
    "app/reset-password/page.tsx",
  ];

  for (const relative of files) {
    const source = readFileSync(join(ROOT, relative), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    assert.match(
      code,
      /from "@\/lib\/password-policy"/,
      `${relative} must take the policy from the shared module`
    );
    // The specific patterns that used to encode a second, private policy.
    assert.equal(
      /\/\[A-Z\]\/|\/\[a-z\]\/|\/\[0-9\]\/|\/\[\^A-Za-z0-9\]\//.test(code),
      false,
      `${relative} must not re-implement a character-class rule`
    );
    // A MINIMUM-length rule specifically. `confirm.length > 0` and
    // `password.length === 0` are UI emptiness checks, not policy, so the
    // pattern targets an ordering comparison of the password against a
    // non-zero threshold — which is the only shape a private length rule
    // can take.
    assert.equal(
      /password\.length\s*[<>]=?\s*(?!0\b)\d/.test(code),
      false,
      `${relative} must not re-implement a minimum-length rule`
    );
  }
});

test("[static] the signup UI no longer shows unenforced rules or a contradictory meter", () => {
  const form = readFileSync(join(ROOT, "components/auth/SignupForm.tsx"), "utf8");
  const code = form.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Rule LABELS must come from the module, never be typed into the component.
  // These are the exact strings the old hardcoded list used.
  for (const gone of ["Lowercase letter", "Special character", "Number", "Minimum 8 characters"]) {
    assert.equal(code.includes(`"${gone}"`), false, `"${gone}" must not be hardcoded here`);
  }
  // A strength grade that could sit beneath a fully ticked checklist.
  for (const gone of ["Weak", "Fair", "Excellent"]) {
    assert.equal(code.includes(`"${gone}"`), false, `strength label "${gone}" must be gone`);
  }
  // Acceptance is stated in words.
  assert.match(code, /Password accepted/);
});


test("confirmation stays neutral until it genuinely cannot match", () => {
  const password = "Abcdefgh1!";

  // Empty is neutral, never an error.
  assert.equal(confirmationState(password, ""), "idle");

  // Every correct prefix stays neutral — the field must not go red while the
  // user is still typing the right thing.
  for (let i = 1; i < password.length; i++) {
    assert.equal(
      confirmationState(password, password.slice(0, i)),
      "idle",
      `prefix "${password.slice(0, i)}" must not be reported as a mismatch`
    );
  }

  // A genuine divergence is reported immediately, even mid-word.
  assert.equal(confirmationState(password, "Abcdefgh1?"), "mismatch");
  assert.equal(confirmationState(password, "X"), "mismatch");

  // An exact match is confirmed — including the password-manager case, where
  // both fields are filled at once.
  assert.equal(confirmationState(password, password), "match");

  // Longer than the password can never become a match.
  assert.equal(confirmationState(password, password + "x"), "mismatch");
});

test("[static] the signup form takes its confirmation rule from the module", () => {
  const code = readFileSync(join(ROOT, "components/auth/SignupForm.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.match(code, /confirmationState\(password, confirm\)/);
  // The inline ternary this replaced must not creep back.
  assert.equal(
    /password\.startsWith\(confirm\)/.test(code),
    false,
    "the prefix rule belongs in lib/password-policy.ts, not in the component"
  );
});
