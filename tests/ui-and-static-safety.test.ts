process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { BETA_APPROVAL_ONLY } from "@/lib/beta-capabilities";
import { approveAndSendReminder } from "@/lib/reminder-approval";
import { SEND_STATE_COPY, reviewAvailability } from "@/lib/reminder-send-state";
import type { ReminderSendStatus } from "@/lib/reminder-send-state";
import {
  FakeApprovalDb,
  FakeMailer,
  FakeTexter,
  FakeChannelDb,
  FakeAllowanceStore,
  REMINDER_ID,
  freshToken,
  ineligibleDueDate,
  makeDeps,
  makeStoredReminder,
} from "./support/fakes";
import { retryReminderChannel } from "@/lib/reminder-approval";
import { resolveSenderIdentity, reminderFromHeader } from "@/lib/sender-identity";
import { REMINDER_FROM_ADDRESS } from "@/lib/resend";

/**
 * SCENARIOS 46–50.
 *
 * 46–49 are STATIC CHECKS. They read source and assert on its shape. That is a
 * weaker guarantee than executing the code and it is labelled as such — a grep
 * is not a route test. They are here because the property being claimed is an
 * ABSENCE ("no other caller can send"), and absence cannot be demonstrated by
 * running one path.
 *
 * 50 is a SERVICE TEST: it runs the real send path across every failure mode
 * and asserts none of them can produce success feedback.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (exts.some((e) => entry.endsWith(e))) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** Comments explain intent; they cannot call anything. Stripped before searching. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("46. [static] no live dashboard 'Send Now' control remains", () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles("components"), ...sourceFiles("app")]) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/Send Now/.test(code)) offenders.push(file.replace(ROOT, ""));
  }
  assert.deepEqual(offenders, [], "a one-click send control must not exist anywhere");
});

test("47. [static] only ReminderReviewPanel can initiate an approval", () => {
  const callers: string[] = [];
  for (const file of [...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!/\bapproveReminder\s*\(/.test(code)) continue;
    const relative = file.replace(ROOT, "");
    // lib/reminders.ts DEFINES it; that is not a call site.
    if (relative === "lib/reminders.ts") continue;
    callers.push(relative);
  }
  assert.deepEqual(callers, ["components/dashboard/ReminderReviewPanel.tsx"]);
});

test("47b. [static] every provider send call site is accounted for", () => {
  const sites: string[] = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("components")]) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/emails\s*\.\s*send\s*\(/.test(code)) sites.push(file.replace(ROOT, ""));
  }
  sites.sort();

  // Four, and each one is deliberate:
  //   approve route        the reviewed reminder — the ONLY reminder send path
  //   reminder-sender      the auto-mode cron sender, gated off in beta
  //   welcome-email        transactional, to the account owner
  //   beta-access-email    transactional, to the account owner
  assert.deepEqual(sites, [
    "lib/approval-wiring.ts",
    "lib/beta-access-email.ts",
    "lib/reminder-sender.ts",
    "lib/welcome-email.ts",
  ]);
});

test("48. [static] the scheduled sender remains fail-closed in approval-only beta", () => {
  assert.equal(BETA_APPROVAL_ONLY, true, "the founding-beta gate must be on");

  const cron = readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8");
  const code = stripComments(cron);

  // The gate itself: a stored 'auto' profile can never produce a send while
  // the flag holds, because the flag is ANDed in, not consulted as a default.
  assert.match(code, /const isAutoMode\s*=\s*!BETA_APPROVAL_ONLY\s*&&\s*storedAutoMode/);
  assert.match(code, /if\s*\(isAutoMode\)/);

  // And it fails closed on missing configuration rather than running open.
  assert.match(code, /if\s*\(!cronSecret\)/);
  assert.match(code, /authHeader\s*!==\s*`Bearer \$\{cronSecret\}`/);
});

test("48b. [static] the reconciliation cron is registered and protected", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const paths = vercel.crons.map((c: { path: string }) => c.path);
  assert.ok(paths.includes("/api/cron/reconcile-reminders"), "the route must be scheduled");

  const entry = vercel.crons.find(
    (c: { path: string }) => c.path === "/api/cron/reconcile-reminders"
  );
  assert.match(entry.schedule, /^\S+ \S+ \S+ \S+ \S+$/, "a valid five-field cron expression");

  const route = readFileSync(
    join(ROOT, "app/api/cron/reconcile-reminders/route.ts"),
    "utf8"
  );
  assert.match(stripComments(route), /isAuthorisedCronRequest\(/);
  // It must never gain a send path.
  assert.equal(/emails\s*\.\s*send\s*\(/.test(route), false);
});

test("49. [static] opening or refreshing the review page performs no write and no send", () => {
  const loader = stripComments(
    readFileSync(join(ROOT, "lib/reminder-review.ts"), "utf8")
  );
  for (const forbidden of [/\.update\s*\(/, /\.insert\s*\(/, /\.upsert\s*\(/, /\.delete\s*\(/, /emails\s*\.\s*send/]) {
    assert.equal(forbidden.test(loader), false, `review loader must not match ${forbidden}`);
  }

  const page = stripComments(
    readFileSync(join(ROOT, "app/dashboard/reminders/[id]/review/page.tsx"), "utf8")
  );
  assert.equal(/emails\s*\.\s*send/.test(page), false);
  assert.match(page, /loadReminderReview\(/);
});

test("49b. every blocked review state has its own distinct copy", () => {
  const statuses: ReminderSendStatus[] = [
    "pending",
    "sending",
    "sent",
    "dismissed",
    "failed",
    "delivery_unknown",
    "undelivered",
  ];

  // The rule the page renders and the route enforces is one function.
  // channelStructureReady: true throughout — this block is exercising
  // status/eligibility-based blocking specifically, with channels genuinely
  // ready in every case; channel-row readiness itself is covered separately
  // in tests/channel-readiness.test.ts.
  assert.equal(reviewAvailability({ status: "pending", eligible: true, channelStructureReady: true, freshApproveReady: true }).approvable, true);
  assert.equal(reviewAvailability({ status: "failed", eligible: true, channelStructureReady: true, freshApproveReady: true }).approvable, true);
  assert.equal(reviewAvailability({ status: "failed", eligible: true, channelStructureReady: true, freshApproveReady: true }).blockedReason, "retryable");
  assert.equal(reviewAvailability({ status: "pending", eligible: false, channelStructureReady: true, freshApproveReady: true }).approvable, false);

  for (const status of statuses) {
    for (const eligible of [true, false]) {
      const { blockedReason, approvable } = reviewAvailability({ status, eligible, channelStructureReady: true, freshApproveReady: true });
      if (approvable) continue;
      assert.ok(blockedReason, `${status}/${eligible} must explain itself`);
      assert.ok(
        SEND_STATE_COPY[blockedReason as keyof typeof SEND_STATE_COPY],
        `${blockedReason} needs copy`
      );
    }
  }

  // Nothing accepted-but-undelivered may be offered a retry.
  assert.equal(reviewAvailability({ status: "undelivered", eligible: true, channelStructureReady: true, freshApproveReady: true }).approvable, false);
  assert.equal(
    reviewAvailability({ status: "delivery_unknown", eligible: true, channelStructureReady: true, freshApproveReady: true }).approvable,
    false
  );

  const titles = Object.values(SEND_STATE_COPY).map((c) => c.title);
  assert.equal(new Set(titles).size, titles.length, "no two states may share wording");
  assert.match(SEND_STATE_COPY.undelivered.body, /final delivery was unsuccessful/i);
  assert.match(SEND_STATE_COPY.undelivered.body, /nothing\s+will be resent automatically/i);
});

test("49c. [static] the review panel offers no retry after an accepted-but-undelivered result", () => {
  const panel = stripComments(
    readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8")
  );
  assert.match(panel, /result\.state === "undelivered"/);
  // "Retry sending" is offered for exactly one state.
  assert.match(panel, /blockedReason === "retryable"\s*\?\s*"Retry sending"/);
});

test("50. [service] no failure path can produce success feedback", async () => {
  type Case = [string, () => Promise<{ status: number; body: { success: boolean } }>];

  const cases: Case[] = [
    [
      "provider rejects",
      async () => {
        const db = new FakeApprovalDb();
        const mailer = new FakeMailer();
        mailer.behaviour = () => ({ ok: false, code: "validation_error", message: "no" });
        return approveAndSendReminder(makeDeps(db, mailer), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "provider ambiguous",
      async () => {
        const db = new FakeApprovalDb();
        const mailer = new FakeMailer();
        mailer.behaviour = () => ({ ok: false, code: "internal_server_error", message: "?" });
        return approveAndSendReminder(makeDeps(db, mailer), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "provider throws",
      async () => {
        const db = new FakeApprovalDb();
        const mailer = new FakeMailer();
        mailer.throws = new Error("ECONNRESET");
        return approveAndSendReminder(makeDeps(db, mailer), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "database fails after acceptance",
      async () => {
        const db = new FakeApprovalDb();
        db.recordAcceptedError = "connection lost";
        const mailer = new FakeMailer();
        return approveAndSendReminder(makeDeps(db, mailer), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "claim fails",
      async () => {
        const db = new FakeApprovalDb();
        db.claimError = "deadlock";
        const mailer = new FakeMailer();
        return approveAndSendReminder(makeDeps(db, mailer), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "no provider configured",
      async () => {
        const db = new FakeApprovalDb();
        return approveAndSendReminder(makeDeps(db, null), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
    [
      "stale review",
      async () => {
        const db = new FakeApprovalDb();
        const token = await freshToken(db);
        db.get().invoice.amount = 1;
        return approveAndSendReminder(makeDeps(db, new FakeMailer()), {
          reminderId: REMINDER_ID,
          reviewToken: token,
        });
      },
    ],
    [
      "not eligible",
      async () => {
        const base = makeStoredReminder();
        const db = new FakeApprovalDb([
          makeStoredReminder({ invoice: { ...base.invoice, dueDate: ineligibleDueDate() } }),
        ]);
        return approveAndSendReminder(makeDeps(db, new FakeMailer()), {
          reminderId: REMINDER_ID,
          reviewToken: await freshToken(db),
        });
      },
    ],
  ];

  for (const [label, run] of cases) {
    const result = await run();
    assert.equal(result.body.success, false, `${label} must not report success`);
    assert.notEqual(result.status, 200, `${label} must not return 200`);
  }
});

/**
 * SCENARIOS 51–60. Added after the real Stage B run against production found
 * nine defects — see the audit for full root-cause detail. Each test below
 * exists to catch exactly the failure that was observed, not a hypothetical
 * one.
 */

