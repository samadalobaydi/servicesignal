import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { validateInvoiceForm, EMPTY_INVOICE_FORM } from "@/lib/invoice-form";
import { createInvoiceForUser } from "@/lib/invoice-write";
import { buildInvoiceInsert } from "@/lib/invoice-create-payload";
import { prepareEligibility, SCHEDULE_DAY } from "@/lib/reminder-schedule";
import { isValidIsoDate } from "@/lib/invoice-input";
import type { InvoiceFormData } from "@/types";

/**
 * Onboarding must adapt to the invoice lifecycle, not the other way round.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * Onboarding rejected any due date that was not already in the past:
 *
 *   "Use an invoice that is already overdue, so you can see a real reminder
 *    now."
 *
 * A customer joining with an invoice due next week was therefore asked either
 * to find a different invoice or to type a date that is not true, so the flow
 * could show off a preview. It also did not match the scheduler: `due_today`
 * is a real checkpoint (offset 0) and `before_due_3_days` is offset -3, so
 * invoices due today — and some due in three days — are eligible NOW and were
 * refused anyway.
 *
 * These tests execute the real validator, the real payload builders and the
 * real eligibility function against fixed dates.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FLOW = code("components/onboarding/OnboardingFlow.tsx");
const FIELDS = code("components/invoice/InvoiceFields.tsx");
const STATUS_ROUTE = code("app/api/onboarding/status/route.ts");

/** Fixed "today" so nothing here depends on the day the suite runs. */
const TODAY = new Date("2026-08-16T00:00:00Z");
const iso = (offsetDays: number): string => {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const form = (over: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  ...EMPTY_INVOICE_FORM,
  invoice_reference: "INV-1042",
  customer_name: "Dave Morrison",
  customer_email: "dave@example.co.uk",
  customer_phone: "07700 900000",
  amount: "1500.00",
  due_date: iso(-6),
  ...over,
});
const ONBOARDING = { requireOnboardingFields: true } as const;

// ── The real due date is always accepted ───────────────────────────────────

test("onboarding accepts overdue, due-today and future due dates alike", () => {
  for (const offset of [-30, -14, -7, -3, -1, 0, 1, 3, 7, 30, 365]) {
    assert.deepEqual(
      validateInvoiceForm(form({ due_date: iso(offset) }), ONBOARDING),
      {},
      `a due date ${offset} days from today must be accepted`
    );
  }
});

test("no copy assumes the invoice is already overdue", () => {
  // The heading was "Let's get your first overdue invoice ready." — false for
  // a customer joining with an invoice due next week, and the same pressure
  // the validator used to apply, just moved into the title.
  assert.match(FLOW, /Let&rsquo;s get your first invoice ready\./);
  assert.equal(/first overdue invoice/i.test(FLOW), false);

  // Past tense makes the same assumption more quietly.
  assert.equal(/when it was due/i.test(FLOW), false,
    "the due date may be in the future — 'was due' presumes otherwise");
  assert.match(FLOW, /when it&rsquo;s due/);

  // A checkpoint can be REACHED before the due date (before_due_3_days is
  // offset -3), so even the "ready now" sentence must not say "this overdue".
  const plan = code("lib/onboarding-schedule.ts");
  assert.equal(/an invoice this overdue/.test(plan), false);
  assert.match(plan, /an invoice at this stage/);
});

test("no wording anywhere asks the customer to change their invoice", () => {
  // The exact sentence that was removed, and the family it belonged to.
  for (const pressure of [
    /already overdue/i,
    /pick an earlier reminder day/i,
    /invoice that'?s already due/i,
    /so you can see a real reminder/i,
    /use an invoice that/i,
    /must (already )?be overdue/i,
    /choose a different invoice/i,
  ]) {
    for (const [name, src] of [["OnboardingFlow", FLOW], ["InvoiceFields", FIELDS],
                               ["invoice-form", code("lib/invoice-form.ts")]] as const) {
      assert.equal(pressure.test(src), false, `${name} still pressures the customer: ${pressure}`);
    }
  }

  // The due-date helper is now identical on both surfaces.
  const helper = FIELDS.slice(FIELDS.indexOf('id="inv-due-date-help"'));
  assert.equal(/isOnboarding/.test(helper.slice(0, 300)), false,
    "the due-date help must not vary by surface");
});

