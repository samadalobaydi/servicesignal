import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { buildInvoiceInsert } from "@/lib/invoice-create-payload";
import { formatAmountOnBlur } from "@/lib/invoice-input";
import { EMPTY_INVOICE_FORM } from "@/lib/invoice-form";
import type { InvoiceFormData } from "@/types";

/**
 * The Add Invoice payload — the defect that broke creation on a live Preview.
 *
 * The amount was read with parseFloat. The form's amount field formats on blur
 * through an Intl currency formatter, so the submitted value is "£1,500.00":
 *
 *     parseFloat("£1,500.00")          === NaN
 *     JSON.stringify({ amount: NaN })  === '{"amount":null}'
 *
 * PostgREST sent null into a NOT NULL column and every save failed. Validation
 * passed first, because validateInvoiceForm uses parseAmount — two parsers for
 * one field, only one of them correct.
 *
 * These tests run the REAL formatter into the REAL builder, so the pair cannot
 * drift apart again.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const form = (over: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  ...EMPTY_INVOICE_FORM,
  customer_name: "Dave Morrison",
  customer_email: "dave@example.co.uk",
  amount: "1500",
  due_date: "2026-09-01",
  ...over,
});

// ── The regression itself ──────────────────────────────────────────────────

test("a blurred, currency-formatted amount survives into the payload", () => {
  // Exactly what the field contains after the user tabs out of it.
  const displayed = formatAmountOnBlur("1500");
  assert.equal(displayed, "£1,500.00", "the formatter still produces currency text");

  const payload = buildInvoiceInsert(form({ amount: displayed }));
  assert.ok(payload, "a legitimate amount must not be rejected");
  assert.equal(payload!.amount, 1500);

  // The exact failure shape that reached production: NaN serialises to null.
  assert.equal(Number.isNaN(payload!.amount as number), false);
  assert.equal(JSON.parse(JSON.stringify(payload!)).amount, 1500);
});

test("every formatted amount round-trips, not just the round ones", () => {
  for (const [typed, expected] of [
    ["1500", 1500],
    ["950.5", 950.5],
    ["12345.67", 12345.67],
    ["0.99", 0.99],
    ["1,250", 1250],
    ["£340", 340],
  ] as const) {
    const displayed = formatAmountOnBlur(typed);
    const payload = buildInvoiceInsert(form({ amount: displayed }));
    assert.ok(payload, `"${typed}" → "${displayed}" was rejected`);
    assert.equal(payload!.amount, expected, `"${displayed}" parsed wrongly`);
  }
});

test("an unparseable amount is refused BEFORE the database, not as a null", () => {
  // The old path sent NaN and let Postgres reject it as an opaque constraint
  // violation. Refusing here means the customer gets a message about the
  // amount instead of "please try again".
  for (const bad of ["", "   ", "abc", "12.345", "-40", "0"]) {
    assert.equal(buildInvoiceInsert(form({ amount: bad })), null,
      `"${bad}" must not reach the database`);
  }
});

// ── The product rule ───────────────────────────────────────────────────────

test("invoice creation is independent of the founding-beta allowance", () => {
  // THE PRODUCT RULE: the 10-reminder cap governs whether a reminder may be
  // SENT. It has no bearing on whether an invoice may exist — a customer at
  // 10 / 10 must still be able to record what they are owed.
  //
  // Proven structurally: the creation path cannot consult something it does
  // not import, and the builder is pure, so there is nowhere else to hide a
  // check.
  const builder = readFileSync(join(ROOT, "lib/invoice-create-payload.ts"), "utf8");
  const code = builder.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of [/allowance/i, /exhausted/i, /beta/i, /claim_reminder/i, /remaining/i]) {
    assert.equal(forbidden.test(code), false,
      `the creation payload must not consult ${forbidden}`);
  }

  // And the same for the caller that submits it.
  const provider = readFileSync(join(ROOT, "components/dashboard/DashboardProvider.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const handler = provider.slice(provider.indexOf("const handleAddInvoice"));
  const body = handler.slice(0, handler.indexOf("}, []);"));
  for (const forbidden of [/allowance/i, /exhausted/i, /betaAllowance/]) {
    assert.equal(forbidden.test(body), false,
      `handleAddInvoice must not gate creation on ${forbidden}`);
  }

  // The payload builds identically no matter what: it takes only the form.
  assert.equal(buildInvoiceInsert.length, 1,
    "the builder takes the form and nothing else — no allowance argument");
});

// ── The two surfaces must agree ────────────────────────────────────────────

test("[static] both creation paths use parseAmount, never parseFloat", () => {
  // The onboarding path was always correct; the dashboard was not. A second
  // parser for one field is what caused this, so neither may reintroduce one.
  for (const f of ["lib/invoice-create-payload.ts", "lib/invoice-write.ts"]) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /parseAmount\(/, `${f} must parse the amount with parseAmount`);
    assert.equal(/parseFloat\(/.test(code), false,
      `${f} must not use parseFloat: it returns NaN for "£1,500.00"`);
  }

  // And no invoice-creating surface anywhere may parse an amount with it.
  const provider = readFileSync(join(ROOT, "components/dashboard/DashboardProvider.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/parseFloat\(\s*data\.amount/.test(provider), false,
    "the exact defect must not return");
});

test("[static] a failed insert is logged with enough detail to diagnose", () => {
  // "insertInvoice error: <message>" sent us looking in the wrong place. The
  // PostgrestError code, details and hint are what identify the failure.
  const code = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");
  const fn = code.slice(code.indexOf("export async function insertInvoice"));
  const body = fn.slice(0, fn.indexOf("\n}"));

  for (const field of ["code", "message", "details", "hint"]) {
    assert.match(body, new RegExp(`${field}: error\\.${field}`),
      `the log must include error.${field}`);
  }
  // Customer data must never be logged — keys only.
  assert.match(body, /payloadKeys: Object\.keys\(payload\)/);
  assert.equal(/JSON\.stringify\(payload\)/.test(body), false,
    "the payload's VALUES are customer data and must not be logged");
});
