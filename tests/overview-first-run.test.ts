import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { isFirstRunOverview } from "@/lib/overview-first-run";
import type { Invoice } from "@/types";

/**
 * The Overview at zero invoices.
 *
 * Two things are worth proving, and only one of them is "the card appears".
 *
 * The other is that a POPULATED account never sees it. Every plausible wrong
 * detector — £0 unpaid, nothing overdue, no reminders, everything paid — has a
 * test below asserting it does NOT trigger first run, because showing an
 * activation screen to someone who has already activated is the most
 * patronising thing a dashboard can do, and it is the failure mode a naive
 * implementation lands on.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(join(ROOT, "app/dashboard/page.tsx"), "utf8");
const CARD = readFileSync(join(ROOT, "components/dashboard/FirstInvoiceActivation.tsx"), "utf8");
const CHROME = readFileSync(join(ROOT, "components/dashboard/DashboardChrome.tsx"), "utf8");

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE_CODE = strip(PAGE);
const CARD_CODE = strip(CARD);

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    invoice_reference: "INV-1042",
    customer_name: "Dave Morrison",
    customer_email: "dave@example.co.uk",
    amount: 1240,
    due_date: "2026-08-01",
    status: "unpaid",
    reminder_schedules: ["overdue_7_days"],
    reminders_sent: [],
    ...over,
  } as Invoice;
}

// ── The condition ──────────────────────────────────────────────────────────

test("zero invoices is first run", () => {
  assert.equal(isFirstRunOverview([]), true);
});

test("one invoice is not", () => {
  assert.equal(isFirstRunOverview([invoice()]), false);
});

test("an account with invoices is POPULATED, however quiet it looks", () => {
  // The semantic case, and the reason this is a function rather than an
  // inline condition. Each of these accounts would report £0 unpaid, nothing
  // overdue, nothing needing attention, and no reminders — and every one of
  // them has already done the thing the activation card teaches.
  const quiet: Array<[string, Invoice[]]> = [
    ["every invoice paid", [invoice({ status: "paid", paid_at: "2026-08-01T00:00:00Z" })]],
    ["a £0 invoice", [invoice({ amount: 0 })]],
    ["nothing overdue yet", [invoice({ status: "unpaid", due_date: "2027-01-01" })]],
    ["no reminder schedules chosen", [invoice({ reminder_schedules: [] })]],
    ["all of the above at once", [
      invoice({ id: "a", status: "paid", amount: 0, reminder_schedules: [] }),
      invoice({ id: "b", status: "paid", amount: 0, reminder_schedules: [] }),
    ]],
  ];

  for (const [label, invoices] of quiet) {
    assert.equal(isFirstRunOverview(invoices), false, label);
  }
});

test("[static] the detector cannot see any of the wrong signals", () => {
  const lib = readFileSync(join(ROOT, "lib/overview-first-run.ts"), "utf8");
  const code = strip(lib);

  // It takes invoices and nothing else, so consulting a proxy is not merely
  // discouraged — there is nothing in scope to consult.
  assert.match(code, /export function isFirstRunOverview\(invoices: readonly unknown\[\]\): boolean/);
  assert.match(code, /return invoices\.length === 0;/);

  for (const wrong of [
    /totalUnpaid/, /overdueCount/, /paidThisMonth/, /reminder/i, /allowance/i, /created_at/, /profile/i,
  ]) {
    assert.equal(wrong.test(code), false, `must not reference ${wrong}`);
  }
});

test("[static] the page uses the shared detector, not an inline count", () => {
  assert.match(PAGE_CODE, /isFirstRunOverview\(liveInvoices\)/);
  assert.match(PAGE_CODE, /\{!loading && firstRun \? \(/);

  // The old inline condition is gone, and no proxy replaced it.
  assert.equal(/hasInvoices/.test(PAGE_CODE), false);
  assert.equal(/stats\.totalUnpaid === 0|overdueCount === 0/.test(PAGE_CODE), false);
});

// ── What renders, and what does not ────────────────────────────────────────

test("[static] the dashboard furniture is inside the populated branch only", () => {
  // Everything that would report zeros must sit in the ELSE arm, after the
  // first-run return. Checking source order is the only way to assert this
  // without a renderer, and it is exactly what would regress if someone
  // hoisted a section out of the fragment.
  const branch = PAGE_CODE.indexOf("{!loading && firstRun ? (");
  const elseArm = PAGE_CODE.indexOf(") : (", branch);
  assert.ok(branch > -1 && elseArm > branch);

  const firstRunArm = PAGE_CODE.slice(branch, elseArm);
  assert.match(firstRunArm, /<FirstInvoiceActivation \/>/);

  const populated = PAGE_CODE.slice(elseArm);
  // Everything BEFORE the branch renders in BOTH states, so furniture hoisted
  // up there would show at zero invoices while sitting in neither slice below.
  // Checking only "is it in the populated arm" passed against exactly that.
  const alwaysRendered = PAGE_CODE.slice(0, branch);

  for (const furniture of [
    /<StatsCards/,           // Total unpaid / Overdue / Awaiting approval / Paid
    /Needs your attention/,
    /Coming up/,
    /<InvoiceStatusChart \/>/,
  ]) {
    assert.match(populated, furniture, `${furniture} belongs to the populated branch`);
    assert.equal(
      furniture.test(firstRunArm), false,
      `${furniture} must NOT render at zero invoices`
    );
    assert.equal(
      furniture.test(alwaysRendered), false,
      `${furniture} must not be hoisted above the branch — that renders it in BOTH states`
    );
    // And exactly once in the whole file, so a hoisted copy alongside the
    // original cannot hide behind the original still being in place.
    assert.equal(
      (PAGE_CODE.match(new RegExp(furniture.source, "g")) ?? []).length, 1,
      `${furniture} must appear exactly once`
    );
  }
});

test("[static] the heading survives first run, and the allowance is now in the shell", () => {
  const branch = PAGE_CODE.indexOf("{!loading && firstRun ? (");
  const above = PAGE_CODE.slice(0, branch);

  assert.match(above, /Overview\s*\n\s*<\/h1>/);
  assert.match(above, /Your invoices and reminders at a glance\./);

  // The allowance moved into the header, so it is no longer page content at
  // all — and therefore cannot become conditional on invoice count.
  assert.equal(/BetaAllowance/.test(PAGE_CODE), false);

  // It lives in the chrome, which renders identically in both states because
  // it sits outside the page entirely.
  assert.match(strip(CHROME), /<BetaAllowanceIndicator tone="light" \/>/);
  assert.equal(
    /firstRun|liveInvoices|invoices\.length/.test(strip(CHROME)), false,
    "the indicator must not depend on populated Overview content"
  );
});

test("[static] no dashboard filler was added to fill the space", () => {
  for (const filler of [
    /tips?/i, /testimonial/i, /sample (data|invoice)/i, /video/i,
    /upgrade/i, /illustration/i, /quick links/i, /<img/, /analytics/i,
  ]) {
    assert.equal(filler.test(CARD_CODE), false, `no ${filler}`);
  }
});

// ── The CTA reuses the real flow ───────────────────────────────────────────

test("[static] the CTA opens the SAME modal as the top bar", () => {
  // It was a <Link href="/dashboard/chasing"> — a page with no add-invoice
  // control on it, so the one action a new account exists to perform led
  // somewhere it could not be performed.
  assert.match(CARD_CODE, /useOpenAddInvoice/);
  assert.match(CARD_CODE, /onClick=\{openAddInvoice\}/);
  assert.equal(/href=/.test(CARD_CODE), false, "not a navigation");
  assert.equal(/\/dashboard\/chasing/.test(CARD_CODE), false, "and not the old dead end");

  // A <button>, because it opens a dialog rather than navigating.
  assert.match(CARD_CODE, /<button type="button"/);
});

test("[static] there is still exactly ONE AddInvoiceForm and one opener", () => {
  const chrome = strip(CHROME);

  // One form, one piece of state, one submit path.
  assert.equal((chrome.match(/<AddInvoiceForm/g) ?? []).length, 1);
  assert.equal((chrome.match(/useState\(false\)/g) ?? []).length, 1);
  assert.match(chrome, /const openAddInvoice = useCallback\(\(\) => setAddOpen\(true\), \[\]\)/);

  // Both existing triggers now call the shared opener, so the top bar's
  // behaviour is unchanged and cannot drift from the card's.
  assert.equal((chrome.match(/onClick=\{openAddInvoice\}/g) ?? []).length, 2,
    "desktop top bar and mobile floating button");
  assert.equal(/onClick=\{\(\) => setAddOpen\(true\)\}/.test(chrome), false);

  // The card is inside the provider.
  assert.match(chrome, /<AddInvoiceProvider value=\{openAddInvoice\}>/);
  assert.equal(/AddInvoiceForm/.test(CARD_CODE), false, "the card must not render its own form");
});

// ── Copy ───────────────────────────────────────────────────────────────────

test("[static] the copy stays true for a returning account with zero invoices", () => {
  // Someone can delete or archive everything and land back here after a year.
  assert.match(CARD_CODE, /Add an invoice to get started/);
  for (const newUserOnly of [
    /Welcome to ServiceSignal/i, /You'?re new here/i, /Let'?s set up/i,
    /first invoice/i, /get you started/i,
  ]) {
    assert.equal(newUserOnly.test(CARD_CODE), false, `assumes a new account: ${newUserOnly}`);
  }
});

test("[static] SMS and email are named together and equally", () => {
  assert.match(CARD_CODE, /SMS and email reminders/);
  assert.match(CARD_CODE, /writes the SMS and the email/);
  for (const banned of [/supporting email/i, /SMS-first/i, /primary channel/i, /richer/i]) {
    assert.equal(banned.test(CARD_CODE), false, `${banned}`);
  }
});

test("[static] no payment-processing or automation claims", () => {
  for (const banned of [
    /collect(s|ing)? (the )?payment/i, /take(s)? payment/i, /process(es)? payment/i,
    /chases? automatically/i, /sends? automatically/i, /automatic(ally)? send/i,
    /we'?ll send/i,
  ]) {
    assert.equal(banned.test(CARD_CODE), false, `${banned}`);
  }
  // The approval claim is scoped to these reminders, not made permanent —
  // Auto mode is a later mode, so an absolute promise would age into a lie.
  assert.match(CARD_CODE, /Check both messages, then send when you're ready\./);
  assert.equal(/nothing is ever sent/i.test(CARD_CODE), false);
});

// ── Accessibility ──────────────────────────────────────────────────────────

test("[static] heading hierarchy, list semantics and decorative icons", () => {
  // The page owns the h1; the card is a section beneath it.
  assert.match(PAGE_CODE, /<h1 /);
  assert.match(CARD_CODE, /<section className="dash-card ss-firstrun" aria-labelledby="ss-firstrun-h">/);
  assert.match(CARD_CODE, /<h2 id="ss-firstrun-h"/);
  assert.equal(/<h1/.test(CARD_CODE), false, "one h1 per page");

  // A sequence, marked up as one — so position is conveyed without the numeral.
  assert.match(CARD_CODE, /<ol className="ss-firstrun-steps">/);
  assert.match(CARD_CODE, /<li key=\{step\.title\}/);

  // The visible numeral and the plus icon carry no meaning of their own.
  assert.match(CARD_CODE, /<span className="ss-firstrun-num" aria-hidden="true">/);
  assert.match(CARD_CODE, /<svg[^>]*aria-hidden="true"/);

  // Every step's meaning is in text, not in the number.
  assert.match(CARD_CODE, /ss-firstrun-step-title/);
  assert.match(CARD_CODE, /ss-firstrun-step-text/);
});

test("[static] the first-run styles stack and stay tappable on mobile", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const block = css.slice(css.indexOf(".ss-firstrun {"));

  // Three columns crush the step text well before 640px.
  assert.match(block, /@media \(max-width: 900px\)[\s\S]*?\.ss-firstrun-steps \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\)/);
  // Full-width tap target rather than a shrunken one.
  assert.match(block, /@media \(max-width: 640px\)[\s\S]*?\.ss-firstrun-cta \{ width: 100%/);
  // No fixed widths that could overflow.
  assert.match(block, /minmax\(0, 1fr\)/);
  assert.match(block, /overflow-wrap: anywhere/);
});