test("the option that enforced the restriction no longer exists", () => {
  // Deleted, not merely unset. An option left in place is one flag away from
  // returning, and this one could reject a customer's real data.
  for (const f of [
    "lib/invoice-form.ts", "lib/invoice-write.ts", "lib/invoice-input.ts",
    "components/invoice/useInvoiceForm.ts", "components/onboarding/OnboardingFlow.tsx",
    "app/api/onboarding/invoices/route.ts",
  ]) {
    assert.equal(/requireReminderEligibility|checkOnboardingDueDate/.test(code(f)), false,
      `${f} must not reference the removed restriction`);
  }
});

// ── But a due date still has to be a real date ─────────────────────────────

test("a malformed due date is rejected on BOTH surfaces", () => {
  // The browser can never submit one — ukDateToIso commits nothing else — but
  // an API caller can, and before this the server accepted anything.
  for (const bad of [
    "not-a-date", "2026-13-01", "2026-02-31", "16/08/2026", "2026-8-1",
    "2026-08-16T00:00:00Z", " 2026-08-16", "20260816",
  ]) {
    assert.equal(isValidIsoDate(bad), false, `${bad} is not a valid ISO date`);
    assert.ok(validateInvoiceForm(form({ due_date: bad }))["due_date"],
      `the dashboard must reject ${bad}`);
    assert.ok(validateInvoiceForm(form({ due_date: bad }), ONBOARDING)["due_date"],
      `onboarding must reject ${bad}`);
  }

  // Leap day 2028 is real; 2027 is not.
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate("2027-02-29"), false);

  assert.ok(validateInvoiceForm(form({ due_date: "" }), ONBOARDING).due_date);
});

// ── Due today: the existing product rule, preserved ────────────────────────

test("due today is a real checkpoint and is eligible today", () => {
  // ESTABLISHED FROM CODE, not assumed. getInvoiceDueStatus calls diff === 0
  // "due_today" (neither overdue nor upcoming), SCHEDULE_DAY.due_today is 0,
  // and scheduleToPrepare admits any checkpoint whose offset <= days-from-due.
  // So an invoice due today with the default plan can be prepared today.
  assert.equal(SCHEDULE_DAY.due_today, 0);

  const eligibility = prepareEligibility(
    EMPTY_INVOICE_FORM.reminder_schedules, [], iso(0), TODAY
  );
  assert.equal(eligibility.schedule, "due_today");

  // And the validator does not stand in the way.
  assert.deepEqual(validateInvoiceForm(form({ due_date: iso(0) }), ONBOARDING), {});
});

test("eligibility follows the checkpoints, not the sign of the date", () => {
  const schedules = EMPTY_INVOICE_FORM.reminder_schedules;

  // Future, nothing reached — the Case B ending.
  const future = prepareEligibility(schedules, [], iso(10), TODAY);
  assert.equal(future.schedule, null);
  assert.equal(future.blockedReason, "not_yet_due");
  assert.equal(future.eligibleFrom, iso(10), "the due date itself is the first checkpoint");

  // A FUTURE invoice that IS eligible today, which the old overdue rule would
  // have refused: Firm includes before_due_3_days at offset -3.
  const firm = prepareEligibility(
    ["before_due_3_days", "due_today", "overdue_3_days"], [], iso(3), TODAY
  );
  assert.equal(firm.schedule, "before_due_3_days");

  // Overdue picks the furthest-along reached checkpoint — unchanged.
  assert.equal(prepareEligibility(schedules, [], iso(-9), TODAY).schedule, "overdue_7_days");
});

// ── The invoice is stored exactly as entered ───────────────────────────────

test("a future due date reaches the database unchanged", async () => {
  const future = iso(21);
  const data = form({ due_date: future });

  const browserRow = buildInvoiceInsert(data);
  assert.equal(browserRow?.due_date, future);

  let serverRow: Record<string, unknown> | null = null;
  const fake = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        serverRow = row;
        return { select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }) };
      },
    }),
  };
  const result = await createInvoiceForUser(fake as never, data, ONBOARDING);

  assert.equal(result.ok, true, "the onboarding route must accept a future-dated invoice");
  assert.ok(serverRow);
  assert.equal((serverRow as Record<string, unknown>).due_date, future,
    "the real due date must be stored, never adjusted to suit onboarding");
  assert.deepEqual(serverRow, browserRow);

  // No reminder state is written at creation, on either surface.
  for (const key of ["status", "reminders_sent", "reminder_log", "prepared_at"]) {
    assert.equal(key in (serverRow as Record<string, unknown>), false);
    assert.equal(key in browserRow!, false);
  }
});