test("51. [static] no stale 'SMS is coming/preview only' copy remains in the reminder journey", () => {
  const STALE = [
    /coming in the next version/i,
    /sms sending will be enabled/i,
    /preview only.{0,20}sms/i,
    /sms.{0,20}preview.{0,10}ready/i,
  ];
  const offenders: string[] = [];
  for (const file of [...sourceFiles("components"), ...sourceFiles("app"), ...sourceFiles("lib")]) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (STALE.some((re) => re.test(code))) offenders.push(file.replace(ROOT, ""));
  }
  assert.deepEqual(offenders, [], "SMS is live — no copy may claim otherwise");
});

test("52. [static] the duplicate channel-picker step no longer exists", () => {
  for (const file of [...sourceFiles("components"), ...sourceFiles("app")]) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.equal(/ChannelPickerModal/.test(code), false, `${file.replace(ROOT, "")} must not reference the removed picker`);
    assert.equal(/Choose reminder channels/.test(code), false, `${file.replace(ROOT, "")} must not offer a channel choice`);
  }
});

test("53. [static] the final review page loads and renders both the email and the SMS content", () => {
  const loader = stripComments(readFileSync(join(ROOT, "lib/reminder-review.ts"), "utf8"));
  assert.match(loader, /smsBody\s*:\s*string/, "ReminderReviewData must carry the SMS body");
  assert.match(loader, /current\.sms\.body/, "must read the real composed SMS content");

  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  assert.match(panel, /SMS reminder/, "the panel must render a distinct SMS section");
  assert.match(panel, /data\.smsBody/, "the SMS section must render the real stored/composed text");
});

