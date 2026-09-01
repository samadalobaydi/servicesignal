import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  allowancePreflight,
  ALLOWANCE_EXHAUSTED_STATE,
  allowanceExhaustedMessage,
} from "@/lib/allowance-preflight";
import { FOUNDING_BETA_ALLOWANCE } from "@/lib/beta-allowance";

/**
 * Allowance-exhausted preparation behaviour.
 *
 * THE PRODUCT RULE, restated because these tests defend it:
 *   - an invoice may always exist, be edited, marked paid, archived or deleted;
 *   - the 10-reminder cap governs SENDING;
 *   - but ServiceSignal should not create a draft it already knows it cannot
 *     send.
 *
 * The atomic send-time claim remains the authoritative cap. Everything here is
 * UX protection layered above it.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A Supabase stand-in returning a fixed slot count. */
const ledger = (count: number | null, error?: string) => ({
  from() {
    return {
      select: async () => ({ count, error: error ? { message: error } : null }),
    };
  },
}) as never;

// ── The pre-flight itself ──────────────────────────────────────────────────

test("the pre-flight reports exhausted only at the cap", async () => {
  for (const used of [0, 1, 9]) {
    const r = await allowancePreflight(ledger(used));
    assert.equal(r.known, true);
    assert.equal(r.exhausted, false, `${used}/10 is not exhausted`);
  }
  const at = await allowancePreflight(ledger(FOUNDING_BETA_ALLOWANCE));
  assert.equal(at.exhausted, true);
  assert.equal(at.used, 10);
  assert.equal(at.allowance, 10);
});

test("the pre-flight FAILS OPEN when the ledger cannot be read", async () => {
  // A pre-flight that fails closed would refuse legitimate work on a transient
  // error, on behalf of a cap that is still enforced atomically at send time.
  // Failing open costs at most one draft the send claim then declines.
  for (const broken of [ledger(null), ledger(null, "connection reset")]) {
    const r = await allowancePreflight(broken);
    assert.equal(r.known, false, "an unreadable ledger must not be treated as known");
    assert.equal(r.exhausted, false, "and must never be reported as exhausted");
  }
});

test("the refusal copy is truthful and promises no billing", () => {
  const msg = allowanceExhaustedMessage(10, 10);
  assert.match(msg, /10 of 10/);
  assert.match(msg, /invoices are unaffected/i, "must say the invoice still exists");
  for (const banned of [/upgrade/i, /billing/i, /plan\b/i, /pricing/i, /buy/i, /coming soon/i]) {
    assert.equal(banned.test(msg), false, `no fake CTA: ${banned}`);
  }
  assert.equal(ALLOWANCE_EXHAUSTED_STATE, "allowance_exhausted");
});

// ── The server guard ───────────────────────────────────────────────────────

test("[static] the user-triggered prepare route refuses when exhausted", () => {
  const route = strip(read("app/api/reminders/prepare/route.ts"));

  assert.match(route, /allowancePreflight\(supabase\)/,
    "the route must consult the shared pre-flight");
  assert.match(route, /state: ALLOWANCE_EXHAUSTED_STATE/,
    "the refusal must be a named state, not prose");

  // Scoped to the refusal helper. The route has other 409s (not yet eligible,
  // already sent), so an unscoped match passed even with this one changed to
  // a 500 — the exact mutant that slipped through first time.
  const start = route.indexOf("const refuseForAllowance");
  assert.ok(start > -1, "the refusal helper must exist");
  // Bounded by the arrow function's own closing `);`. Comments are already
  // stripped, so a comment-based boundary would return -1 and slice to the end
  // of the file — which is how the first version of this assertion matched an
  // unrelated 500 and let the mutant through.
  const end = route.indexOf("\n    );", start);
  assert.ok(end > start, "could not bound the refusal helper");
  const helper = route.slice(start, end);
  assert.match(helper, /status: 409/,
    "the allowance refusal is a capability answer, not a fault");
  assert.equal(/status: 5\d\d/.test(helper), false,
    "an exhausted allowance must never be reported as a server error");

  // Guarded at BOTH creation branches: a fresh insert, and reviving a
  // dismissed/failed row — which also produces a sendable draft.
  const guards = route.match(/if \(preflight\.known && preflight\.exhausted\) return refuseForAllowance\(\);/g) ?? [];
  assert.equal(guards.length, 2,
    `both creation paths must be guarded, found ${guards.length}`);

  // `preflight.known &&` is what makes it fail open. Without it an unreadable
  // ledger would block preparation entirely.
  assert.equal(/if \(preflight\.exhausted\) return/.test(route), false,
    "the guard must require preflight.known — otherwise it fails closed");
});

