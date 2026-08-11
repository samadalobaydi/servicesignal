import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Guards for two regressions that reached a deployed Preview while every local
 * gate stayed green.
 *
 * ── WHY NOTHING CAUGHT THEM ────────────────────────────────────────────────
 *
 * `npm test` runs node:test over pure modules. Nothing in this repository
 * mounts a component, and `npm run build` type-checks and compiles but never
 * renders, so neither a clipped table nor a stale render path can fail a gate.
 * These assertions are static — they read the source and check the specific
 * structural properties whose absence caused the bugs. That is weaker than a
 * rendered assertion and is not a substitute for looking at the page, but it
 * does stop a silent revert.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Add Invoice: one implementation, one entry point ───────────────────────

test("[static] every Add Invoice entry point opens the same shared form", () => {
  // The approved form is AddInvoiceForm, which composes the shared
  // components/invoice field set. Entry points must not render their own.
  const form = strip(read("components/dashboard/AddInvoiceForm.tsx"));
  assert.match(form, /from "@\/components\/invoice\/InvoiceFields"/,
    "AddInvoiceForm must use the shared field set, not its own inline fields");
  assert.match(form, /from "@\/components\/invoice\/useInvoiceForm"/);

  // The opener is shared through context, so a second piece of open-state
  // cannot drift from the first.
  const chrome = strip(read("components/dashboard/DashboardChrome.tsx"));
  assert.match(chrome, /AddInvoiceProvider/);
  assert.match(chrome, /<AddInvoiceForm/, "the chrome owns the single add modal");

  const firstRun = strip(read("components/dashboard/FirstInvoiceActivation.tsx"));
  assert.match(firstRun, /useOpenAddInvoice/,
    "the zero-state CTA must open the SAME modal, not mount another form");
  assert.equal(/<AddInvoiceForm/.test(firstRun), false,
    "the zero-state CTA must not render a second Add Invoice form");
});

test("[static] only the approved surfaces render an invoice form at all", () => {
  // Two renders of AddInvoiceForm are expected and correct: the chrome's ADD
  // modal, and the chasing page's EDIT modal (same component, mode="edit").
  // A third would mean a competing implementation had reappeared.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  const renders = walk(join(ROOT, "app"))
    .concat(walk(join(ROOT, "components")))
    .filter((f) => /\.tsx$/.test(f))
    .filter((f) => /<AddInvoiceForm/.test(strip(readFileSync(f, "utf8"))))
    .map((f) => f.slice(ROOT.length))
    .sort();

  assert.deepEqual(renders, [
    "app/dashboard/chasing/page.tsx",
    "components/dashboard/DashboardChrome.tsx",
  ], "exactly two render sites: the add modal and the edit modal");
});

test("[static] the orphaned pre-refactor dashboard components stay unimported", () => {
  // DashboardShell, DashNav, OverviewTab and InvoiceList each still contain an
  // "Add Invoice" button from before the shared-form refactor. Nothing imports
  // them, so they are dead — but they are exactly the kind of file that gets
  // re-imported by someone searching for "Add Invoice" and finding the wrong
  // one. If any becomes reachable, that is a competing implementation.
  const ORPHANS = ["DashboardShell", "DashNav", "OverviewTab", "InvoiceList"];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  const sources = walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))
    .filter((f) => /\.tsx?$/.test(f));

  for (const orphan of ORPHANS) {
    for (const f of sources) {
      if (f.endsWith(`/${orphan}.tsx`)) continue;
      const code = strip(readFileSync(f, "utf8"));
      assert.equal(
        new RegExp(`import[^;]*["']@?[./\\w/]*${orphan}["']`).test(code), false,
        `${f.slice(ROOT.length)} imports the orphaned ${orphan}; delete the orphan or the import`
      );
    }
  }
});

// ── The variant contract ───────────────────────────────────────────────────

test("[static] the dashboard explicitly selects the dashboard variant", () => {
  const form = strip(read("components/dashboard/AddInvoiceForm.tsx"));
  assert.match(form, /<InvoiceFields\s+state=\{state\}\s+variant="dashboard"\s*\/>/,
    "AddInvoiceForm must name its variant explicitly");

  const onboarding = strip(read("components/onboarding/OnboardingFlow.tsx"));
  assert.match(onboarding, /variant="onboarding"/);
  assert.equal(/\bonboarding\s*$/m.test(onboarding.slice(
    onboarding.indexOf("<InvoiceFields"), onboarding.indexOf("<InvoiceFields") + 400)), false,
    "the bare `onboarding` boolean prop must be gone");
});