test("54. [service] resolveSenderIdentity never falls back to an email address", () => {
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: "Wilson Plumbing" })?.senderName, "Wilson Plumbing");
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: "  Wilson Plumbing  " })?.senderName, "Wilson Plumbing");
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: null }), null);
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: undefined }), null);
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: "" }), null);
  assert.equal(resolveSenderIdentity({ preference: "business", businessName: "   " }), null);
  // NULL preference refuses outright — never inferred from whichever name
  // field is populated.
  assert.equal(resolveSenderIdentity({ preference: null, businessName: "Wilson Plumbing" }), null);
  // There is no email field anywhere in the input shape — the resolver
  // structurally cannot read an account email even if a caller tried.
  assert.deepEqual(
    Object.keys(resolveSenderIdentity({ preference: "business", businessName: "Wilson Plumbing" }) ?? {}).sort(),
    ["kind", "senderName"]
  );
});

test("55. [service] approveAndSendReminder refuses to send when sender identity is unresolved", async () => {
  const db = new FakeApprovalDb();
  db.businessName = null; // senderIdentity defaults to "business" — blank business_name refuses
  const mailer = new FakeMailer();
  const allowance = new FakeAllowanceStore();
  const deps = makeDeps(db, mailer, { allowance });

  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.body.success, false);
  assert.equal(result.body.state, "missing_sender_identity");
  assert.equal(result.body.reason, "business_name_missing");
  assert.equal(result.status, 409);
  assert.equal(mailer.calls.length, 0, "no email may be composed or sent without a resolved identity");
  assert.equal(
    (deps.texter as FakeTexter).calls.length,
    0,
    "no SMS may be composed or sent without a resolved identity"
  );
  // Cheap refusal, same position as the phone check: no allowance unit may
  // be spent deciding not to send.
  assert.deepEqual(allowance.calls, []);
});

test("55b. [service] approveAndSendReminder refuses with preference_missing when sender_identity is NULL", async () => {
  const db = new FakeApprovalDb();
  db.senderIdentity = null; // genuinely unconfigured — business_name being set does not matter
  const mailer = new FakeMailer();
  const deps = makeDeps(db, mailer);

  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.body.state, "missing_sender_identity");
  assert.equal(result.body.reason, "preference_missing");
  assert.equal(mailer.calls.length, 0);
});

test("55c. [service] approveAndSendReminder never falls back to personal_name for a Business preference", async () => {
  const db = new FakeApprovalDb();
  db.businessName = null;
  db.personalName = "Sam Alobaydi"; // populated, but must be ignored
  const mailer = new FakeMailer();
  const deps = makeDeps(db, mailer);

  const result = await approveAndSendReminder(deps, {
    reminderId: REMINDER_ID,
    reviewToken: await freshToken(db),
  });

  assert.equal(result.body.state, "missing_sender_identity");
  assert.equal(result.body.reason, "business_name_missing");
  assert.equal(mailer.calls.length, 0, "must refuse rather than silently send as Sam Alobaydi");
});

