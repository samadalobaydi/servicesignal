import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { validateInvoiceForm, EMPTY_INVOICE_FORM } from "@/lib/invoice-form";
import { buildInvoiceInsert } from "@/lib/invoice-create-payload";
import { createInvoiceForUser } from "@/lib/invoice-write";
import type { InvoiceFormData } from "@/types";

/**
 * The first-run onboarding experience.
 *
 * These pin BEHAVIOURAL contracts, not appearance. The three that matter most
 * are the ones a redesign is most likely to break quietly: that Skip creates
 * nothing, that this surface has not grown its own invoice-creation logic, and
 * that adding an invoice never touches the founding-beta reminder allowance.
 *
 * lib/onboarding.ts cannot be imported here — it pulls in next/headers through
 * getSupabaseServer — so its rules are asserted against the executable source
 * with comments stripped first. Comments must never satisfy an assertion; this
 * repository has been caught by that at least five times.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Strips {/* *\/} JSX comments, /* *\/ blocks and // lines, in that order. */
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const FLOW = code("components/onboarding/OnboardingFlow.tsx");
const PAGE = code("app/onboarding/page.tsx");
const FIELDS = code("components/invoice/InvoiceFields.tsx");
/**
 * Comments stripped here too. This file's own header EXPLAINS the colour it
 * replaced by naming it, so asserting against the raw stylesheet would have
 * failed on the very prose describing the fix — and, worse, would have passed
 * later on a comment that mentioned a token the rules no longer used.
 */
const CSS = read("components/onboarding/onboarding.module.css")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const ONBOARDING_LIB = code("lib/onboarding.ts");

/** The body of a named function or arrow constant, to the next top-level close. */
function bodyOf(src: string, marker: string): string {
  const start = src.indexOf(marker);
  assert.ok(start > -1, `expected to find ${marker}`);
  const rest = src.slice(start);
  const end = rest.indexOf("\n  }");
  return rest.slice(0, end > -1 ? end : rest.length);
}

// ── Do not ask twice ───────────────────────────────────────────────────────

test("onboarding never asks for information the account already holds", () => {
  // Business name: the server decides whether the prerequisite is needed at
  // all, from the canonical profile value. The bug this replaced was a client
  // that always rendered step 1 with the name pre-filled — which is a
  // confirmation screen for something nobody asked to confirm.
  assert.match(PAGE, /const needsBusinessName = isBusinessNameBlank\(businessName\)/);
  assert.match(FLOW, /useState<1 \| 2 \| 3 \| 4>\(needsBusinessName \? 1 : 2\)/,
    "the flow must open on the invoice step when the name is known");

  // Email: displayed as a fact, never collected. No input may bind to it.
  assert.equal(/<input[^>]*value=\{email\}/.test(FLOW), false,
    "the signed-in address must not be re-entered");
  assert.match(FLOW, /Signed in as \{email\}/);

  // And nothing else from signup reappears as a question. These are the
  // account-owner fields; every input on this screen is about their CUSTOMER.
  for (const forbidden of [
    /id="ob-email"/, /id="ob-password"/, /type="password"/,
    /Your (mobile|phone)/i, /Trade\b/, /Company size/i, /VAT/i,
  ]) {
    assert.equal(forbidden.test(FLOW), false,
      `onboarding must not ask for ${forbidden}`);
  }
});

test("customer fields are unambiguously about the CUSTOMER", () => {
  // "Name" and "Phone" alone would read as the account owner's on a screen
  // reached seconds after signup.
  assert.match(FIELDS, /Customer name \*/);
  assert.match(FIELDS, /htmlFor="inv-customer-phone"/);
  assert.match(FIELDS, /htmlFor="inv-customer-email"/);
  assert.match(FIELDS, /<p className="section-legend">\{"Customer"\}<\/p>/);
});

// ── Skip ───────────────────────────────────────────────────────────────────

test("Skip creates no invoice and prepares no reminder", () => {
  const skip = bodyOf(FLOW, "const skip = useCallback");

  for (const write of [
    /\/api\/onboarding\/invoices/, /\/api\/reminders\/prepare/,
    /createInvoice/, /buildInvoiceInsert/, /method: "POST"/,
  ]) {
    assert.equal(write.test(skip), false,
      `Skip must not ${write} — skipping means "take me in, I'll add one later"`);
  }
  assert.match(skip, /finish\("skipped"\)/,
    "Skip records the decision it actually is, never `completed`");
});