// ── Nothing is prepared prematurely ────────────────────────────────────────

test("preparation is attempted only when a checkpoint has been reached", () => {
  const submit = FLOW.slice(FLOW.indexOf("const submitInvoice"));

  // The decision is made from the SAVED invoice by the shared function — not
  // from the form, and not from anything onboarding would prefer.
  assert.match(submit, /const eligibility = prepareEligibility\(\s*invoice\.reminder_schedules[\s\S]{0,120}invoice\.due_date/);

  // The ineligible branch returns BEFORE prepareAndReview is reached.
  const guard = submit.indexOf("if (!eligibility.schedule)");
  const prepare = submit.indexOf("await prepareAndReview(");
  assert.ok(guard > -1 && prepare > guard, "the guard must come before preparation");
  const branch = submit.slice(guard, prepare);
  assert.match(branch, /await completeWithoutReminder\(\{/);
  assert.match(branch, /return;/);
  assert.equal(/\/api\/reminders\/prepare/.test(branch), false,
    "an ineligible invoice must never hit the prepare endpoint");

  // And nothing fabricates preview content for it.
  assert.equal(/setPreview\(\{[^}]*sms:/.test(FLOW), false,
    "preview content must only ever come from the server");
});

test("a future-dated invoice is never told a reminder is ready to review", () => {
  const added = FLOW.slice(FLOW.indexOf("step === 4 && added"));
  // Whitespace collapsed — JSX wraps sentences across lines.
  const screen = added.slice(0, added.indexOf("step === 3 && preview")).replace(/\s+/g, " ");

  assert.match(screen, />Invoice added</);
  assert.match(screen, /formatDate\(added\.eligibleFrom\)/);
  assert.match(screen, /formatDate\(added\.dueDate\)/);

  // The heading is the outcome, and it is stated ONCE. An eyebrow above it
  // ("Step complete") labelled the same state a second time, and the rail
  // already reads "Added".
  assert.equal(/styles\.eyebrow/.test(screen), false,
    "the added state must carry no eyebrow");
  const headings = screen.match(/<h1 /g) ?? [];
  assert.equal(headings.length, 1);

  // The two sentences, exactly. "The same day" rather than the date repeated.
  assert.match(screen,
    /It&rsquo;s due on \{formatDate\(added\.dueDate\)\}\. Your first reminder is scheduled for the same day\./);
  assert.match(screen,
    /It&rsquo;s due on \{formatDate\(added\.dueDate\)\}\. Your first reminder is scheduled for \{formatDate\(added\.eligibleFrom\)\}\./);
  // The two are chosen by comparing the dates, not by anything else.
  assert.match(screen, /added\.eligibleFrom === added\.dueDate \?/);

  for (const lie of [
    /ready (to|for) review/i, /ready now/i, /we'?ve sent/i, /has been sent/i,
    /reminder is ready/i, /approve/i,
  ]) {
    assert.equal(lie.test(screen), false, `the added state must not claim: ${lie}`);
  }

  // NOT re-explained here. The invoice step has already said ServiceSignal
  // prepares both, with symmetrical wording; repeating it on the outcome
  // screen re-teaches what a reminder is to someone who has just been told.
  assert.equal(/SMS/.test(screen), false, "the added state must not re-list the channels");
  assert.equal(/email/i.test(screen), false);

  // So the equality guarantee is asserted where the claim is actually made.
  assert.match(FLOW, /prepares the SMS and the email/);
});

test("the added state promises no future action ServiceSignal might not take", () => {
  const added = FLOW.slice(FLOW.indexOf("step === 4 && added"));
  // Whitespace collapsed: JSX wraps a sentence across lines, so "is scheduled"
  // can arrive as "is\n  scheduled" and a literal match silently fails on a
  // formatting change rather than a meaning change.
  const screen = added.slice(0, added.indexOf("step === 3 && preview")).replace(/\s+/g, " ");

  // WHAT WENT WRONG: it said "We'll prepare the SMS and the email on 6
  // September, ready for you to review." Unconditional, and the action is
  // conditional — allowancePreflight already refuses the Prepare control at
  // 10 / 10, and the daily job skips an invoice since paid, archived, or
  // without a deliverable customer email.
  for (const promise of [
    /we'?ll prepare/i, /we will prepare/i, /we'?ll send/i, /you'?ll (get|receive)/i,
    /will be prepared/i, /guarantee/i,
  ]) {
    assert.equal(promise.test(screen), false,
      `the added state must not promise a conditional action: ${promise}`);
  }

  // What it says instead is a property of the plan stored on their invoice:
  // due date + SCHEDULE_DAY offset. True whether or not anything happens.
  assert.match(screen, /is scheduled/,
    "state the schedule, which is fixed, rather than our action, which is not");

  // The remedy must NOT be a disclaimer. Someone who has just added their
  // first invoice should not be reading about caps and billing.
  for (const heavy of [
    /allowance/i, /\b10 ?\/ ?10\b/, /remaining/i, /upgrade/i, /subject to/i,
    /founding beta/i, /limit/i, /as long as/i, /provided that/i,
  ]) {
    assert.equal(heavy.test(screen), false,
      `truthfulness must come from claiming less, not from a disclaimer: ${heavy}`);
  }

  // Short. Three branches of one sentence, one heading, one eyebrow, one CTA.
  assert.ok(screen.split("\n").length < 60, "the added state must stay small");

  // The allowance is genuinely enforced where it belongs, which is why this
  // screen does not need to mention it.
  assert.match(code("app/api/reminders/prepare/route.ts"), /allowancePreflight\(/);

  // The progress label follows the outcome rather than asserting one.
  assert.match(FLOW, /const secondStepLabel = step === 4 \? "Added" : "Ready to review";/);
});

test("an overdue invoice still reaches the real reminder review", () => {
  const submit = FLOW.slice(FLOW.indexOf("const submitInvoice"));
  assert.match(submit, /await prepareAndReview\(invoice\.id\)/);
  // Step 3 still renders the real ReminderReview against server-composed
  // content, unchanged by this pass.
  assert.match(FLOW, /step === 3 && preview \? \(\s*<ReminderReview/);
  assert.match(code("components/onboarding/ReminderReview.tsx"), /Go to Active Chasing/);
});

// ── Recording the outcome ──────────────────────────────────────────────────

test("completion without a reminder is re-verified by the server", () => {
  // The client sends only an invoice id. If the server took that on trust,
  // a caller could skip the review entirely for an ELIGIBLE invoice.
  assert.match(FLOW, /recordStatus\("completed", \{ invoice_id: payload\.invoiceId \}\)/);

  // SCOPED to the reminder-less branch. An unscoped slice ran to the end of
  // the file and matched the reminder_logs query's own ownership check, so it
  // passed with the invoice query's check deleted.
  const start = STATUS_ROUTE.indexOf("if (!body.reminder_id) {");
  const branch = STATUS_ROUTE.slice(start, STATUS_ROUTE.indexOf("} else {", start));
  assert.ok(branch.length > 0 && branch.length < STATUS_ROUTE.length - start);

  assert.match(branch, /\.from\("invoices"\)/);
  assert.match(branch, /\.eq\("id", body\.invoice_id\)\s*\.eq\("user_id", context\.user\.id\)/,
    "the invoice must be proven to belong to the caller, not just to exist");
  assert.match(branch, /prepareEligibility\(\s*invoice\.reminder_schedules[\s\S]{0,120}invoice\.due_date/,
    "eligibility must be re-derived from STORED values");
  assert.match(branch, /if \(eligibility\.schedule\) \{[\s\S]{0,600}status: 422/,
    "an eligible invoice must NOT be completable without its reminder");

  // The reminder-paired path is untouched and still demands a reviewable one.
  assert.match(STATUS_ROUTE, /const ACCEPTABLE = new Set\(\["pending", "sent"\]\)/);
  assert.match(STATUS_ROUTE, /\.from\("reminder_logs"\)/);
  // Terminal states are still terminal.
  assert.match(code("lib/onboarding.ts"), /completed: \[\],\s*exempt: \[\],/);
});

// ── Case B completion lifecycle ────────────────────────────────────────────

/** The body of completeWithoutReminder, which owns this whole lifecycle. */
const completeBody = (() => {
  const start = FLOW.indexOf("const completeWithoutReminder = useCallback");
  assert.ok(start > -1, "completeWithoutReminder must exist");
  return FLOW.slice(start, FLOW.indexOf("\n  );", start));
})();

test("a future invoice is completed on save, not on the CTA click", () => {
  // THE FAILURE THIS PREVENTS: the PATCH used to hang off "Go to Active
  // Chasing". A customer who closed the tab on that screen left a real invoice
  // behind with the status still `required` — so the dashboard gate sent them
  // back to a BLANK onboarding form, where the obvious thing to do is enter
  // the same invoice a second time.
  const submit = FLOW.slice(FLOW.indexOf("const submitInvoice"));
  const branch = submit.slice(
    submit.indexOf("if (!eligibility.schedule)"),
    submit.indexOf("await prepareAndReview(")
  );
  assert.match(branch, /await completeWithoutReminder\(\{/,
    "the outcome must be recorded as part of reaching it");

  // Recorded BEFORE the success state is shown, in that order.
  const call = completeBody.indexOf('recordStatus("completed"');
  const show = completeBody.indexOf("setStep(4)");
  assert.ok(call > -1 && show > call, "setStep(4) must follow the successful write");
  assert.match(completeBody, /if \(result\.ok\) \{[\s\S]{0,300}?setStep\(4\)/,
    "step 4 is reachable ONLY from a successful record");

  // And nowhere else may reach it.
  const advances = FLOW.match(/setStep\(4\)/g) ?? [];
  assert.equal(advances.length, 1, "there must be exactly one route into the added state");
});

test("closing the Invoice added screen cannot leave onboarding `required`", () => {
  // `added` is what the success screen renders from, and it is set in the
  // same block as the successful write — so the screen cannot exist while the
  // status is unrecorded. Nothing after this point is load-bearing.
  const setters = FLOW.match(/setAdded\(/g) ?? [];
  assert.equal(setters.length, 1, "exactly one place may declare the setup finished");
  assert.match(completeBody, /if \(result\.ok\) \{[\s\S]{0,120}?setAdded\(payload\)/);

  assert.match(FLOW, /step === 4 && added \?/,
    "the success screen must be gated on the recorded payload");
});

test("Go to Active Chasing is navigation only", () => {
  const start = FLOW.indexOf("const goToAddedInvoice = useCallback");
  const cta = FLOW.slice(start, FLOW.indexOf("\n  }", start));

  assert.match(cta, /router\.push\(`\/dashboard\/chasing\?/);
  for (const decides of [/finish\(/, /recordStatus\(/, /\/api\/onboarding\/status/, /"completed"/]) {
    assert.equal(decides.test(cta), false,
      `the CTA must not determine completion (${decides})`);
  }
  // Not async, so nothing can be awaited before leaving.
  assert.match(FLOW, /const goToAddedInvoice = useCallback\(\(\) => \{/,
    "the CTA must not be an async handler");

  // Rendered without a busy guard, because there is nothing in flight.
  const added = FLOW.slice(FLOW.indexOf("step === 4 && added"));
  const screen = added.slice(0, added.indexOf("step === 3 && preview"));
  assert.match(screen, /<button type="button" className=\{styles\.primary\} onClick=\{goToAddedInvoice\}>/);
  assert.equal(/disabled=\{busy\}/.test(screen), false);
});

test("an invoice that becomes eligible mid-flow recovers into review", () => {
  // THE RACE: the added screen can sit open across the invoice's first
  // checkpoint — most obviously over midnight. The server re-derives
  // eligibility on every reminder-less completion, so it now finds a schedule
  // and refuses. Correctly. The customer must not be stranded by that.
  //
  // The server says so in a machine-readable way, and ONLY for this refusal.
  assert.match(STATUS_ROUTE, /reason: "eligible_now"/);
  const reasons = STATUS_ROUTE.match(/reason: "/g) ?? [];
  assert.equal(reasons.length, 1, "only the recoverable refusal may be discriminable");

  // The client turns it into the legitimate path rather than an error.
  assert.match(completeBody, /if \(result\.eligibleNow\) \{[\s\S]{0,300}?await prepareAndReview\(payload\.invoiceId\)/,
    "recovery is the real preparation and review, not a dead end");
  const recover = completeBody.slice(completeBody.indexOf("if (result.eligibleNow)"));
  assert.equal(/setStep\(4\)|setAdded\(/.test(recover), false,
    "recovery must NOT present the added state — there is a reminder to review now");

  // And the recovery is not a bypass: prepareAndReview ends on step 3, whose
  // forward action records completion with the full reminder evidence.
  assert.match(FLOW, /finish\(\s*"completed",[\s\S]{0,200}\{ invoice_id: preview\.invoiceId, reminder_id: preview\.reminderId \}/);

  // Any OTHER failure keeps the invoice and re-offers the write — never a
  // blank form, which is how a duplicate invoice gets created.
  assert.match(completeBody, /setPendingCompletion\(payload\)/);
  assert.match(FLOW, /pendingCompletion \? \([\s\S]{0,700}?onClick=\{retryCompletion\}/);
  const retryStart = FLOW.indexOf("pendingCompletion ? (");
  const retryScreen = FLOW.slice(retryStart, FLOW.indexOf("pendingInvoiceId ? (", retryStart));
  assert.match(retryScreen, />Your invoice is saved</);
  assert.equal(/Invoice added/.test(retryScreen), false,
    "an unrecorded setup must not be presented as complete");
  assert.equal(/<InvoiceFields/.test(retryScreen), false,
    "the form must stay retired while a saved invoice exists");
});

test("omitting reminder_id can never bypass review for an eligible invoice", () => {
  // The recovery path exists BECAUSE the server refuses, so the refusal has to
  // stay absolute. Unchanged and re-asserted here.
  const start = STATUS_ROUTE.indexOf("if (!body.reminder_id) {");
  const branch = STATUS_ROUTE.slice(start, STATUS_ROUTE.indexOf("} else {", start));

  assert.match(branch, /prepareEligibility\(/);
  assert.match(branch, /if \(eligibility\.schedule\) \{[\s\S]{0,600}status: 422/);
  // No early exit that could skip the check.
  const check = branch.indexOf("prepareEligibility(");
  assert.equal(/return NextResponse\.json\(\s*\{\s*success: true/.test(branch.slice(0, check)), false,
    "nothing may succeed before eligibility has been re-derived");
  // Derived from STORED values only — never from the request body.
  assert.equal(/body\.(due_date|reminder_schedules|eligible)/.test(branch), false,
    "the client must not be able to supply the inputs to its own check");

  // The reminder-paired path is untouched and still demands a reviewable one.
  assert.match(STATUS_ROUTE, /const ACCEPTABLE = new Set\(\["pending", "sent"\]\)/);
});

// ── Allowance and Skip are untouched ───────────────────────────────────────

test("adding a future invoice consumes no reminder allowance", () => {
  // The allowance is claimed at PREPARATION/SEND time and nowhere else — by
  // the cron after inserting a reminder_logs row, and by /api/reminders/prepare
  // behind allowancePreflight. A future invoice reaches neither today.
  for (const f of [
    "lib/invoice-create-payload.ts", "lib/invoice-write.ts",
    "app/api/onboarding/invoices/route.ts", "components/onboarding/OnboardingFlow.tsx",
    "app/api/onboarding/status/route.ts",
  ]) {
    assert.equal(/claim_reminder_allowance|allowancePreflight|claimAllowance/.test(code(f)), false,
      `${f} must not touch the allowance`);
  }
  assert.match(code("app/api/reminders/prepare/route.ts"), /allowancePreflight\(/);
});

test("Skip is unaffected by any of this", () => {
  const skip = FLOW.slice(FLOW.indexOf("const skip = useCallback"));
  const body = skip.slice(0, skip.indexOf("\n  }"));
  assert.match(body, /finish\("skipped"\)/);
  for (const write of [
    /\/api\/onboarding\/invoices/, /\/api\/reminders\/prepare/, /setStep\(4\)/, /setAdded\(/,
  ]) {
    assert.equal(write.test(body), false, `Skip must not ${write}`);
  }
});

test("the dashboard Add Invoice contract is unchanged by this pass", () => {
  // Its four required fields, and its acceptance of everything else.
  const dashboardMinimum: InvoiceFormData = {
    ...EMPTY_INVOICE_FORM,
    customer_name: "Dave Morrison",
    customer_email: "dave@example.co.uk",
    amount: "1500.00",
    due_date: iso(45),
  };
  assert.deepEqual(validateInvoiceForm(dashboardMinimum), {},
    "no reference, no phone, future date — all still fine");

  for (const field of ["customer_name", "customer_email", "amount", "due_date"] as const) {
    assert.ok(validateInvoiceForm({ ...dashboardMinimum, [field]: "" })[field]);
  }

  // The drawer never enabled the onboarding rules and still does not.
  const drawer = code("components/dashboard/AddInvoiceForm.tsx");
  assert.equal(/requireOnboardingFields/.test(drawer), false);
  assert.match(drawer, /useInvoiceForm\(editing && initial \? \{ initial \} : \{\}\)/);
});