test("56. [service] retryReminderChannel refuses when sender identity is unresolved", async () => {
  const db = new FakeApprovalDb([makeStoredReminder({ status: "sent", sendAttemptCount: 1 })]);
  db.businessName = null;
  const mailer = new FakeMailer();
  const texter = new FakeTexter();
  const channelDb = new FakeChannelDb([
    { channel: "email", status: "sent", sendAttemptCount: 1 },
    { channel: "sms", status: "failed", sendAttemptCount: 1 },
  ]);
  const allowance = new FakeAllowanceStore();
  const deps = makeDeps(db, mailer, { texter, channelDb, allowance });

  const result = await retryReminderChannel(deps, { reminderId: REMINDER_ID, channel: "sms" });

  assert.equal(result.body.success, false);
  assert.equal(result.body.state, "missing_sender_identity");
  assert.equal(result.body.reason, "business_name_missing");
  assert.equal(texter.calls.length, 0, "the retried channel must not be dispatched without a resolved identity");
  assert.deepEqual(allowance.calls, [], "recovery must not touch the allowance regardless of this refusal");
});

test("57. [static] Prepare Reminder calls the prepare route directly, with no channel-selection step", () => {
  const list = stripComments(readFileSync(join(ROOT, "components/dashboard/ActiveChasingList.tsx"), "utf8"));
  assert.match(list, /onClick=\{prepare\}/, "the button must call prepare() directly");
  assert.equal(/setPickerInvoice|pickerInvoice/.test(list), false, "no picker state may remain");
});

test("58. [static] approving a reminder refreshes the dashboard's cached state before navigating away", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const refetchIdx = panel.indexOf("refetchAfterReminderAction()");
  const allowanceIdx = panel.indexOf("refetchAllowance()");
  const pushIdx = panel.indexOf("router.push(");
  assert.ok(refetchIdx > -1, "must refetch reminders/invoices/channel statuses after a send");
  assert.ok(allowanceIdx > -1, "must refetch the allowance count after a send");
  assert.ok(pushIdx > -1);
  assert.ok(refetchIdx < pushIdx, "the reminders/invoices refetch must happen BEFORE navigating");
  assert.ok(allowanceIdx < pushIdx, "the allowance refetch must happen BEFORE navigating");
});

test("59. [static] the post-send confirmation is channel-aware for a genuine two-channel success", () => {
  const confirmation = stripComments(
    readFileSync(join(ROOT, "components/dashboard/SentConfirmation.tsx"), "utf8")
  );
  assert.match(confirmation, /channelStatuses/, "must read real per-channel state, not fixed copy");
  assert.match(
    confirmation,
    /statuses\?\.email === "sent" && statuses\?\.sms === "sent"/,
    "must distinguish a genuine SMS+email pair from the generic fallback"
  );
});

test("59b. [static] partial/ambiguous/failed outcomes never reach the post-send confirmation", () => {
  // ── THE ARCHITECTURAL GUARANTEE SentConfirmation.tsx RELIES ON ──────────
  //
  // An earlier version of the confirmation ALSO tried to render a partial
  // outcome — dead code, because onApprove() only ever navigates here on a
  // clean success. This test pins the guarantee directly against
  // approveAndSendReminder()'s actual return shapes, rather than trusting a
  // comment. If any of these three outcomes ever gained `success: true`,
  // this test would fail — which is exactly the signal needed before
  // relying on SentConfirmation to represent that outcome truthfully.
  const approval = stripComments(readFileSync(join(ROOT, "lib/reminder-approval.ts"), "utf8"));

  // The rejected/all-failed branch. lastIndexOf, not indexOf: the FIRST
  // occurrence of this literal text is the TexterResult type declaration
  // ({ ok: false; outcome: "rejected" | "unknown"; ... }), not a return
  // statement — the actual `outcome: "rejected"` return is later.
  const rejectedIdx = approval.lastIndexOf('outcome: "rejected"');
  const rejectedBlock = approval.slice(rejectedIdx - 400, rejectedIdx + 50);
  assert.match(rejectedBlock, /success:\s*false/, "a fully-rejected send must report success:false");

  // The delivery_unknown branches (there are two: mid-approve, and after
  // persistence fails post-acceptance) — both must be success:false.
  let idx = approval.indexOf('outcome: "delivery_unknown"');
  let found = 0;
  while (idx !== -1) {
    const block = approval.slice(Math.max(0, idx - 400), idx + 50);
    assert.match(block, /success:\s*false/, "a delivery_unknown outcome must report success:false");
    found++;
    idx = approval.indexOf('outcome: "delivery_unknown"', idx + 1);
  }
  assert.ok(found >= 2, "expected at least two delivery_unknown return sites");

  // The partial-send branch.
  const partialIdx = approval.lastIndexOf('outcome: "partially_sent"');
  const partialBlock = approval.slice(partialIdx - 400, partialIdx + 50);
  assert.match(partialBlock, /success:\s*false/, "a partial send must report success:false");

  // And the panel's own navigation guard: it only pushes to the
  // confirmation route inside the success branch, never the failure one.
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const firstIfNotSuccess = panel.indexOf("if (!result.success)");
  const routerPush = panel.indexOf("router.push(");
  assert.ok(firstIfNotSuccess > -1 && routerPush > -1);
  assert.ok(firstIfNotSuccess < routerPush, "the non-success branch must return before navigation is reachable");
});

