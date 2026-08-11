import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  FOUNDING_BETA_ALLOWANCE,
  ALLOWANCE_CONSUMING_STATUSES,
  consumesAllowance,
  countConsumed,
  betaAllowance,
  allowanceUsageLabel,
  allowanceExhausted,
  ALLOWANCE_LIMIT_BADGE,
  allowanceUsageLabelCompact,
  allowanceUsageLabelMini,
  allowanceProgressLabel,
} from "@/lib/beta-allowance";

/**
 * Founding-beta allowance.
 *
 * The thing worth protecting here is not the arithmetic — it is the rule that
 * a technical retry, a second channel, or a duplicate request can never cost
 * the owner a reminder they did not send.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A reminder_logs row, reduced to what the counter reads. */
function log(id: string, status: string) {
  return { id, status };
}

// ── What consumes allowance ────────────────────────────────────────────────

test("only a dispatched reminder consumes allowance", () => {
  // Handed to a provider that accepted it.
  for (const status of ["sent", "delivery_unknown", "undelivered"]) {
    assert.equal(consumesAllowance(status), true, status);
  }

  // Never submitted, or submitted and definitively rejected.
  for (const status of ["pending", "dismissed", "failed", "sending"]) {
    assert.equal(consumesAllowance(status), false, status);
  }

  assert.deepEqual([...ALLOWANCE_CONSUMING_STATUSES], ["sent", "delivery_unknown", "undelivered"]);
});

test("a send that failed before acceptance is free", () => {
  // 'failed' means a definite PRE-acceptance rejection — the provider never
  // took the message, so neither channel reached anyone.
  assert.equal(countConsumed([log("a", "failed"), log("b", "failed")]), 0);
});

test("a dismissed reminder is free — the owner declined it", () => {
  assert.equal(countConsumed([log("a", "dismissed"), log("b", "pending")]), 0);
});

// ── One reminder, whatever happened underneath it ──────────────────────────

test("a retry does not consume a second reminder", () => {
  // The approve route only ever UPDATEs the existing row: a new attempt moves
  // send_attempt_count, it does not insert. However many attempts a reminder
  // took, the database still holds ONE row, and one row is one reminder.
  assert.equal(countConsumed([log("rem-1", "sent")]), 1);

  // And the same id arriving more than once — the shape a join would produce —
  // is still one.
  assert.equal(countConsumed([log("rem-1", "sent"), log("rem-1", "sent")]), 1);
});

test("the SMS and the email of one reminder are one reminder", () => {
  // Channel rows live in reminder_channel_messages, keyed by reminder_log_id.
  // If a caller ever joins them onto the parent, the parent id de-duplicates
  // them back to a single reminder.
  const joined = [
    { id: "rem-1", status: "sent" }, // sms channel row
    { id: "rem-1", status: "sent" }, // email channel row
  ];
  assert.equal(countConsumed(joined), 1, "SMS + email is one reminder, not two");
});

test("one channel delivered and the other bounced is still one reminder", () => {
  const partial = [
    { id: "rem-1", status: "sent" },
    { id: "rem-1", status: "undelivered" },
  ];
  assert.equal(countConsumed(partial), 1);
});

test("a duplicate approval request cannot consume twice", () => {
  // The atomic compare-and-set on send_attempt_count means only one request
  // wins the claim; the loser never creates a row. At the counting layer, the
  // guarantee shows up as: same id, same reminder.
  assert.equal(countConsumed([log("rem-7", "sent"), log("rem-7", "delivery_unknown")]), 1);
});

test("distinct reminders each consume one", () => {
  assert.equal(
    countConsumed([log("a", "sent"), log("b", "sent"), log("c", "undelivered"), log("d", "failed")]),
    3
  );
});

// ── The numbers shown ──────────────────────────────────────────────────────