test("[static] variant is REQUIRED, so a caller cannot silently get legacy", () => {
  // THE ORIGINAL DEFECT: `onboarding?: boolean` defaulted to false, so the
  // dashboard omitting it selected the legacy branch with no error anywhere.
  // A required union makes omission a compile error instead.
  const fields = read("components/invoice/InvoiceFields.tsx");
  assert.match(fields, /export type InvoiceFieldsVariant = "dashboard" \| "onboarding";/);
  assert.match(fields, /^\s*variant: InvoiceFieldsVariant;$/m,
    "variant must be required — no `?`, no default");
  assert.equal(/variant\s*\?:/.test(fields), false, "variant must not be optional");
  assert.equal(/variant\s*=\s*["']/.test(fields), false, "variant must not have a default");
  assert.equal(/\bonboarding\s*=\s*false\b/.test(fields), false,
    "the defaulting boolean must not come back");
});

test("[static] the legacy dashboard presentation is deleted, not just bypassed", () => {
  const fields = read("components/invoice/InvoiceFields.tsx");
  // Dead branches are how this regressed once already: unreachable markup is
  // one edit away from reachable. The old section legends and labels must not
  // exist in the file at all.
  for (const legacy of [
    "Customer Details", "Invoice Details", "Reminder Settings",
    "Customer Name *", "Email Address *", "Phone Number", 'Amount {onboarding',
  ]) {
    assert.equal(fields.includes(legacy), false,
      `legacy presentation "${legacy}" must be removed, not left behind a branch`);
  }
  // The approved modern presentation is present and unconditional.
  for (const modern of ["Customer", "Invoice", "Reminder plan", "inv-reference", "inv-job"]) {
    assert.ok(fields.includes(modern), `modern layout must include ${modern}`);
  }
  // No layout may branch on the variant any more — only requiredness may.
  const body = strip(fields);
  assert.equal(/isOnboarding \?\s*\n?\s*["'<]/.test(body.replace(/\{isOnboarding \? " Must already be overdue\." : ""\}/, "")), false,
    "the variant must not select layout");
});

test("[static] reference and job description reach the creation payload", () => {
  const provider = strip(read("components/dashboard/DashboardProvider.tsx"));
  const call = provider.slice(provider.indexOf("insertInvoice(supabase, {"));
  const payload = call.slice(0, call.indexOf("});") + 1);

  // Collected by the form, so they must actually be sent — otherwise the new
  // fields are decorative and the data is silently dropped.
  assert.match(payload, /invoice_reference: data\.invoice_reference\.trim\(\)/);
  assert.match(payload, /job_description: data\.job_description\.trim\(\)/);
  // Spread when non-empty: absent, not an explicit null, matching the
  // nullable columns and lib/invoice-write.ts.
  assert.match(payload, /\.\.\.\(data\.invoice_reference\.trim\(\) \?/);
  assert.match(payload, /\.\.\.\(data\.job_description\.trim\(\) \?/);

  // Both are in the 013 INSERT whitelist, or the write would be denied.
  const perms = read("supabase/sql/013_invoice_permissions.sql");
  const grant = perms.slice(perms.indexOf("grant insert ("), perms.indexOf("to authenticated;", perms.indexOf("grant insert (")));
  for (const col of ["invoice_reference", "job_description"]) {
    assert.ok(grant.includes(col), `${col} must be grantable or Add Invoice fails after 013`);
  }
});

// ── Active Chasing: the row actions must stay reachable ────────────────────

test("[static] the chasing table card does not clip its row menu", () => {
  const src = read("components/dashboard/ActiveChasingList.tsx");
  const code = strip(src);

  // THE BUG: `.ss-rowmenu-list` is position:absolute with z-index 40. z-index
  // does not escape an ancestor's overflow clip, so an `overflow-hidden` card
  // hid the Edit/Delete/Archive dropdown entirely. A scroll container would
  // clip it in exactly the same way, so neither is allowed on this wrapper.
  const wrapper = code.slice(code.indexOf('hidden md:block dash-card'));
  const openingTag = wrapper.slice(0, wrapper.indexOf(">"));
  for (const bad of ["overflow-hidden", "overflow-x-auto", "overflow-auto", "overflow-scroll"]) {
    assert.equal(openingTag.includes(bad), false,
      `the chasing table card must not use ${bad}: it clips the absolutely-positioned row menu`);
  }

  // The rounding the clip used to provide is applied explicitly instead, or
  // the header corners visibly overhang the card.
  assert.match(code, /rounded-tl-\[14px\]/);
  assert.match(code, /rounded-tr-\[14px\]/);
});

test("[static] the row action group can wrap instead of overflowing", () => {
  const code = strip(read("components/dashboard/ActiveChasingList.tsx"));

  // THE BUG: Review reminder + Dismiss + Mark Paid + the ⋯ menu are each
  // whitespace-nowrap. Held in a flex-nowrap row, the group's min-content width
  // is the SUM of all four, which exceeded the column and pushed Mark Paid and
  // the menu outside the card. Wrapping drops that floor to the widest single
  // control, which is what actually removes the overflow — as opposed to
  // shrinking the buttons until they happen to fit at one viewport width.
  assert.equal(/flex-nowrap/.test(code), false,
    "no action row may be flex-nowrap; that is what forced the overflow");

  const groups = code.match(/className="flex items-center gap-2 justify-end[^"]*"/g) ?? [];
  assert.ok(groups.length >= 2, `expected the cell and inner action groups, found ${groups.length}`);
  for (const g of groups) {
    assert.match(g, /flex-wrap/, `action group must be wrappable: ${g}`);
    // justify-end is what keeps a two-action row aligned with a four-action row.
    assert.match(g, /justify-end/, "rows with fewer actions must stay aligned");
  }

  // table-fixed is the other half: under auto layout a single long customer
  // email set a floor for the Customer column and squeezed the actions column.
  assert.match(code, /<table className="w-full table-fixed">/);
  assert.match(code, /truncate/, "long customer text must truncate, not widen the column");
});
