import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { isRegenerateEnabled } from "@/lib/regenerate-capability";

/**
 * The temporary production gate keeping Regenerate unavailable until
 * migration 013 is applied and verified. See lib/regenerate-capability.ts
 * for the full reasoning. Two enforcement points, tested separately:
 * isRegenerateEnabled() itself (real, executed) and the two call sites that
 * must each independently check it (static — Next.js route handlers and
 * server components aren't runtime-mockable in this suite, matching the
 * established convention elsewhere in this repository).
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

function withEnv(value: string | undefined, fn: () => void) {
  const original = process.env.REGENERATE_ENABLED;
  if (value === undefined) delete process.env.REGENERATE_ENABLED;
  else process.env.REGENERATE_ENABLED = value;
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env.REGENERATE_ENABLED;
    else process.env.REGENERATE_ENABLED = original;
  }
}

// ── isRegenerateEnabled(): the safer state is the default ──────────────────

test("[gate] disabled by default when REGENERATE_ENABLED is unset", () => {
  withEnv(undefined, () => {
    assert.equal(isRegenerateEnabled(), false);
  });
});

test("[gate] enabled only for the exact string 'true'", () => {
  withEnv("true", () => {
    assert.equal(isRegenerateEnabled(), true);
  });
});

test("[gate] every near-miss value stays disabled — no loose truthiness", () => {
  for (const value of ["TRUE", "True", "1", "yes", "on", "", " true", "true "]) {
    withEnv(value, () => {
      assert.equal(isRegenerateEnabled(), false, `REGENERATE_ENABLED=${JSON.stringify(value)} must NOT enable the feature`);
    });
  }
});

// ── Server-side (mandatory) enforcement: the API route ──────────────────────

test("[gate] [static] the route checks isRegenerateEnabled() BEFORE authenticating or calling regenerateReminder()", () => {
  const src = read("app/api/reminders/[id]/regenerate/route.ts");

  assert.match(src, /import \{ isRegenerateEnabled \} from "@\/lib\/regenerate-capability";/);

  const gateIdx = src.indexOf("if (!isRegenerateEnabled())");
  const authIdx = src.indexOf("auth.getUser()");
  // The actual invocation, not any mention of the name in a comment.
  const regenIdx = src.indexOf("await regenerateReminder(makeRegenerateDeps");

  assert.ok(gateIdx > -1, "the gate check must exist");
  assert.ok(gateIdx < authIdx, "the gate must run before the session is even looked up");
  assert.ok(gateIdx < regenIdx, "the gate must run before regenerateReminder() is ever called");

  // The disabled branch must return before falling through — a real early
  // return, not a flag merely computed and ignored.
  const gateBlock = src.slice(gateIdx, gateIdx + 300);
  assert.match(gateBlock, /return NextResponse\.json\(/, "disabled must return a response immediately, not continue");
  assert.match(gateBlock, /status: 503/);
});

test("[gate] [static] no other route calls regenerateReminder() unguarded", () => {
  // Exactly one call site in the whole application — the gated route. A
  // second, ungated caller would defeat this gate entirely regardless of
  // how carefully the first one is written.
  const appFiles = [
    "app/api/reminders/[id]/regenerate/route.ts",
  ];
  let occurrences = 0;
  for (const f of appFiles) occurrences += (read(f).match(/await regenerateReminder\(makeRegenerateDeps/g) ?? []).length;
  assert.equal(occurrences, 1, "exactly one call site in the whole app directory");
});

// ── UI courtesy: hidden, not just disabled, when the gate is off ───────────

test("[gate] [static] lib/reminder-review.ts computes regenerateEnabled from isRegenerateEnabled(), server-side", () => {
  const src = read("lib/reminder-review.ts");
  assert.match(src, /import \{ isRegenerateEnabled \} from "@\/lib\/regenerate-capability";/);
  assert.match(src, /regenerateEnabled:\s*isRegenerateEnabled\(\)/);
});

test("[gate] [static] the Regenerate button in the review panel is conditioned on data.regenerateEnabled", () => {
  const src = read("components/dashboard/ReminderReviewPanel.tsx");
  const bannerIdx = src.indexOf("Sender details changed");
  assert.ok(bannerIdx > -1);
  const afterBanner = src.slice(bannerIdx, bannerIdx + 1500);
  assert.match(
    afterBanner,
    /\{data\.regenerateEnabled && \(/,
    "the button must be wrapped in a data.regenerateEnabled check, not rendered unconditionally"
  );
});

// ── Scope discipline: nothing unrelated changed ─────────────────────────────

test("[gate] [static] identityDrifted continues to drive the Approve-button refusal independently of the gate", () => {
  // The gate controls the RECOVERY action's visibility only. It must never
  // weaken the pre-existing, unrelated refusal that keeps a drifted
  // reminder un-approvable regardless of whether Regenerate is enabled.
  const src = read("components/dashboard/ReminderReviewPanel.tsx");
  assert.match(
    src,
    /disabled=\{busy \|\| !data\.approvable \|\| staleReview \|\| allowanceExhausted \|\| identityDrifted\}/,
    "the Approve button's disabled expression must still include identityDrifted, unconditioned on the gate"
  );
});