test("Skip is a visible control on every screen, and is never dressed as a risk", () => {
  const labels = Array.from(FLOW.matchAll(/className=\{styles\.skip\}[\s\S]{0,220}?>\s*([^<]+?)\s*</g))
    .map((m) => m[1].replace(/&rsquo;/g, "'").trim());
  assert.ok(labels.length >= 3, `every screen needs an escape route, found ${labels.length}`);

  // A real bordered button beside the primary, not a grey underlined footnote.
  assert.match(CSS, /\.skip \{[^}]*border: 1px solid var\(--dash-border-strong\)/,
    "Skip must look like a control");
  assert.equal(/\.skip \{[^}]*text-decoration: underline/.test(CSS), false);
  assert.match(CSS, /\.skip \{[^}]*min-height: 46px/, "Skip must meet the touch target minimum");

  // No guilt, no warning, no confirmation dialog on the way out.
  for (const guilt of [
    /are you sure/i, /you'?ll miss/i, /don'?t you want/i, /lose (your|access)/i,
    /without (setting up|finishing)/i,
  ]) {
    assert.equal(guilt.test(FLOW), false, `Skip must not ${guilt}`);
  }
  const skipCall = bodyOf(FLOW, "const skip = useCallback");
  assert.equal(/confirm\(|window\.confirm|setShowSkipConfirm/.test(skipCall), false,
    "skipping must not open a confirmation");
});

// ── The reminder allowance is untouched by this surface ────────────────────

test("neither adding an invoice nor skipping consumes the founding-beta allowance", () => {
  // The allowance governs whether a reminder may be SENT. Onboarding sends
  // nothing: it saves an invoice and PREPARES content for review. A customer
  // at 10 / 10 must still be able to record what they are owed.
  const surfaces = [
    "components/onboarding/OnboardingFlow.tsx",
    "app/api/onboarding/invoices/route.ts",
    "lib/invoice-create-payload.ts",
  ];
  for (const f of surfaces) {
    const src = code(f);
    for (const allowance of [
      /claimAllowance/, /consumeAllowance/, /allowance-claim/, /beta-allowance/,
      /remindersRemaining/, /allowanceUsed/,
    ]) {
      assert.equal(allowance.test(src), false,
        `${f} must not touch the allowance (${allowance})`);
    }
  }

  // And onboarding must not imply a cost to the customer either.
  for (const implied of [
    /uses? one of your \d+/i, /counts? towards/i, /remaining/i, /\d+ ?\/ ?10/,
  ]) {
    assert.equal(implied.test(FLOW), false,
      `onboarding must not suggest adding an invoice spends the allowance (${implied})`);
  }
});

// ── One invoice-creation contract, not two ─────────────────────────────────

test("both surfaces run the same form state and the same validator", () => {
  // Layer 1 — FORM STATE. One hook, so field-clearing, preset resolution,
  // amount formatting and re-seeding behave identically.
  const drawer = code("components/dashboard/AddInvoiceForm.tsx");
  for (const src of [drawer, FLOW]) {
    assert.match(src, /from "@\/components\/invoice\/useInvoiceForm"/);
    assert.match(src, /useInvoiceForm\(/);
    assert.match(src, /from "@\/components\/invoice\/InvoiceFields"/);
  }
  assert.match(drawer, /<InvoiceFields state=\{state\} variant="dashboard" \/>/);
  assert.match(FLOW, /<InvoiceFields[\s\S]{0,200}variant="onboarding"/);

  // Layer 2 — VALIDATION. The hook is the only client-side caller, so neither
  // surface can hand-roll a rule.
  const hook = code("components/invoice/useInvoiceForm.ts");
  assert.match(hook, /validateInvoiceForm\(form, \{/);
  assert.match(hook, /normaliseInvoiceForm\(form\)/);
  for (const src of [drawer, FLOW]) {
    assert.equal(/validateInvoiceForm\(/.test(src), false,
      "a surface that validates for itself is a second rule set");
  }

  // Layer 3 — SERVER VALIDATION. The onboarding route re-runs the SAME
  // function, so the browser's messages and the server's rules agree.
  assert.match(code("lib/invoice-write.ts"), /validateInvoiceForm\(form, \{/);
  assert.match(code("app/api/onboarding/invoices/route.ts"), /createInvoiceForUser\(/);
});

test("the two payload builders produce byte-identical inserts", () => {
  // ── THE HONEST GAP ──────────────────────────────────────────────────────
  //
  // Layer 4 is NOT shared. There are two payload builders, because the two
  // surfaces write through different clients:
  //
  //   dashboard   buildInvoiceInsert  → browser client, PostgREST under RLS
  //   onboarding  createInvoiceForUser → server session client, same role
  //
  // Collapsing them would mean either shipping the server write to the
  // browser or routing every dashboard save through an endpoint — neither is
  // a change an onboarding pass should make. So instead of claiming a sharing
  // that does not exist, this EXECUTES both against one form and requires the
  // rows to match exactly. Divergence fails here rather than in production,
  // which is where the parseFloat("£1,500.00") → null defect was found.
  const form: InvoiceFormData = {
    ...EMPTY_INVOICE_FORM,
    invoice_reference: "  INV-1042  ",
    job_description: "  Boiler repair  ",
    customer_name: "  Dave Morrison  ",
    customer_email: "  dave@example.co.uk  ",
    customer_phone: "  07700 900000  ",
    // Currency-formatted, exactly as the field leaves it on blur.
    amount: "£1,500.00",
    due_date: "2020-01-01",
    payment_link: "  https://pay.example/inv  ",
  };

  const browserRow = buildInvoiceInsert(form);
  assert.ok(browserRow, "the browser builder must accept a formatted amount");

  let serverRow: Record<string, unknown> | null = null;
  const fakeSupabase = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        serverRow = row;
        return { select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }) };
      },
    }),
  };

  return createInvoiceForUser(
    fakeSupabase as never,
    form,
    { requireOnboardingFields: true }
  ).then((result) => {
    assert.equal(result.ok, true, "the shared validator must accept this form");
    assert.ok(serverRow);
    assert.deepEqual(serverRow, browserRow,
      "the dashboard and onboarding must insert exactly the same row");
    // Named explicitly, so a column added to one builder alone fails loudly
    // rather than passing a comparison of two identically-wrong objects.
    assert.deepEqual(Object.keys(browserRow!).sort(), [
      "amount", "customer_email", "customer_name", "customer_phone", "due_date",
      "invoice_reference", "job_description", "payment_link",
      "reminder_schedules", "reminder_tone",
    ]);
    // Owned by the database or a later trusted transition — never the client.
    for (const forbidden of ["status", "user_id", "reminders_sent", "id", "paid_at", "archived_at"]) {
      assert.equal(forbidden in browserRow!, false, `${forbidden} must not be client-supplied`);
    }
  });
});

test("no second invoice-form implementation exists", () => {
  // A guard, NOT proof of sharing — the tests above are that. This only
  // catches the coarsest failure: somebody copying the inputs into a new file.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  const formOwners = walk(join(ROOT, "components"))
    .filter((f) => /\.tsx$/.test(f))
    .filter((f) => /id="inv-customer-name"/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length));
  assert.deepEqual(formOwners, ["components/invoice/InvoiceFields.tsx"]);
  assert.equal(existsSync(join(ROOT, "components/onboarding/OnboardingInvoiceForm.tsx")), false);
});

test("the payment-link default is opt-in, and onboarding did not invent it", () => {
  // AUDITED, NOT ASSUMED: `git log -S onSaveAsDefaultChange` puts this in
  // 1218d3b, before any onboarding redesign. It is pre-existing behaviour.
  //
  // The dashboard drawer passes no handler, so the checkbox does not render
  // there at all — this remains an onboarding-only control, unchanged.
  const drawer = code("components/dashboard/AddInvoiceForm.tsx");
  assert.equal(/onSaveAsDefaultChange/.test(drawer), false);

  // Four independent guards, all of which must hold before an account setting
  // can change. The first is the user's own tick.
  assert.match(FIELDS,
    /\{onSaveAsDefaultChange &&\s*form\.payment_link\.trim\(\)\.startsWith\("https:\/\/"\) &&\s*form\.payment_link\.trim\(\) !== \(savedPaymentLink \?\? ""\)/,
    "the control may not even appear unless it would do something");
  assert.match(FIELDS, /type="checkbox"\s*checked=\{saveAsDefault\}/);
  // Scoped to THIS state. An unscoped /useState\(false\)/ matched half a dozen
  // unrelated flags in this file and passed with the default flipped to true —
  // which would have changed an account setting nobody asked to change.
  assert.match(FLOW, /const \[saveAsDefault, setSaveAsDefault\] = useState\(false\);/,
    "the account default must never be pre-ticked");
  assert.match(FLOW, /if \(\s*saveAsDefault &&\s*linkToSave\.startsWith\("https:\/\/"\) &&\s*linkToSave !== \(savedPaymentLink \?\? ""\)\s*\)/,
    "the write is re-checked at submit, not trusted from render time");

  // It runs AFTER the invoice exists, so a failed save never leaves a changed
  // account default behind — and a failure is reported, not swallowed.
  const submit = FLOW.slice(FLOW.indexOf("const submitInvoice"));
  assert.ok(submit.indexOf("/api/onboarding/invoices") < submit.indexOf("default_payment_link"));
  assert.match(FLOW, /setDefaultLinkWarning\(/);

  // And the field itself is optional and clearly labelled so.
  assert.match(FIELDS, /Payment link <span className="opt">\(optional\)<\/span>/);
});

test("the fields the brief requires are the fields the validator enforces", () => {
  const base = (over: Partial<InvoiceFormData> = {}): InvoiceFormData => ({
    ...EMPTY_INVOICE_FORM,
    customer_name: "Dave Morrison",
    customer_email: "dave@example.co.uk",
    customer_phone: "07700 900000",
    amount: "1500.00",
    due_date: "2020-01-01",
    // Required by the EXISTING Add Invoice contract during onboarding. A pass
    // on this surface proposed dropping it; that is a separate product
    // decision about the invoice contract and is not taken here.
    invoice_reference: "INV-1042",
    ...over,
  });
  const opts = { requireOnboardingFields: true } as const;

  assert.deepEqual(validateInvoiceForm(base(), opts), {});

  for (const field of
    ["customer_name", "customer_email", "customer_phone", "amount", "due_date", "invoice_reference"] as const) {
    assert.ok(validateInvoiceForm(base({ [field]: "" }), opts)[field],
      `${field} is required by the brief and must be enforced`);
  }

  // Payment link: optional, and validated only when supplied.
  assert.deepEqual(validateInvoiceForm(base({ payment_link: "" }), opts), {});
  assert.ok(validateInvoiceForm(base({ payment_link: "http://x.example" }), opts).payment_link);
});

test("validation preserves everything the customer typed", () => {
  // The form data is READ, never rewritten, when validation fails — an invalid
  // amount that got cleared would be the cruellest possible response to a typo.
  const hook = code("components/invoice/useInvoiceForm.ts");
  const validate = bodyOf(hook, "const validateAndGet = useCallback");
  assert.match(validate, /setErrors\(found\)/);
  assert.equal(/setForm\(|reset\(\)/.test(validate), false,
    "validation must not touch the entered values");

  // Executable proof that the validator itself is non-mutating.
  const form: InvoiceFormData = { ...EMPTY_INVOICE_FORM, amount: "not a number", customer_name: "  Dave  " };
  const before = JSON.stringify(form);
  validateInvoiceForm(form, { requireOnboardingFields: true });
  assert.equal(JSON.stringify(form), before);

  // And the first rejected field receives focus, found from the DOM rather
  // than a hand-kept list that a reordered field would silently break.
  assert.match(FLOW, /const first =[\s\S]{0,120}querySelector<HTMLElement>\('\[aria-invalid="true"\]'\)/);
  assert.match(FLOW, /if \(!data\) \{\s*focusFirstError\(\);/);
});

// ── SMS and email are equal ────────────────────────────────────────────────

test("neither channel is presented as the main one", () => {
  // Symmetrical helper text, side by side, same treatment.
  assert.match(FIELDS, /Used for SMS reminders\./);
  assert.match(FIELDS, /Used for email reminders\./);

  for (const ranked of [
    /SMS is (also|coming|being)/i, /email as well/i, /primary channel/i,
    /backed up by (SMS|email)/i, /and an? (SMS|email) too/i,
  ]) {
    assert.equal(ranked.test(FLOW) || ranked.test(FIELDS), false,
      `channels must not be ranked (${ranked})`);
  }

  // The onboarding promise names both, in one breath.
  assert.match(FLOW, /prepares the SMS and the email/);
});

// ── Claims the product must never make ─────────────────────────────────────

test("onboarding never claims ServiceSignal handles money", () => {
  for (const f of ["components/onboarding/OnboardingFlow.tsx", "components/invoice/InvoiceFields.tsx",
                   "components/onboarding/ReminderReview.tsx"]) {
    const src = code(f);
    for (const claim of [
      /we (take|collect|process|receive|hold) (the )?payment/i,
      /payments? (are|is) processed/i, /we'?ll know when.{0,20}pai/i,
      /automatically mark.{0,20}paid/i, /detect.{0,20}payment/i,
    ]) {
      assert.equal(claim.test(src), false, `${f} must not claim ${claim}`);
    }
  }
  // The positive statement, which is the true one.
  assert.match(FIELDS, /Customers pay you directly — ServiceSignal never handles the money\./);
});

test("no permanent product-wide approval guarantee survives on this surface", () => {
  // Approval-before-send is a FOUNDING BETA behaviour. Auto mode is planned,
  // so an absolute forward-looking promise here would become a lie shipped in
  // a screen nobody would think to revisit.
  for (const f of ["components/onboarding/OnboardingFlow.tsx", "components/onboarding/ReminderReview.tsx"]) {
    const src = code(f);
    for (const absolute of [
      /\bnever\b[^.]{0,40}\bsent?\b/i,
      /nothing[^.]{0,30}\bever\b[^.]{0,30}\bsent\b/i,
      /will (never )?be sent without/i,
      /always[^.]{0,30}approv/i,
    ]) {
      assert.equal(absolute.test(src), false, `${f} makes a permanent claim: ${absolute}`);
    }
  }
});

// ── Reachability without a migration assumption ────────────────────────────

test("an unreadable onboarding status refuses the flow — including migration_absent", () => {
  // A VISUAL PROTOTYPE MUST NOT CHANGE BEHAVIOUR IN AN UNKNOWN-SCHEMA
  // CONDITION. A pass on this surface briefly made `migration_absent` enter
  // the flow with the status write disabled, reasoning that a missing column
  // is also a missing gate so nobody could be stranded.
  //
  // The reasoning depends on the column genuinely being missing, and the live
  // schema of this project is UNRESOLVED — migrations are applied by hand, so
  // neither the repository nor its history establishes it. `migration_absent`
  // is what one failed read looked like, not a proven fact. /onboarding is
  // openable directly on a Preview, which costs a URL and assumes nothing.
  const view = bodyOf(ONBOARDING_LIB, "export function onboardingView");
  assert.match(view, /if \(context\.kind !== "ready"\) return "unavailable";/,
    "every non-ready kind must refuse");
  assert.equal(/migration_absent/.test(view), false,
    "migration_absent must not be special-cased into the flow");

  // No bypass anywhere else, either: the status PATCH is unconditional and
  // navigation happens only after it succeeds.
  //
  // The PATCH now lives in recordStatus, which `finish` wraps — one writer,
  // two callers. Both halves are checked.
  const record = bodyOf(FLOW, "const recordStatus = useCallback");
  assert.match(record, /\/api\/onboarding\/status/);
  assert.match(record, /method: "PATCH"/);
  assert.equal(/recordProgress|skipStatus|dormant/i.test(record), false,
    "there must be no switch that skips recording the outcome");
  assert.equal(/recordProgress/.test(PAGE), false);
  assert.match(record, /if \(!res\.ok\) \{[\s\S]{0,600}?ok: false/,
    "a non-OK response must never be reported as recorded");

  const finish = bodyOf(FLOW, "const finish = useCallback");
  const call = finish.indexOf("await recordStatus(status, evidence)");
  const nav = finish.indexOf("router.push(destination)");
  assert.ok(call > -1 && nav > call,
    "the flow may only leave AFTER the outcome is recorded");
  assert.match(finish, /if \(!result\.ok\) \{[\s\S]{0,400}?return false;/,
    "a failed record must keep the user here with a message, never bounce them");
  assert.equal(/\/api\/onboarding\/status/.test(finish), false,
    "there must remain exactly one place that writes the status");
});

test("the dashboard gate is unchanged and still fails open", () => {
  const lib = code("lib/onboarding.ts");
  assert.match(lib, /export function shouldRedirectToOnboarding[\s\S]{0,200}if \(context\.kind !== "ready"\) return false;/);
  assert.match(lib, /return context\.status === "required";/);
  // The zero-invoice Overview survives Skip — it is the persistent fallback,
  // not a duplicate of onboarding.
  assert.ok(existsSync(join(ROOT, "components/dashboard/FirstInvoiceActivation.tsx")));
  assert.ok(existsSync(join(ROOT, "lib/overview-first-run.ts")));
});

// ── Nothing that was locked has moved ──────────────────────────────────────

test("the post-signup hard-navigation fix is intact", () => {
  const signup = code("components/auth/SignupForm.tsx");
  // The DESTINATION moved to /onboarding — see
  // tests/fresh-account-onboarding-routing.test.ts. What this test protects is
  // the mechanism: a full document navigation that replaces the spent /signup
  // entry, never a soft push.
  assert.match(signup, /window\.location\.replace\("\/onboarding"\)/,
    "the /#access regression fix is a hard navigation and must stay one");
  assert.equal(/router\.(push|replace)\("\/(dashboard|onboarding)"\)/.test(signup), false,
    "router.push + refresh is the race this fix removed");
});

test("the populated Overview was not touched", () => {
  const overview = code("app/dashboard/page.tsx");
  assert.match(overview, /const MAX_ATTENTION_ROWS = 3;/);
  assert.match(overview, /href="\/dashboard\/needs-action"/);
  assert.match(overview, /In Manual mode, you’ll review each reminder before it sends\./);
  assert.equal(/InvoiceStatusChart/.test(overview), false);
});

// ── Surface quality ────────────────────────────────────────────────────────

test("the onboarding surface uses the dashboard colour system", () => {
  // It previously used #2a5fe3 — the AUTH royal blue — for the primary action,
  // the rail and every focus ring, so the one screen bridging signup and the
  // product was painted in neither.
  assert.equal(/#2a5fe3/.test(CSS), false, "the auth blue must not appear here");
  for (const token of ["--dash-accent", "--dash-accent-strong", "--dash-border", "--dash-text"]) {
    assert.ok(CSS.includes(`var(${token})`), `${token} must drive this surface`);
  }
  // Amber survives in exactly two places, both genuine "did not happen"
  // states. Decorative amber is what the house style rules out.
  const amberBlocks = Array.from(CSS.matchAll(/\.(\w+) \{[^}]*--dash-amber-soft/g)).map((m) => m[1]);
  assert.deepEqual(amberBlocks.sort(), ["confirm", "warning"]);
});

test("the flow is two steps because two things happen", () => {
  assert.match(FLOW, /Step \{visibleStep\} of 2/);
  assert.match(FLOW, />Add invoice</);
  // The second label is DERIVED, because "Ready to review" is false when the
  // invoice has no reachable checkpoint yet. See the dedicated test below.
  assert.match(FLOW, /\{secondStepLabel\}</);
  // The business-name prerequisite and the retry screen are machinery and
  // must render no number — a flow that appears to be a different length for
  // different users, or that counts an error as progress, is worse than none.
  // Neither retry state renders a number: a failure is not progress.
  assert.match(FLOW, /pendingInvoiceId \|\| pendingCompletion\s*\?\s*null/);
  assert.match(FLOW, /step === 3 \|\| step === 4\s*\?\s*2/);
  assert.equal(/Step 3 of|of 3/.test(FLOW), false, "no invented third step");
});

test("mobile is designed for, not stacked into", () => {
  // Sticky, NOT fixed: a fixed bar is out of flow and fights the iOS keyboard.
  assert.match(CSS, /\.actions \{[^}]*position: sticky/);
  assert.match(CSS, /\.actions \{[^}]*bottom: 0/);
  assert.equal(/\.actions \{[^}]*position: fixed/.test(CSS), false);
  assert.match(CSS, /env\(safe-area-inset-bottom\)/, "the home indicator must be cleared");
  assert.match(CSS, /@media \(max-width: 480px\)/);

  // Correct keyboards and autofill on the three fields a phone gets wrong.
  assert.match(FIELDS, /type="tel" inputMode="tel"[\s\S]{0,80}autoComplete="tel"/);
  assert.match(FIELDS, /type="email" inputMode="email"[\s\S]{0,80}autoComplete="email"/);
  assert.match(FIELDS, /inputMode="decimal"/);
  assert.match(FIELDS, /inputMode="numeric"/, "the date is typed as digits");

  // Nothing may overflow horizontally on a 390px screen.
  // Anchored to the start of a declaration, so `max-width` and `min-width` —
  // which are constraints, not fixed sizes — are not caught by it.
  assert.equal(/^\s*width: \d{3,}px/m.test(CSS), false, "no fixed pixel widths");
  assert.match(CSS, /max-width: 660px/);
});

test("only genuinely optional fields are collapsed, and they say so", () => {
  assert.match(FIELDS, /<Collapsible label="Add a job description">/);
  assert.match(FIELDS, /label=\{savedPaymentLink \? "Payment link" : "Add a payment link"\}/);
  assert.match(FIELDS, /Payment link <span className="opt">\(optional\)<\/span>/);
  assert.match(FIELDS, /Job description <span className="opt">\(optional\)<\/span>/);

  // The disclosure is a real button with announced state, not a chevron.
  assert.match(FIELDS, /aria-expanded=\{open\}/);
  assert.match(FIELDS, /aria-controls=\{id\}/);
  // Content unmounted when closed, so a screen reader cannot find hidden
  // fields — which is also exactly why nothing required may live in here.
  assert.match(FIELDS, /\{open && \(/);

  // Everything the ONBOARDING validator can require must be outside them.
  // tests/invoice-field-requirements.test.ts proves the rule set is exactly
  // reference, mobile and an already-passed due date.
  const firstDisclosure = FIELDS.indexOf("<Collapsible");
  const above = FIELDS.slice(0, firstDisclosure);
  for (const id of ["inv-reference", "inv-customer-phone", "inv-due-date"]) {
    assert.ok(above.includes(`id="${id}"`),
      `${id} can be required during onboarding and must render outside a disclosure`);
  }
});

test("errors are associated, announced and never raw", () => {
  // Real labels, not placeholder-only fields.
  const labelled = FIELDS.match(/className="field-label" htmlFor="inv-/g) ?? [];
  assert.ok(labelled.length >= 7, `expected a label per field, found ${labelled.length}`);

  // Every input that can be invalid says so and points at its message.
  const invalids = FIELDS.match(/aria-invalid=\{!!err\(/g) ?? [];
  assert.ok(invalids.length >= 7, `expected aria-invalid throughout, found ${invalids.length}`);
  assert.match(FIELDS, /aria-describedby=\{[\s\S]{0,120}-err"/);

  // Failures are announced, and carry no server or database text.
  assert.match(FLOW, /className=\{styles\.failure\} role="alert"/);
  assert.match(FLOW, /className=\{styles\.warning\} role="status"/);
  for (const leak of [/error\.message/, /payload\?\.detail/, /JSON\.stringify\(err/, /PGRST/, /\b42703\b/]) {
    assert.equal(leak.test(FLOW), false, `customer copy must not carry ${leak}`);
  }
});

test("the tone stays grounded", () => {
  for (const growth of [
    /supercharge/i, /unlock/i, /magical/i, /journey/i, /let'?s go\b/i,
    /cash ?flow/i, /🎉|🚀|✨/, /congratulations/i, /you'?re all set!/i,
  ]) {
    assert.equal(growth.test(FLOW), false, `tone: ${growth}`);
  }
  // No ceremony screen between the invoice and its reminders.
  assert.equal(/Onboarding complete/i.test(FLOW), false);
  // The forward action names where it goes and what is there.
  assert.match(code("components/onboarding/ReminderReview.tsx"), /Go to Active Chasing/);
});