test("[static] an already-prepared reminder is never blocked or destroyed", () => {
  const route = strip(read("app/api/reminders/prepare/route.ts"));

  // The pending early-return must come BEFORE any allowance refusal: that
  // reminder is already prepared and already counted, so returning it consumes
  // nothing and must keep working at 10/10.
  const pendingReturn = route.indexOf('alreadyPending: true');
  const firstGuard = route.indexOf("return refuseForAllowance();");
  assert.ok(pendingReturn > -1 && firstGuard > pendingReturn,
    "an existing pending reminder must be returned before the allowance guard");

  // Nothing in this pass may delete or dismiss a reminder because of the cap.
  for (const destructive of [/\.delete\(\)/, /status: "dismissed"/]) {
    assert.equal(destructive.test(route), false,
      `the prepare route must not ${destructive} — exhaustion is not cleanup`);
  }
});

// ── The scheduled path is DELIBERATELY unchanged ───────────────────────────

test("[static] the daily run still prepares, and that is deliberate", () => {
  // ── WHY THE SCHEDULER WAS NOT CHANGED ─────────────────────────────────
  //
  // The cron selects work with `todaysSchedule(invoice.due_date, today)` — a
  // TODAY-ONLY trigger. There is no catch-up pass: if a checkpoint is skipped,
  // the next run computes a different day and that checkpoint is never
  // revisited.
  //
  // So skipping preparation while exhausted would PERMANENTLY lose the
  // checkpoint. If the cap were later raised, the owner could never send the
  // reminder that was silently dropped. Today's behaviour instead leaves a
  // pending draft that becomes sendable the moment capacity exists.
  //
  // A dead-end draft is recoverable. A missed checkpoint is not.
  const cron = read("app/api/cron/send-reminders/route.ts");
  assert.match(cron, /todaysSchedule\(invoice\.due_date, today\)/,
    "the today-only trigger is the reason this path is left alone");

  const code = strip(cron);
  assert.equal(/allowancePreflight/.test(code), false,
    "the scheduled path must NOT skip preparation while exhausted");

  // ...and the authoritative send-time claim must still be there.
  assert.match(code, /claim_reminder_allowance/,
    "the atomic send-time cap must remain");
  assert.match(code, /outcome === "exhausted"/,
    "an exhausted claim must still stop the send");
});

// ── The UI ─────────────────────────────────────────────────────────────────

test("[static] Active Chasing hides Prepare Reminder and says why", () => {
  const list = read("components/dashboard/ActiveChasingList.tsx");
  const code = strip(list.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));

  // Same source as the header indicator — no second definition.
  assert.match(code, /useBetaAllowance\(\)/);
  assert.match(code, /allowanceExhausted\(allowance\)/);
  assert.match(code, /allowance !== null && allowanceExhausted\(allowance\)/,
    "a null (still loading) count must not be treated as spent");

  // The action is HIDDEN, not disabled.
  assert.match(code, /!hasPending && canPrepare && !allowanceSpent/);
  assert.equal(/disabled=\{allowanceSpent/.test(code), false,
    "a greyed-out primary button invites a click and explains nothing");

  // The state column carries the meaning, in the header's restrained language.
  //
  // reminderStateLabel() itself now lives in lib/reminder-state-label.ts, not
  // in this component — pulled out so it can be unit-tested directly (a
  // .tsx file with JSX cannot be imported into this project's plain
  // `node --test` runner). The row-level wiring checked above stays here;
  // the label function's own content is checked against its real source.
  const label = strip(read("lib/reminder-state-label.ts"));
  assert.match(label, /text: "Reminder limit reached"/);
  assert.match(label, /"Reminder limit reached", color: "var\(--dash-navy\)", pill: true, tone: "slate"/,
    "light navy/slate, matching the header — no amber or red");

  // Only replaces states that would otherwise invite preparation, and only
  // after hasPending — a reminder prepared before the cap stays reviewable.
  const fn = label.slice(label.indexOf("export function reminderStateLabel"));
  const pendingAt = fn.indexOf('"Ready for review"');
  const spentAt = fn.indexOf('"Reminder limit reached"');
  assert.ok(pendingAt > -1 && spentAt > pendingAt,
    "hasPending must be checked before the exhausted state");
  assert.match(fn.slice(0, spentAt + 200), /allowanceSpent && canPrepare/,
    "only eligible-to-prepare rows change");
});

test("[static] everything else on the row survives exhaustion", () => {
  const code = strip(read("components/dashboard/ActiveChasingList.tsx"));

  // Mark Paid, the lifecycle menu and history are outside the guarded branch.
  const action = code.slice(code.indexOf("function ChaseRowAction"));
  const markPaid = action.indexOf("Mark Paid");
  const guard = action.indexOf("!allowanceSpent");
  assert.ok(markPaid > -1 && guard > -1 && markPaid > guard,
    "Mark Paid must sit outside the allowance-guarded block");
  assert.equal(/allowanceSpent[^)]*Mark Paid/.test(action), false,
    "Mark Paid must never be gated on the allowance");

  for (const kept of [/\{menu\}/, /InvoiceRowMenu/, /HistoryToggle/]) {
    assert.match(code, kept, `${kept} must remain available at 10/10`);
  }
});

