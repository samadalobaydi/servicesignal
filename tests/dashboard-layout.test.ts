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
  // The payload moved OUT of the React callback into a pure module, so it
  // could finally be tested — see lib/invoice-create-payload.ts.
  const builder = strip(read("lib/invoice-create-payload.ts"));
  const call = builder.slice(builder.indexOf("return {"));
  const payload = call.slice(0, call.indexOf("\n  };") + 1);

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

test("[static] desktop renders the actions as ONE row, not a wrapped pile", () => {
  const code = strip(read("components/dashboard/ActiveChasingList.tsx"));

  // FIRST ATTEMPT, AND WHY IT WAS WRONG: plain `flex-wrap` stopped the
  // clipping but produced a three-line action pile at desktop — Review +
  // Dismiss, then Mark Paid + menu, then the chevron — and a tall ragged row.
  // Containment is not layout. The fix is the column allocation plus
  // `lg:flex-nowrap`, so the row is deliberately horizontal where it is read.
  const groups = code.match(/className="flex items-center gap-2 justify-end[^"]*"/g) ?? [];
  assert.ok(groups.length >= 2, `expected the cell and inner action groups, found ${groups.length}`);
  for (const g of groups) {
    assert.match(g, /lg:flex-nowrap/, `action group must be one row at desktop: ${g}`);
    assert.match(g, /flex-wrap/, `and a deliberate compact wrap below lg: ${g}`);
    assert.match(g, /justify-end/, "rows with fewer actions must stay aligned");
  }

  // The actions column must hold the majority of the slack, or nowrap simply
  // reintroduces the overflow it replaced.
  const actions = code.match(/\["", "w-\[(\d+)%\]"\]/);
  assert.ok(actions, "the actions column must have an explicit width");
  assert.ok(Number(actions![1]) >= 34,
    `actions column is ${actions![1]}% — too narrow for four controls at nowrap`);

  // Widths must still add up, or table-fixed distributes the remainder oddly.
  const pcts = Array.from(code.matchAll(/"w-\[(\d+)%\]"/g)).map((m) => Number(m[1]));
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100, `column widths must total 100%, got ${pcts.join("+")}`);

  assert.match(code, /<table className="w-full table-fixed">/);
  assert.match(code, /truncate/, "long customer text must truncate, not widen the column");
});

test("[static] the history chevron is out of the action group", () => {
  // It was competing with the four real actions for horizontal space, and was
  // the control that dropped to its own line. It is a row-disclosure toggle,
  // not a task — it belongs with the row's identity, as on Paid Invoices.
  const code = strip(read("components/dashboard/ActiveChasingList.tsx"));
  const cell = code.slice(code.indexOf('<td className="px-4 py-4">'));
  const actionCell = cell.slice(0, cell.indexOf("</td>"));
  assert.equal(/<HistoryToggle/.test(actionCell), false,
    "the history chevron must not sit inside the action group");

  // ...but it must still exist on the row: not hidden to make things fit.
  // Scoped to the DESKTOP table — `inv.customer_email` also appears in the
  // mobile card above it, and anchoring on the first match checked the wrong
  // half of the component.
  const desktop = code.slice(code.indexOf("hidden md:block dash-card"));
  const customerCell = desktop.slice(desktop.indexOf("inv.customer_email"));
  assert.match(customerCell.slice(0, 400), /<HistoryToggle/,
    "the chevron must move, not disappear");
});


// ── Developer comments must never reach the customer ───────────────────────

test("[static] no block comment sits in JSX child position", () => {
  // WHAT HAPPENED: unwrapping `{onboarding ? ( /* ... */ <div/> ) : (...)}`
  // removed the braces, and a block comment among JSX CHILDREN is not a
  // comment — it is text. React rendered the implementation note into the Add
  // Invoice drawer, above the due-date field, on a live Preview.
  //
  // THE RULE: `/* */` is a real comment only in EXPRESSION position — directly
  // after `(`, `{`, `?`, `:`, `&&`, `||`, `,` or `=`. Immediately after a `>`
  // that closed a JSX tag, it is rendered text.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  const files = walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))
    .filter((f) => f.endsWith(".tsx"));
  assert.ok(files.length > 10, "the sweep must actually find components");

  for (const file of files) {
    const code = readFileSync(file, "utf8");
    for (let i = code.indexOf("/*"); i !== -1; i = code.indexOf("/*", i + 2)) {
      // Skip `//`-style lines and doc blocks at module scope.
      let k = i - 1;
      while (k >= 0 && /\s/.test(code[k])) k--;
      const prev = k >= 0 ? code[k] : "{";
      if ("({?:&|,=;[".includes(prev)) continue;   // expression position — fine
      if (prev === "*" || prev === "/") continue;  // nested/adjacent comment
      const line = code.slice(0, i).split("\n").length;
      assert.equal(prev === ">", false,
        `${file.slice(ROOT.length)}:${line} — block comment directly after a JSX tag renders as visible text; wrap it in {/* ... */}`);
    }
  }
});

test("[static] the date-field implementation note cannot render as form text", () => {
  const code = read("components/invoice/InvoiceFields.tsx");
  for (const fragment of ["ONE field, not two", "showPicker()", "BRACES ARE LOAD-BEARING"]) {
    const at = code.indexOf(fragment);
    assert.ok(at > -1, `${fragment} should still be documented for developers`);
    // Every occurrence must live inside a {/* ... */} container.
    const before = code.slice(0, at);
    const opener = before.lastIndexOf("{/*");
    const closer = before.lastIndexOf("*/}");
    assert.ok(opener > closer,
      `"${fragment}" is not inside a {/* ... */} container — it would render`);
  }
});