test("0, 1, 9 and 10 used", () => {
  const zero = betaAllowance(0);
  assert.deepEqual(
    [zero.used, zero.remaining, zero.percentUsed, zero.atLimit],
    [0, 10, 0, false]
  );

  const one = betaAllowance(1);
  assert.deepEqual([one.used, one.remaining, one.percentUsed, one.atLimit], [1, 9, 10, false]);

  const nine = betaAllowance(9);
  assert.deepEqual([nine.used, nine.remaining, nine.percentUsed, nine.atLimit], [9, 1, 90, false]);

  const ten = betaAllowance(10);
  assert.deepEqual([ten.used, ten.remaining, ten.percentUsed, ten.atLimit], [10, 0, 100, true]);

  assert.equal(FOUNDING_BETA_ALLOWANCE, 10);
});

test("remaining is never negative and the bar never exceeds its track", () => {
  // Legacy rows, or a future change to the allowance, must not render
  // "-2 remaining" or a fill wider than 100%.
  for (const raw of [11, 25, 1000]) {
    const a = betaAllowance(raw);
    assert.equal(a.remaining, 0, `raw ${raw}`);
    assert.equal(a.percentUsed, 100, `raw ${raw}`);
    assert.equal(a.used, 10, `raw ${raw}`);
    assert.equal(a.atLimit, true, `raw ${raw}`);
  }

  // And nonsense inputs cannot produce nonsense output.
  for (const raw of [-1, -100, NaN]) {
    const a = betaAllowance(raw);
    assert.equal(a.used, 0, `raw ${raw}`);
    assert.equal(a.remaining, 10, `raw ${raw}`);
    assert.equal(a.percentUsed, 0, `raw ${raw}`);
  }
});

// ── Copy ───────────────────────────────────────────────────────────────────

test("the desktop wording is one statement with one number", () => {
  // The chip said "10 free reminders" AND "10 remaining" — the same fact
  // twice, in two framings, in a space too small for either. A usage fraction
  // carries both halves at once.
  assert.equal(allowanceUsageLabel(betaAllowance(0)), "Founding beta \u2014 0 / 10 reminders used");
  assert.equal(allowanceUsageLabel(betaAllowance(1)), "Founding beta \u2014 1 / 10 reminders used");
  assert.equal(allowanceUsageLabel(betaAllowance(4)), "Founding beta \u2014 4 / 10 reminders used");
  assert.equal(allowanceUsageLabel(betaAllowance(9)), "Founding beta \u2014 9 / 10 reminders used");
  // AT THE CAP the sentence is UNCHANGED. The state is carried by a separate
  // badge, not appended here — see the truncation test below.
  assert.equal(allowanceUsageLabel(betaAllowance(10)), "Founding beta \u2014 10 / 10 reminders used");
});

