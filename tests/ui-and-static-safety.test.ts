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
  REMINDER_ID,
  freshToken,
  ineligibleDueDate,
  makeDeps,
  makeStoredReminder,
} from "./support/fakes";

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
    "app/api/reminders/[id]/approve/route.ts",
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
  assert.equal(reviewAvailability({ status: "pending", eligible: true }).approvable, true);
  assert.equal(reviewAvailability({ status: "failed", eligible: true }).approvable, true);
  assert.equal(reviewAvailability({ status: "failed", eligible: true }).blockedReason, "retryable");
  assert.equal(reviewAvailability({ status: "pending", eligible: false }).approvable, false);

  for (const status of statuses) {
    for (const eligible of [true, false]) {
      const { blockedReason, approvable } = reviewAvailability({ status, eligible });
      if (approvable) continue;
      assert.ok(blockedReason, `${status}/${eligible} must explain itself`);
      assert.ok(
        SEND_STATE_COPY[blockedReason as keyof typeof SEND_STATE_COPY],
        `${blockedReason} needs copy`
      );
    }
  }

  // Nothing accepted-but-undelivered may be offered a retry.
  assert.equal(reviewAvailability({ status: "undelivered", eligible: true }).approvable, false);
  assert.equal(
    reviewAvailability({ status: "delivery_unknown", eligible: true }).approvable,
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
