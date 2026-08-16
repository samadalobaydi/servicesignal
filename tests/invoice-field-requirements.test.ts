import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { validateInvoiceForm, EMPTY_INVOICE_FORM } from "@/lib/invoice-form";
import type { InvoiceFormData } from "@/types";

/**
 * The UI and the validator must agree about what is mandatory.
 *
 * A required marker that nothing enforces is worse than no marker: it tells the
 * user a field matters, accepts the form without it, and leaves whoever reads
 * the code unsure which of the two is the real rule. This file executes the
 * ACTUAL validator rather than reading source, so the agreement is proven
 * rather than asserted.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIELDS = readFileSync(join(ROOT, "components/invoice/InvoiceFields.tsx"), "utf8");

/** A form good enough for the dashboard: no reference, no phone. */
const dashboardMinimum = (over: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
  ...EMPTY_INVOICE_FORM,
  customer_name: "Dave Morrison",
  customer_email: "dave@example.co.uk",
  amount: "1500.00",
  due_date: "2026-09-01",
  ...over,
});

// ── The dashboard's real rules ─────────────────────────────────────────────

test("dashboard accepts an invoice with no reference and no phone", () => {
  // The whole reason the dashboard is not simply the onboarding variant.
  // Invoices without either already exist in production; requiring them would
  // be a regression dressed up as a tightening.
  const errors = validateInvoiceForm(dashboardMinimum());
  assert.deepEqual(errors, {});
});

test("dashboard still enforces the four fields it marks required", () => {
  for (const [field, form] of [
    ["customer_name", dashboardMinimum({ customer_name: "  " })],
    ["customer_email", dashboardMinimum({ customer_email: "" })],
    ["amount", dashboardMinimum({ amount: "" })],
    ["due_date", dashboardMinimum({ due_date: "" })],
  ] as const) {
    const errors = validateInvoiceForm(form);
    assert.ok(errors[field], `${field} is marked required and must be validated`);
  }
});

test("onboarding — and only onboarding — requires reference and mobile", () => {
  const withoutBoth = dashboardMinimum({ due_date: "2020-01-01" });

  const dashboard = validateInvoiceForm(withoutBoth);
  assert.equal(dashboard.invoice_reference, undefined);
  assert.equal(dashboard.customer_phone, undefined);

  const onboarding = validateInvoiceForm(withoutBoth, { requireOnboardingFields: true });
  assert.ok(onboarding.invoice_reference, "onboarding requires a reference");
  assert.ok(onboarding.customer_phone, "onboarding requires a mobile number");
});

test("the onboarding-only rules are exactly three, and no more", () => {
  // ADDED AFTER A PROTOTYPE TRIED TO DROP ONE. Making the reference optional
  // may well be right, but it is a product decision about the Add Invoice
  // CONTRACT and must be taken on its own merits — not carried in as a side
  // effect of an onboarding redesign. This pins the rule set so any change to
  // it has to be deliberate and visible in a diff.
  const complete = dashboardMinimum({
    invoice_reference: "INV-1042",
    customer_phone: "07700 900000",
    due_date: "2020-01-01",
  });
  assert.deepEqual(validateInvoiceForm(complete, { requireOnboardingFields: true }), {});

  // Remove one rule's input at a time; exactly one error may appear each time.
  for (const [field, broken] of [
    ["invoice_reference", { invoice_reference: "" }],
    ["customer_phone", { customer_phone: "" }],
    // Onboarding ends on a reminder that exists NOW, so a schedule checkpoint
    // has to have been reached already.
    ["due_date", { due_date: "2099-01-01" }],
  ] as const) {
    assert.deepEqual(
      Object.keys(validateInvoiceForm({ ...complete, ...broken }, { requireOnboardingFields: true })),
      [field]
    );
  }
});

// ── The labels must match those rules ──────────────────────────────────────

test("[static] required markers are driven by the same flags as validation", () => {
  // requireReference / requirePhone mirror validateInvoiceForm's
  // requireOnboardingFields. Deriving both from the variant in ONE place is
  // what stops the label and the rule drifting apart.
  assert.match(FIELDS, /const requireReference = isOnboarding;/);
  assert.match(FIELDS, /const requirePhone = isOnboarding;/);

  // The two optional-on-dashboard fields must render their marker
  // conditionally, never as a bare "*".
  assert.match(FIELDS, /requireReference \? "Invoice reference \*" : <>Invoice reference <span className="opt">\(optional\)<\/span><\/>/);
  assert.match(FIELDS, /requirePhone \? "Mobile number \*" : <>Mobile number <span className="opt">\(optional\)<\/span><\/>/);

  // A hardcoded required marker on either would be the exact defect: a form
  // that claims a field is mandatory while the validator lets it through.
  assert.equal(/>Invoice reference \*</.test(FIELDS), false,
    "invoice reference must not be unconditionally marked required");
  assert.equal(/"Mobile number \*"(?!\s*:)/.test(FIELDS.replace(/requirePhone \? "Mobile number \*"/, "")), false,
    "mobile number must not be unconditionally marked required");
});

test("[static] a conditionally-required field is never hidden inside a disclosure", () => {
  // THE DEFECT THIS PREVENTS: the reference is required during onboarding, and
  // a prototype moved it into the collapsed optional section. Collapsible
  // UNMOUNTS its children when closed, so the field would have been invisible
  // to the person told to complete it and unreachable by the submit-time
  // focus-first-error rule, which searches the rendered DOM.
  //
  // Read from the SOURCE ORDER: the reference input must appear before the
  // first <Collapsible in the Invoice section.
  const referenceAt = FIELDS.indexOf('id="inv-reference"');
  const firstDisclosureAt = FIELDS.indexOf("<Collapsible");
  assert.ok(referenceAt > -1 && firstDisclosureAt > -1);
  assert.ok(referenceAt < firstDisclosureAt,
    "a field that can be required must render outside any collapsed section");

  // Source order alone is not enough — a mutant that simply hid the wrapper
  // survived this file until the check below was added. Nothing in the markup
  // enclosing the field may remove it from the accessibility tree or the
  // layout, which would reproduce the same defect a different way.
  const enclosing = FIELDS.slice(Math.max(0, referenceAt - 400), referenceAt);
  for (const concealed of [
    /\bhidden\b/, /display: ?"none"/, /className="[^"]*\b(hidden|invisible|sr-only)\b/,
    /visibility: ?"hidden"/, /aria-hidden=\{?true/,
  ]) {
    assert.equal(concealed.test(enclosing), false,
      `the invoice reference must not be concealed (${concealed})`);
  }
});

test("[static] every unconditional '*' label corresponds to an always-on rule", () => {
  // Collect labels that carry a literal asterisk with no conditional around it.
  const alwaysRequired = Array.from(
    FIELDS.matchAll(/htmlFor="inv-([\w-]+)">\s*\n?\s*\{?"?([^"<{}\n]*\*)"?\}?/g)
  ).map((m) => m[1]);

  // Map the DOM ids to the form fields the validator knows about.
  const BY_ID: Record<string, keyof InvoiceFormData> = {
    "customer-name": "customer_name",
    "customer-email": "customer_email",
    amount: "amount",
    "due-date": "due_date",
  };

  for (const id of alwaysRequired) {
    const field = BY_ID[id];
    assert.ok(field, `unexpected always-required field "inv-${id}" — add it to BY_ID or make its marker conditional`);
    const blank = dashboardMinimum({ [field]: "" } as Partial<InvoiceFormData>);
    assert.ok(validateInvoiceForm(blank)[field],
      `inv-${id} is labelled required but the dashboard validator accepts it empty`);
  }
});