test("[static] the progress fill stays teal at the cap", () => {
  // The bar shows a FRACTION, and a fraction is not a warning: at 10 / 10 it
  // is the same measurement it was at 9 / 10. Recolouring it amber made the
  // header read as an alert bar and broke the dashboard's colour language,
  // where teal means "this product" and amber means "attention".
  //
  // Exhaustion is carried by the badge alone.
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  assert.equal(/\.ss-beta-panel--spent[^{]*\.ss-beta-fill\s*\{/.test(css), false,
    "the spent state must not restyle the progress fill");
  assert.equal(/\.ss-beta-fill[^{]*\{[^}]*amber/.test(css), false,
    "no amber may reach the progress fill");

  // ...and the badge is where the amber lives.
  const badge = css.slice(css.indexOf(".ss-beta-badge {"));
  assert.match(badge.slice(0, badge.indexOf("}")), /--dash-amber/,
    "the restrained amber belongs to the badge");
});

test("the cap state is its own short string, never appended to the sentence", () => {
  // THE BUG: "Founding beta — 10 / 10 reminders used — limit reached" in a
  // fixed-width header panel rendered as "…limit reac…". Appending state to a
  // sentence means the sentence's length decides whether the state survives.
  assert.equal(ALLOWANCE_LIMIT_BADGE, "Limit reached");

  for (const used of [0, 1, 4, 9, 10]) {
    const a = betaAllowance(used);
    for (const label of [allowanceUsageLabel(a), allowanceUsageLabelCompact(a), allowanceUsageLabelMini(a)]) {
      assert.equal(/limit/i.test(label), false,
        `"${label}" must not carry the cap state inside the sentence`);
    }
  }

  // And the sentence must stay short enough to be a header line. 46 chars is
  // the longest legitimate value ("Founding beta — 10 / 10 reminders used");
  // anything materially beyond that is a regression toward concatenation.
  for (const used of [0, 10]) {
    assert.ok(allowanceUsageLabel(betaAllowance(used)).length <= 46,
      `"${allowanceUsageLabel(betaAllowance(used))}" is too long for the header panel`);
  }
});

test("only the exhausted state renders the limit badge", () => {
  // A near-full allowance must not be dressed up as a stop.
  for (const used of [0, 1, 4, 9]) {
    assert.equal(allowanceExhausted(betaAllowance(used)), false,
      `${used}/10 is not the cap and must not claim to be`);
  }
  assert.equal(allowanceExhausted(betaAllowance(10)), true);

  // The component gates the badge on exactly that predicate.
  const chip = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8");
  assert.match(chip, /const exhausted = allowanceExhausted\(allowance\);/);
  assert.match(chip, /\{exhausted && \(\s*\n?\s*<span className="ss-beta-badge">\{ALLOWANCE_LIMIT_BADGE\}<\/span>/);
});

test("the cap state never promises billing that does not exist", () => {
  // There is no in-app upgrade, checkout or billing route in this product.
  // The allowance copy must therefore not imply one — no "upgrade", no
  // "plan", no "coming soon". It states the fact and stops.
  for (const label of [
    allowanceUsageLabel(betaAllowance(10)),
    allowanceUsageLabelCompact(betaAllowance(10)),
    allowanceUsageLabelMini(betaAllowance(10)),
    allowanceProgressLabel(betaAllowance(10)),
  ]) {
    for (const forbidden of [/upgrade/i, /billing/i, /plan\b/i, /pricing/i, /coming soon/i, /buy/i, /subscribe/i]) {
      assert.equal(forbidden.test(label), false, `"${label}" implies billing that does not exist`);
    }
  }
});

test("no wording anywhere restates the same number a second way", () => {
  for (const used of [0, 1, 4, 9, 10]) {
    const a = betaAllowance(used);
    for (const label of [
      allowanceUsageLabel(a), allowanceUsageLabelCompact(a), allowanceUsageLabelMini(a),
    ]) {
      assert.equal(/remaining/i.test(label), false, `"${label}" restates the count`);
      assert.equal(/%/.test(label), false, `"${label}" adds a percentage`);
      assert.equal(/SMS|email/i.test(label), false, `"${label}" carries the secondary line`);
    }
  }
});

test("the compact and mini wordings shorten the framing, never the fraction", () => {
  assert.equal(allowanceUsageLabelCompact(betaAllowance(4)), "Beta \u2014 4 / 10 used");
  assert.equal(allowanceUsageLabelCompact(betaAllowance(10)), "Beta \u2014 10 / 10 used");
  assert.equal(allowanceUsageLabelMini(betaAllowance(4)), "Beta \u00b7 4 / 10");
  assert.equal(allowanceUsageLabelMini(betaAllowance(0)), "Beta \u00b7 0 / 10");

  // Strictly shorter at every value, and each still contains both figures.
  for (const used of [0, 4, 10]) {
    const a = betaAllowance(used);
    assert.ok(allowanceUsageLabelCompact(a).length < allowanceUsageLabel(a).length);
    assert.ok(allowanceUsageLabelMini(a).length < allowanceUsageLabelCompact(a).length);
    for (const label of [allowanceUsageLabelCompact(a), allowanceUsageLabelMini(a)]) {
      assert.match(label, new RegExp(`${used} / 10`));
    }
  }
});

test("the progress bar's value text is a sentence, and is not the visible copy", () => {
  assert.equal(allowanceProgressLabel(betaAllowance(0)), "0 of 10 free reminders used");
  assert.equal(allowanceProgressLabel(betaAllowance(4)), "4 of 10 free reminders used");
  assert.equal(allowanceProgressLabel(betaAllowance(10)), "10 of 10 free reminders used");
  // Spelled out rather than "4 / 10" — a screen reader should hear words.
  assert.equal(/\//.test(allowanceProgressLabel(betaAllowance(4))), false);
});

test("the bar fill follows the clamped model, never a fresh calculation", () => {
  // percentUsed comes from betaAllowance(), which is where clamping lives.
  assert.equal(betaAllowance(0).percentUsed, 0);
  assert.equal(betaAllowance(1).percentUsed, 10);
  assert.equal(betaAllowance(4).percentUsed, 40);
  assert.equal(betaAllowance(5).percentUsed, 50);
  assert.equal(betaAllowance(9).percentUsed, 90);
  assert.equal(betaAllowance(10).percentUsed, 100);
  // And a ledger somehow past the cap cannot render a bar wider than its track.
  for (const raw of [11, 40, 1000]) assert.equal(betaAllowance(raw).percentUsed, 100);
  for (const raw of [-5, NaN]) assert.equal(betaAllowance(raw).percentUsed, 0);
});

// ── Restored coverage ──────────────────────────────────────────────────────
//
// Both of these existed, and both were removed by accident: a source edit two
// passes ago replaced a range of this file bounded by the section marker
// below, and that range turned out to contain four tests rather than the five
// copy tests it was aimed at. Two of the four were genuinely re-covered
// elsewhere; these two were not, and were simply lost.

test("[static] the panel hides rather than guess when usage is unverified", () => {
  const chip = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ctx = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceContext.tsx"), "utf8");

  // A usage meter is the one component where a plausible wrong value is worse
  // than absence: "10 / 10" shown because a query failed would tell someone at
  // their limit that they still had ten.
  assert.match(chip, /if \(!allowance\) return null;/);
  assert.equal(/betaAllowance\(0\)|\?\? 0/.test(chip), false, "no reassuring default");

  // The provider is null until a real count arrives, and stays null on error.
  assert.match(ctx, /if \(!cancelled && n !== null\) setUsed\(n\)/);
  assert.match(ctx, /used === null \? null : betaAllowance\(used\)/);
});

test("[static] the panel reads the SAME ledger the server enforces", () => {
  const reminders = readFileSync(join(ROOT, "lib/reminders.ts"), "utf8");

  // One definition, not two. The displayed number IS the enforcement ledger,
  // so "you have six left" and "the server will let you send six more" cannot
  // disagree.
  assert.match(reminders, /from\("reminder_allowance_slots"\)/);
  assert.match(reminders, /count: "exact", head: true/, "a COUNT(*), transferring no rows");

  // And it must NOT re-derive usage from reminder_logs statuses — that was the
  // second definition waiting to drift from the first.
  assert.equal(
    /fetchAllowanceUsed[\s\S]*?\.in\("status"/.test(reminders),
    false,
    "usage must not be recomputed from statuses"
  );
  assert.match(reminders, /return null;/, "null on error, never 0");
});

// ── The allowance as top chrome ────────────────────────────────────────────

test("[static] the allowance renders in the header, immediately left of Add Invoice", () => {
  const chrome = readFileSync(join(ROOT, "components/dashboard/DashboardChrome.tsx"), "utf8");
  const code = chrome.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const chip = code.indexOf('<BetaAllowanceIndicator tone="light" />');
  const addBtn = code.indexOf("onClick={openAddInvoice}");
  const bell = code.indexOf("<NotificationBell />");

  assert.ok(chip > -1, "the chip is in the header");
  assert.ok(chip < addBtn, "immediately to the LEFT of Add Invoice");
  assert.ok(addBtn < bell, "notification and account controls did not move");

  // The header keeps its height — this moved into unused horizontal space.
  assert.match(code, /h-\[68px\]/);
});

test("[static] there is exactly ONE allowance display in the product", () => {
  const files = [
    "app/dashboard/page.tsx",
    "components/dashboard/DashboardChrome.tsx",
    "components/dashboard/DashboardSidebar.tsx",
    "components/dashboard/FirstInvoiceActivation.tsx",
  ];

  let renders = 0;
  for (const f of files) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    renders += (code.match(/<BetaAllowanceIndicator/g) ?? []).length;
    // The old full-width banner is gone from the codebase entirely.
    assert.equal(/BetaAllowanceBanner/.test(code), false, `${f} still references the old banner`);
  }

  // Two mount points, but they are mutually exclusive: the desktop header is
  // `hidden md:flex` and the mobile bar is `md:hidden`, so exactly one is ever
  // on screen. Without the mobile one the allowance would vanish below 768px.
  assert.equal(renders, 2, "desktop header and mobile bar");

  const chrome = readFileSync(join(ROOT, "components/dashboard/DashboardChrome.tsx"), "utf8");
  const sidebar = readFileSync(join(ROOT, "components/dashboard/DashboardSidebar.tsx"), "utf8");
  assert.match(chrome, /className="hidden md:flex[^"]*h-\[68px\]/);
  assert.match(sidebar, /className="md:hidden sticky top-0 z-30"/);
});

test("[static] one fetch, one model — no second allowance calculation", () => {
  const ctx = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceContext.tsx"), "utf8");
  // Comments explain where the model comes from and necessarily name it; only
  // executable code can perform a second calculation.
  const chip = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The provider owns the single query and the single model.
  assert.match(ctx, /fetchAllowanceUsed\(getSupabaseBrowser\(\)\)/);
  assert.match(ctx, /betaAllowance\(used\)/);

  // The presentation does neither. It consumes and formats.
  assert.equal(/fetchAllowanceUsed|supabase|betaAllowance\(/.test(chip), false,
    "the chip must not fetch or recompute");
  assert.match(chip, /useBetaAllowance\(\)/);

  // And nothing anywhere derives usage a second way.
  for (const f of ["components/dashboard/DashboardChrome.tsx", "components/dashboard/DashboardSidebar.tsx"]) {
    const code = readFileSync(join(ROOT, f), "utf8");
    assert.equal(/fetchAllowanceUsed|betaAllowance\(|reminder_allowance_slots/.test(code), false, f);
  }

  // Exactly one query call site in the whole UI.
  const all = ["components/dashboard/BetaAllowanceContext.tsx", "components/dashboard/BetaAllowanceIndicator.tsx",
               "components/dashboard/DashboardChrome.tsx", "components/dashboard/DashboardSidebar.tsx",
               "app/dashboard/page.tsx"]
    .map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  assert.equal((all.match(/fetchAllowanceUsed\(/g) ?? []).length, 1);
});

test("[static] the progress bar is restored, with real semantics and no fake ones", () => {
  const chip = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  // The element exists again, so the semantics must be real this time.
  assert.match(chip, /role="progressbar"/);
  assert.match(chip, /aria-valuemin=\{0\}/);
  assert.match(chip, /aria-valuemax=\{allowance\.allowance\}/);
  assert.match(chip, /aria-valuenow=\{allowance\.used\}/);
  assert.match(chip, /aria-valuetext=\{allowanceProgressLabel\(allowance\)\}/);
  // A progressbar needs a name; the visible line is not associated with it.
  assert.match(chip, /aria-label="Founding Beta reminder allowance"/);

  // The fill uses the CLAMPED model value — no division in the component.
  assert.match(chip, /width: `\$\{allowance\.percentUsed\}%`/);
  assert.equal(/\/\s*allowance\.allowance|\* 100/.test(chip), false, "no recalculation");

  // Thin, rounded, subordinate — and never a warning colour.
  assert.match(css, /\.ss-beta-track \{[\s\S]*?height: 4px;[\s\S]*?border-radius: 999px;/);
  assert.match(css, /\.ss-beta-fill \{[\s\S]*?background: var\(--dash-accent-strong\)/);
  const block = css.slice(css.indexOf(".ss-beta-panel {"), css.indexOf(".ss-firstrun {"));
  assert.equal(/#dc2626|#ef4444|dash-red/.test(block), false, "no red state at 10/10");
});

test("[static] the panel is not interactive and carries no upgrade CTA", () => {
  const chip = readFileSync(join(ROOT, "components/dashboard/BetaAllowanceIndicator.tsx"), "utf8");
  const code = chip.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // There is no billing destination, so a focusable element that does nothing
  // would be a keyboard stop for no reason.
  assert.equal(/<button|<a |<Link|onClick|tabIndex|href=/.test(code), false);
  for (const banned of [/Upgrade/i, /Buy more/i, /Pricing/i, /Checkout/i, /Subscribe/i]) {
    assert.equal(banned.test(code), false, `no CTA: ${banned}`);
  }
  // The spent modifier is appended for the 10/10 state; the panel is still a
  // plain div. The no-CTA assertions above are the guarantee that matters and
  // they are unchanged — this one only pins the element type and base classes.
  assert.match(code, /<div\s+className=\{`ss-beta-panel ss-beta-panel--\$\{tone\}\$\{exhausted \? " ss-beta-panel--spent" : ""\}`\}/);
  assert.equal(/role="button"/.test(code), false, "still not a control");
  // And no icon of any kind — no star, no lightning.
  assert.equal(/<svg/.test(code), false, "the text and the bar are the whole component");
});

test("[static] the verbose banner line did not follow it into the chrome", () => {
  for (const f of ["components/dashboard/BetaAllowanceIndicator.tsx",
                   "components/dashboard/DashboardChrome.tsx",
                   "components/dashboard/DashboardSidebar.tsx"]) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(/Each reminder includes SMS \+ email/.test(code), false, f);
  }
  // The product rule itself is untouched — still enforced server-side.
  const allowance = readFileSync(join(ROOT, "lib/beta-allowance.ts"), "utf8");
  assert.match(allowance, /ALLOWANCE_CONSUMING_STATUSES/);
  assert.match(allowance, /FOUNDING_BETA_ALLOWANCE = 10/);
});

test("[static] Add Invoice still opens the same modal, unchanged", () => {
  const chrome = readFileSync(join(ROOT, "components/dashboard/DashboardChrome.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.equal((chrome.match(/<AddInvoiceForm/g) ?? []).length, 1);
  assert.match(chrome, /const openAddInvoice = useCallback\(\(\) => setAddOpen\(true\), \[\]\)/);
  assert.equal((chrome.match(/onClick=\{openAddInvoice\}/g) ?? []).length, 2,
    "desktop top bar and mobile floating button");
  assert.match(chrome, /className="dash-btn"/, "still the primary filled action");

  // The chip must stay quieter than it — tinted, not filled.
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const block = css.slice(css.indexOf(".ss-beta-panel {"), css.indexOf("/* ── Overview: first run"));
  assert.equal(/dash-btn/.test(block), false, "the panel must not borrow the button treatment");
  // Larger in area than the chip it replaces, but quieter in weight: tinted
  // rather than filled, and a step down in type from the button's 0.9rem.
  assert.match(block, /font-size: 0\.875rem/);
  assert.match(block, /background: #f5fbfd/);

  // A pale fill inside a clearly visible even-weight edge is, structurally, an
  // input. The border is the half of that pair which had to give way, so it is
  // pinned: soft enough to delineate, not enough to outline.
  assert.match(block, /border: 1px solid #e3eff4/);
  assert.equal(
    /border: 1px solid #cde9f2/.test(block), false,
    "the old input-style edge must not return"
  );
});

test("[static] the panel is sized for the header and shrinks its wording, not its type", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
  const block = css.slice(css.indexOf(".ss-beta-panel {"), css.indexOf("/* ── Overview: first run"));

  // A panel, not a tag — and still inside the untouched 68px header.
  assert.match(block, /height: 44px/);
  assert.match(block, /\.ss-beta-panel--light \{ width: 390px; \}/);

  // Three width steps, each paired with a shorter wording rather than smaller
  // type. The type size is declared once and never reduced per breakpoint.
  assert.match(block, /\.ss-beta-panel--light \{ width: 120px; \}/);
  assert.match(block, /@media \(min-width: 1024px\)[\s\S]*?\.ss-beta-panel--light \{ width: 220px; \}/);
  assert.match(block, /@media \(min-width: 1280px\)[\s\S]*?\.ss-beta-panel--light \{ width: 390px; \}/);

  const lightRules = block.slice(0, block.indexOf(".ss-beta-panel--dark { width: auto"));
  assert.equal(
    /--light[^{]*\{[^}]*font-size/.test(lightRules), false,
    "no breakpoint may shrink the type to preserve the desktop form"
  );

  // Exactly one wording visible per step.
  assert.match(block, /\.ss-beta-panel--light \.ss-beta-t-mini \{ display: inline; \}/);
  assert.match(block, /@media \(min-width: 1024px\)[\s\S]*?\.ss-beta-t-compact \{ display: inline; \}/);
  assert.match(block, /@media \(min-width: 1280px\)[\s\S]*?\.ss-beta-t-full \{ display: inline; \}/);
  assert.equal(/\.ss-beta-panel--dark \.ss-beta-t-full \{ display: inline/.test(block), false);

  // Bar geometry and the space above it.
  assert.match(block, /\.ss-beta-track \{[\s\S]*?height: 4px;/);
  assert.match(block, /gap: 0\.375rem/);

  // It yields and ellipsises rather than wrapping the toolbar to two lines.
  assert.match(block, /white-space: nowrap/);
  assert.match(block, /text-overflow: ellipsis/);
  assert.match(block, /flex-shrink: 1/);
  assert.match(block, /min-width: 0/);
});

test("[static] status sits left, actions sit right, aligned with the content below", () => {
  const chrome = readFileSync(join(ROOT, "components/dashboard/DashboardChrome.tsx"), "utf8");
  const code = chrome.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The inner row mirrors <main> so the panel's left edge lands on the same
  // vertical as the Overview heading and every card below it.
  const main = code.match(/<main className="([^"]+)"/)![1];
  assert.match(main, /max-w-\[1240px\]/);
  assert.match(main, /mx-auto/);
  assert.match(code, /<div className="flex-1 flex items-center justify-between gap-4 px-8 lg:px-10 max-w-\[1240px\] mx-auto w-full">/);

  // Header height unchanged; the full-bleed bar keeps its own background.
  assert.match(code, /className="hidden md:flex h-\[68px\] sticky top-0 z-20"/);

  // Allowance first in the DOM, action cluster second.
  const panel = code.indexOf("<BetaAllowanceIndicator");
  const actions = code.indexOf('<div className="flex items-center gap-3 flex-shrink-0">');
  assert.ok(panel > -1 && actions > panel, "status precedes actions");

  // A left wrapper that renders even when the panel does not — otherwise
  // justify-between would drag the action cluster left while usage loads.
  assert.match(code, /<div className="flex items-center min-w-0">\s*<BetaAllowanceIndicator tone="light" \/>/);

  // The right cluster is intact and in its original order.
  const right = code.slice(actions);
  const addBtn = right.indexOf("onClick={openAddInvoice}");
  const bell = right.indexOf("<NotificationBell />");
  const avatar = right.indexOf("{initial}");
  assert.ok(addBtn > -1 && addBtn < bell && bell < avatar, "Add Invoice, bell, account — unmoved");
  assert.match(right, /className="dash-btn"/);
  assert.match(right, /max-w-\[200px\]/);
});