test("[static] invoice creation remains independent of the allowance", () => {
  // The rule this whole pass is built around: the cap must never reach the
  // creation path.
  for (const f of ["lib/invoice-create-payload.ts", "lib/invoice-write.ts"]) {
    const code = strip(read(f));
    for (const forbidden of [/allowance/i, /exhausted/i, /preflight/i]) {
      assert.equal(forbidden.test(code), false,
        `${f} must not consult ${forbidden}: an invoice may always exist`);
    }
  }
});

// ── House style: the limit state is slate, overdue stays red ───────────────

test("[static] 'Reminder limit reached' uses the locked slate tokens, never amber", () => {
  // THE DEFECT: both pill render sites hardcoded an inline amber style object,
  // so the state's own colour was ignored and the founding-beta cap rendered
  // as a warning. Amber is not a structural colour in this dashboard.
  const list = read("components/dashboard/ActiveChasingList.tsx");
  const code = strip(list.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));
  const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // The state itself — see the note above about why this now lives in its
  // own plain .ts module rather than inline in the component.
  const label = strip(read("lib/reminder-state-label.ts"));

  // The state declares a tone; the render site no longer decides the colour.
  assert.match(label, /tone: "slate"/, "the limit state must be slate-toned");
  assert.equal(/"Reminder limit reached"[^}]*amber/.test(label), false,
    "the limit state must not carry any amber");

  // Neither pill site may hardcode colours again.
  assert.equal(/background: "var\(--dash-amber-soft\)"/.test(code), false,
    "pill colours belong to the class, not to two duplicated inline objects");
  const pillSites = code.match(/dash-state-pill dash-state-pill--\$\{rs\.tone \?\? "amber"\}/g) ?? [];
  assert.equal(pillSites.length, 2,
    `both the card and the table must use the shared pill, found ${pillSites.length}`);

  // The slate tone reuses the EXACT tokens the Overview badge uses — no third
  // near-duplicate blue.
  const slate = css.slice(css.indexOf(".dash-state-pill--slate {"));
  const slateBlock = slate.slice(0, slate.indexOf("}"));
  assert.match(slateBlock, /background: var\(--dash-navy-soft\)/);
  assert.match(slateBlock, /color: var\(--dash-navy\)/);
  assert.equal(/amber/.test(slateBlock), false, "no amber in the slate tone");

  const badge = css.slice(css.indexOf(".ss-beta-badge {"));
  const badgeBlock = badge.slice(0, badge.indexOf("}"));
  for (const token of ["--dash-navy-soft", "--dash-navy)"]) {
    assert.ok(badgeBlock.includes(token) && slateBlock.includes(token),
      `${token} must be shared with the Overview badge, not duplicated`);
  }
});

test("[static] Overdue: the redundant badge is gone, the semantic red date line is not", () => {
  const list = read("components/dashboard/ActiveChasingList.tsx");
  const code = strip(list.replace(/\{\/\*[\s\S]*?\*\/\}/g, ""));

  // THE DELIBERATE CHANGE (this pass): the Due column already says both the
  // date and "2 days overdue", in red — an "Overdue" badge in the Status
  // column repeated the identical fact a second time for the single most
  // common state on this page. statusBadgeFor() (lib/status-badge.ts — see
  // tests/status-badge.test.ts for real, executed coverage of the decision
  // itself) now returns null for "overdue" rather than a same-meaning badge.
  assert.match(code, /statusBadgeFor\(status\)/, "StatusBadge must consult the shared decision, not its own map");

  // What the badge redundantly repeated is UNCHANGED and still red: the
  // days-overdue text in the Due column is the one surviving indicator.
  assert.match(code, /inv\.status === "overdue" \? "var\(--dash-red\)"/,
    "the days-overdue text must stay red");
  assert.equal(/overdue[^;]*--dash-navy/.test(code), false,
    "overdue must not be recoloured slate");

  // "Ready for review" is a real call to action and keeps amber. The state
  // itself now lives in lib/reminder-state-label.ts — see the note above.
  const label = strip(read("lib/reminder-state-label.ts"));
  assert.match(label, /"Ready for review", color: "var\(--dash-amber\)", pill: true, tone: "amber"/);

  // Behaviour untouched: the same guard, the same source of truth.
  assert.match(code, /!hasPending && canPrepare && !allowanceSpent/);
  assert.match(code, /allowance !== null && allowanceExhausted\(allowance\)/);
  assert.match(code, /useBetaAllowance\(\)/);
});