test("60. [static] the review page shows the invoice's live due status beside the checkpoint name", () => {
  const loader = stripComments(readFileSync(join(ROOT, "lib/reminder-review.ts"), "utf8"));
  assert.match(loader, /dueStatusLabel/);
  assert.match(loader, /getDueStatusLabel\(/);

  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  assert.match(panel, /data\.dueStatusLabel/);
});

/**
 * SCENARIOS 61+. Added for the second Stage B cleanup pass: the allowance
 * header regression, truthful paired history, the removed "Reminder state"
 * column, and the SentConfirmation architecture decision above.
 */

test("61. [static] the Reminder state column no longer exists in Active Chasing", () => {
  const list = stripComments(readFileSync(join(ROOT, "components/dashboard/ActiveChasingList.tsx"), "utf8"));
  assert.equal(/Reminder state/.test(list), false, "the permanent column header must be gone");
  // Six columns now: the leading disclosure column (added back in the next
  // pass, see test 64) + Customer + Amount + Due + Status + Actions. The
  // desktop history row must span exactly that many, or the collapsed
  // detail panel misaligns under the table.
  assert.match(list, /colSpan=\{6\}/);
});

test("62. [static] actionable/abnormal reminder states still render on the row, not only in history", () => {
  const list = stripComments(readFileSync(join(ROOT, "components/dashboard/ActiveChasingList.tsx"), "utf8"));
  // Both render sites (mobile card, desktop row) must gate the pill on
  // rs.pill — never render it unconditionally (that would be the old
  // permanent-column behaviour) and never drop it entirely (that would hide
  // Partially sent / Ready for review / Reminder limit reached).
  const pillGates = list.match(/\{rs\.pill (?:&&|\?)/g) ?? [];
  assert.ok(pillGates.length >= 2, `expected pill rendering gated on rs.pill at both render sites, found ${pillGates.length}`);
});

test("63. [static] the allowance context is genuinely re-armed across Strict Mode's double mount", () => {
  const guard = stripComments(readFileSync(join(ROOT, "lib/mount-guard.ts"), "utf8"));
  assert.match(guard, /onMount\(\)\s*\{\s*mounted = true;/);
  assert.match(guard, /onCleanup\(\)\s*\{\s*mounted = false;/);

  const ctx = stripComments(readFileSync(join(ROOT, "components/dashboard/BetaAllowanceContext.tsx"), "utf8"));
  // onMount() must run INSIDE the effect body (so it re-arms on every
  // invocation, including Strict Mode's second one) — not once outside it.
  const effectIdx = ctx.indexOf("useEffect(() => {\n    guard.current.onMount();");
  assert.ok(effectIdx > -1, "guard.current.onMount() must be the first statement inside the mount effect");
});

// ── Sender-identity audit (customer-facing identity leak) ──────────────────
//
// A real customer received a reminder signed with the account's own login
// email. Two files independently rebuilt the same unsafe fallback chain
// (business name, else the account email, else "ServiceSignal") by hand,
// separately from the already-safe resolveBusinessName() used by the actual
// send path. These pin both fixes so the pattern cannot silently return.

test("64. [static] the send-reminders cron never falls back to the account email for its stored subject", () => {
  const code = stripComments(readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8"));
  assert.equal(/senderName\s*=[\s\S]{0,80}userEmailMap\.get/.test(code), false,
    "the cron's senderName must not fall back to the account email map");
  assert.match(code, /resolveSenderIdentityForDisplay\(\{\s*preference: profile\.sender_identity,/);
  // The dormant Auto branch must independently strict-resolve before it
  // could ever reach a provider call — see test 66c below for the fuller
  // proof; this pins the display-vs-strict distinction at the call level.
  assert.match(code, /resolveSenderIdentity\(\{\s*preference: profile\.sender_identity,/);
});

test("65. [static] the onboarding reminder preview never falls back to the account email", () => {
  const code = stripComments(readFileSync(join(ROOT, "app/api/onboarding/reminder-preview/route.ts"), "utf8"));
  assert.equal(/senderName\s*=[\s\S]{0,80}context\.user\.email/.test(code), false,
    "the onboarding preview's senderName must not fall back to the account email");
  assert.match(code, /resolveSenderIdentityForDisplay\(\{\s*preference: context\.kind === "ready" \? context\.senderIdentity : null,/);
});

test("66. [static] every display resolution reads through the canonical resolver with an explicit preference", () => {
  // Every remaining display-only caller must pass `preference` — never the
  // old business-first-fallback shape, which no longer exists on the
  // resolver at all (a call site missing `preference` is now a type error,
  // not a silent behaviour change).
  for (const file of [
    "lib/reminder-review.ts",
    "lib/invoice-lifecycle-db.ts",
    "app/api/reminders/[id]/content/route.ts",
  ]) {
    const code = stripComments(readFileSync(join(ROOT, file), "utf8"));
    assert.equal(/resolveBusinessName\(/.test(code), false,
      `${file} must not call the retired resolveBusinessName`);
    // Either canonical resolver is acceptable — resolveSenderIdentityForDisplay()
    // when only the display string is needed, resolveSenderIdentity() directly
    // when the caller also needs .kind (for SMS wording). What matters is that
    // it is ONE of the two, called with an explicit `preference`, never a
    // re-implemented fallback chain.
    assert.match(
      code,
      /resolveSenderIdentity(ForDisplay)?\(\{\s*preference:/,
      `${file} must read through a canonical resolver with an explicit preference`
    );
  }
});

test("66b. [static] resolveBusinessName no longer exists anywhere in the codebase", () => {
  const approval = stripComments(readFileSync(join(ROOT, "lib/reminder-approval.ts"), "utf8"));
  assert.equal(/function resolveBusinessName/.test(approval), false,
    "resolveBusinessName must be retired, not kept as an alias that could misrepresent a personal identity as a business one");
});

test("66c. [static] the dormant Auto cron branch strict-resolves identity before any provider call", () => {
  const code = stripComments(readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8"));
  const autoBranch = code.slice(code.indexOf("if (isAutoMode) {"));
  const gateIdx = autoBranch.indexOf("resolveSenderIdentity(");
  const sendIdx = autoBranch.indexOf("sendAndUpdateLog(");
  assert.ok(gateIdx > -1, "the Auto branch must strict-resolve identity");
  assert.ok(sendIdx > -1, "the Auto branch must still call sendAndUpdateLog when it does run");
  assert.ok(gateIdx < sendIdx, "the strict identity gate must sit BEFORE the provider call");
  assert.match(autoBranch.slice(gateIdx, sendIdx), /if \(!identity\)/, "must refuse (not merely check) before proceeding");
});

test("66d. [static] the dormant Auto cron branch sends under the SAME resolved-identity From header as Approve/Retry, never the generic REMINDER_FROM", () => {
  // The defect this guards: the branch built subject/body correctly from
  // the resolved senderName, but dispatched via sendAndUpdateLog(), which
  // hardcoded `from: REMINDER_FROM` ("ServiceSignal <...>") regardless — so
  // a customer would see a body signed by the resolved identity under a
  // From name that said "ServiceSignal". One coherent rule across every
  // send path means this branch must build its From header the identical
  // way lib/reminder-approval.ts does: reminderFromHeader(identity.senderName, ...).
  const code = stripComments(readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8"));
  const autoBranch = code.slice(code.indexOf("if (isAutoMode) {"));

  assert.match(
    autoBranch,
    /from:\s*reminderFromHeader\(identity\.senderName,\s*REMINDER_FROM_ADDRESS\)/,
    "the auto-send call must build its From header from the just-resolved strict identity"
  );
  assert.equal(/from:\s*REMINDER_FROM[,)]/.test(autoBranch), false,
    "must never fall back to the generic REMINDER_FROM once an identity has been resolved");

  const sendIdx = autoBranch.indexOf("sendAndUpdateLog(");
  const fromIdx = autoBranch.indexOf("from: reminderFromHeader(");
  assert.ok(fromIdx > sendIdx, "the resolved From header must be part of the sendAndUpdateLog() call itself");
});

// ── Cleanup pass: the stale generic ApprovalDeps.from dependency ───────────

test("67. [static] ApprovalDeps declares no generic 'from' field — nothing to rediscover a hardcoded ServiceSignal value through", () => {
  const approval = stripComments(readFileSync(join(ROOT, "lib/reminder-approval.ts"), "utf8"));
  const ifaceStart = approval.indexOf("export interface ApprovalDeps {");
  assert.ok(ifaceStart > -1, "ApprovalDeps must still exist");
  const ifaceEnd = approval.indexOf("\n}", ifaceStart);
  const iface = approval.slice(ifaceStart, ifaceEnd);
  assert.equal(/^\s*from\s*:/m.test(iface), false,
    "ApprovalDeps must not declare a from field — every send composes its own resolved-identity header instead");
});

test("67b. [static] makeApprovalDeps() sets no generic from default, and lib/resend.ts exports no generic REMINDER_FROM constant", () => {
  const wiring = stripComments(readFileSync(join(ROOT, "lib/approval-wiring.ts"), "utf8"));
  assert.equal(/from\s*:\s*REMINDER_FROM\b/.test(wiring), false,
    "makeApprovalDeps must not default to a generic from value");
  assert.equal(/import\s*\{[^}]*\bREMINDER_FROM\b[^_][^}]*\}\s*from\s*"@\/lib\/resend"/.test(wiring), false,
    "the generic REMINDER_FROM constant must not even be imported here");

  const resend = readFileSync(join(ROOT, "lib/resend.ts"), "utf8");
  assert.equal(/export const REMINDER_FROM\s*=/.test(resend), false,
    "lib/resend.ts must not export a generic ServiceSignal From constant for reminders");
  assert.match(resend, /export const REMINDER_FROM_ADDRESS/,
    "the address constant itself must still exist — only the generic display-name constant is gone");
});

// ── Owner-facing preview: no redundant identity, no raw transport address ──

test("68. [static] no owner-facing preview surface renders the raw transport address", () => {
  for (const file of [
    "components/dashboard/ReminderReviewPanel.tsx",
    "components/onboarding/ReminderReview.tsx",
  ]) {
    const code = readFileSync(join(ROOT, file), "utf8");
    assert.equal(/reminders@servicesignal\.app/.test(code), false,
      `${file} must never render the raw transport address as owner-facing text`);
  }
});

test("69. [static] neither preview API builds its owner-facing 'delivered by' text from the send-time RFC-5322 header", () => {
  // reminderFromHeader() composes the ACTUAL email header (identity + raw
  // address) — correct for a send, but exactly the redundant, address-leaking
  // text ("Buildscape Ltd · delivered by Buildscape Ltd <reminders@...>")
  // when reused for a preview screen. Preview text must be a fixed platform
  // label instead.
  for (const file of [
    "app/api/reminders/[id]/content/route.ts",
    "app/api/onboarding/reminder-preview/route.ts",
  ]) {
    const code = readFileSync(join(ROOT, file), "utf8");
    assert.equal(/deliveredBy:\s*reminderFromHeader\(/.test(code), false,
      `${file} must not build owner-facing preview text from the send-time header builder`);
    assert.match(code, /deliveredBy:\s*SENDER_DISPLAY_FALLBACK/,
      `${file} must use the fixed platform label instead`);
  }
});

// ── Transport domain vs. customer-facing identity ───────────────────────────

test("70. the ServiceSignal transport domain still exists and still appears in the real send-time header — this is expected and acceptable", () => {
  // The correct guarantee is narrower than "ServiceSignal never appears
  // anywhere": ServiceSignal is not the customer-facing CHASING IDENTITY,
  // but its domain may still be the sending infrastructure. This test locks
  // down that the address itself is untouched by the identity-presentation
  // fixes, so a future change cannot quietly also change infrastructure.
  assert.equal(REMINDER_FROM_ADDRESS, "reminders@servicesignal.app");
  const header = reminderFromHeader("Buildscape Ltd", REMINDER_FROM_ADDRESS);
  assert.match(header, /<reminders@servicesignal\.app>$/, "the transport address is still the real send address");
  assert.notEqual(header, "Buildscape Ltd", "but it is never presented AS the identity — only alongside it, in the header's address part");
});

// ── senderKind threaded consistently across the whole lifecycle ────────────

test("71. [static] every real content-generation call site threads senderKind, not just senderName", () => {
  const sites = [
    "app/api/reminders/prepare/route.ts",
    "lib/reminder-approval.ts",
    "lib/reminder-regenerate.ts",
    "lib/reminder-review.ts",
    "app/api/reminders/[id]/content/route.ts",
    "lib/invoice-lifecycle-db.ts",
  ];
  for (const file of sites) {
    const code = readFileSync(join(ROOT, file), "utf8");
    assert.match(code, /senderKind:/, `${file} must pass senderKind alongside senderName, so SMS wording is never guessed from the name string`);
  }
});

// ── 72+. approveLocked: distinct from `busy`, for channel_state_not_ready ──
// ── and fresh_approve_not_ready only ────────────────────────────────────────
//
// Neither state means "a request is in flight" — both mean the request has
// ALREADY finished and Approve is not currently valid. Conflating them with
// `busy` would leave the button/status text falsely claiming "Sending…" /
// "please wait" after the server has already answered. These tests pin the
// separation directly against the component's source, matching this file's
// existing static-assertion style (there is no rendering harness in this
// repo — see tests 47-71 above).

test("72. [static] approveLocked is a state distinct from busy, initialised false", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  assert.match(panel, /const\s*\[\s*approveLocked\s*,\s*setApproveLocked\s*\]\s*=\s*useState\(false\)/);
});

test("72b. [static] A/B — channel_state_not_ready and fresh_approve_not_ready both set approveLocked, and NEITHER stays in unsafeToRetry", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const onApproveStart = panel.indexOf("const onApprove");
  const onApproveEnd = panel.indexOf("return (", onApproveStart);
  const onApprove = panel.slice(onApproveStart, onApproveEnd);

  const unsafeToRetryStart = onApprove.indexOf("const unsafeToRetry");
  const unsafeToRetryEnd = onApprove.indexOf(";", onApprove.indexOf("ALLOWANCE_EXHAUSTED_STATE", unsafeToRetryStart));
  const unsafeToRetryBlock = onApprove.slice(unsafeToRetryStart, unsafeToRetryEnd);

  assert.equal(
    /channel_state_not_ready/.test(unsafeToRetryBlock),
    false,
    "channel_state_not_ready must NOT be part of unsafeToRetry — the request has finished, busy must reset"
  );
  assert.equal(
    /fresh_approve_not_ready/.test(unsafeToRetryBlock),
    false,
    "fresh_approve_not_ready must NOT be part of unsafeToRetry anymore — it moved to the dedicated lock"
  );

  // The dedicated lock: both states, and ONLY both states, set it.
  const lockCallCount = (onApprove.match(/setApproveLocked\(true\)/g) ?? []).length;
  assert.equal(lockCallCount, 1, "exactly one call site sets the lock — no scattered duplicate logic");
  assert.match(
    onApprove,
    /result\.state === "channel_state_not_ready" \|\| result\.state === "fresh_approve_not_ready"/
  );

  // Both states must still fall through to the unconditional `if
  // (!unsafeToRetry) setBusy(false);` — since neither is in unsafeToRetry,
  // this line is what actually clears `busy` for them.
  assert.match(onApprove, /if\s*\(!unsafeToRetry\)\s*setBusy\(false\);/);
});

test("72c. [static] A/B — the error message is preserved (setError still runs unconditionally before any branching)", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const onApproveStart = panel.indexOf("const onApprove");
  const notSuccessIdx = panel.indexOf("if (!result.success)", onApproveStart);
  const setErrorIdx = panel.indexOf("setError(result.message)", notSuccessIdx);
  const unsafeToRetryIdx = panel.indexOf("const unsafeToRetry", notSuccessIdx);
  assert.ok(setErrorIdx > -1 && setErrorIdx < unsafeToRetryIdx, "setError(result.message) must run before any state-specific branching, unconditionally on every refusal");
});

test("72d. [static] C — the lock is set from exactly one condition; Retry and Regenerate never reference it, so a normal retryable/recoverable path is unaffected", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));

  const onRetryStart = panel.indexOf("const onRetryChannel");
  const onRetryEnd = panel.indexOf("const blocked =", onRetryStart);
  const onRetryChannel = panel.slice(onRetryStart, onRetryEnd);
  assert.equal(/approveLocked/.test(onRetryChannel), false, "onRetryChannel must never read or set approveLocked");

  const onRegenStart = panel.indexOf("const onRegenerate");
  const onRegenEnd = panel.indexOf("const onRetryChannel", onRegenStart);
  const onRegenerate = panel.slice(onRegenStart, onRegenEnd);
  assert.equal(/approveLocked/.test(onRegenerate), false, "onRegenerate must never read or set approveLocked");

  // Only the Approve button's own controls reference the lock.
  const retryButtonStart = panel.indexOf("onClick={onRetryChannel}");
  const retryButtonBlock = panel.slice(Math.max(0, retryButtonStart - 100), retryButtonStart + 300);
  assert.equal(/approveLocked/.test(retryButtonBlock), false, "the Retry button's own disabled condition must not reference approveLocked");

  const regenButtonStart = panel.indexOf("onClick={onRegenerate}");
  const regenButtonBlock = panel.slice(Math.max(0, regenButtonStart - 100), regenButtonStart + 300);
  assert.equal(/approveLocked/.test(regenButtonBlock), false, "the Regenerate button's own disabled condition must not reference approveLocked");
});

test("72e. [static] D — every pre-existing unsafeToRetry state is unchanged by this correction", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const onApproveStart = panel.indexOf("const onApprove");
  const unsafeToRetryStart = panel.indexOf("const unsafeToRetry", onApproveStart);
  const unsafeToRetryEnd = panel.indexOf(";", panel.indexOf("ALLOWANCE_EXHAUSTED_STATE", unsafeToRetryStart));
  const unsafeToRetryBlock = panel.slice(unsafeToRetryStart, unsafeToRetryEnd);

  for (const state of ["delivery_unknown", "undelivered", "stale_review", "identity_drift", "sending", "sent"]) {
    assert.match(unsafeToRetryBlock, new RegExp(`result\\.state === "${state}"`), `${state} must remain in unsafeToRetry, unchanged`);
  }
  assert.match(unsafeToRetryBlock, /ALLOWANCE_EXHAUSTED_STATE/, "the allowance-exhausted case must remain in unsafeToRetry, unchanged");
});

test("72f. [static] the lock joins the Approve button's disabled, aria-disabled, and opacity conditions — no other control", () => {
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const buttonIdx = panel.indexOf("onClick={onApprove}");
  const buttonBlock = panel.slice(buttonIdx, buttonIdx + 900);

  assert.match(buttonBlock, /disabled=\{busy \|\| !data\.approvable \|\| staleReview \|\| allowanceExhausted \|\| identityDrifted \|\| approveLocked\}/);
  assert.match(buttonBlock, /aria-disabled=\{busy \|\| !data\.approvable \|\| staleReview \|\| allowanceExhausted \|\| identityDrifted \|\| approveLocked\}/);
  assert.match(buttonBlock, /opacity:\s*busy \|\| !data\.approvable \|\| approveLocked \? 0\.6 : 1/);

  // "Sending…" is driven purely by `busy`, which this correction resets to
  // false for both locked states — the button text can never say "Sending…"
  // while the request that produced the lock has already finished.
  assert.match(buttonBlock, /\{busy\s*\?\s*"Sending…"/);
});

test("72g. [static] onApprove's own entry guard enforces approveLocked too — defence-in-depth, not just the button's disabled prop", () => {
  // The button's disabled attribute already stops ordinary DOM interaction
  // from ever calling onApprove while locked. This pins the SAME invariant
  // enforced a second time, inside the handler itself — matching the
  // pre-existing redundancy already present for `busy` and
  // `!data.approvable`, so the lock holds regardless of what invokes the
  // handler, not only literal button clicks.
  const panel = stripComments(readFileSync(join(ROOT, "components/dashboard/ReminderReviewPanel.tsx"), "utf8"));
  const onApproveStart = panel.indexOf("const onApprove");
  const guardLine = panel.slice(onApproveStart, panel.indexOf("\n", onApproveStart + 1) + 200);
  assert.match(
    guardLine,
    /if\s*\(\s*busy\s*\|\|\s*approveLocked\s*\|\|\s*!data\.approvable\s*\)\s*return;/,
    "onApprove's entry guard must check busy, approveLocked, and !data.approvable, in that order"
  );
});
