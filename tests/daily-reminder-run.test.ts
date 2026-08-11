import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  DAILY_RUN_UTC_HOUR,
  DAILY_RUN_CRON,
  dailyRunInstant,
  dailyRunHasHappened,
  isBeforeDailyRun,
  londonDateISO,
  assertRunHourIsSafe,
  canEmailCustomer,
} from "@/lib/daily-reminder-run";

/**
 * The daily run: when it happens, and who it will act on.
 *
 * THE DEFECT THESE EXIST FOR: "Coming up" compared checkpoints against today's
 * CALENDAR DATE and hid anything dated today, assuming the run had already
 * been. The run is at 08:00 UTC — 08:00 London in winter, 09:00 London in
 * summer — so for the first eight or nine hours of every day a real, imminent
 * reminder vanished from the page entirely: too late to be upcoming, too early
 * to exist in "Needs your attention".
 *
 * Every test below pins a specific instant. A date-only implementation passes
 * none of the BST boundary cases.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 2026-08-11 is BST (UTC+1). 2027-01-11 is GMT (UTC+0). */
const BST_DAY = "2026-08-11";
const GMT_DAY = "2027-01-11";

// ── Configuration cannot drift from what is actually deployed ──────────────

test("the run hour matches the cron expression registered in vercel.json", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const job = (vercel.crons ?? []).find(
    (c: { path: string }) => c.path === "/api/cron/send-reminders"
  );

  assert.ok(job, "the daily reminder cron must be registered");
  assert.equal(
    job.schedule,
    DAILY_RUN_CRON,
    "DAILY_RUN_UTC_HOUR and vercel.json disagree — the forecast would predict the wrong time"
  );
});

test("the configured hour keeps a UTC run inside the London day it belongs to", () => {
  assert.equal(assertRunHourIsSafe(), true);

  // The guard's whole point: at 23:00 UTC during BST it is already 00:00 the
  // next day in London, so "the run for London date D" stops being well
  // defined.
  assert.equal(assertRunHourIsSafe(23), false);
  assert.equal(assertRunHourIsSafe(22), true);
  assert.equal(assertRunHourIsSafe(0), true);
  assert.equal(assertRunHourIsSafe(-1), false);
});

test("the run instant is the London date at the configured UTC hour", () => {
  assert.equal(dailyRunInstant(BST_DAY).toISOString(), "2026-08-11T08:00:00.000Z");
  assert.equal(dailyRunInstant(GMT_DAY).toISOString(), "2027-01-11T08:00:00.000Z");
  assert.equal(DAILY_RUN_UTC_HOUR, 8);
});

// ── The London calendar date, across the BST offset ────────────────────────

test("today is the London date, not the UTC date", () => {
  // 23:30 UTC on 10 Aug is 00:30 London on 11 Aug — already tomorrow in the UK.
  assert.equal(londonDateISO(new Date("2026-08-10T23:30:00Z")), "2026-08-11");
  // In winter the two agree.
  assert.equal(londonDateISO(new Date("2027-01-10T23:30:00Z")), "2027-01-10");
});

// ── Has the run happened? ──────────────────────────────────────────────────

test("[BST] the run has not happened before 09:00 London", () => {
  // 00:30 London on the 11th. A date-only check called this "today, therefore
  // done" and hid the checkpoint for the next eight and a half hours.
  assert.equal(dailyRunHasHappened(new Date("2026-08-10T23:30:00Z")), false);
  // 07:00 London.
  assert.equal(dailyRunHasHappened(new Date("2026-08-11T06:00:00Z")), false);
  // 08:59:59 London — one second before the run.
  assert.equal(dailyRunHasHappened(new Date("2026-08-11T07:59:59Z")), false);
});

test("[BST] the run has happened from 09:00 London onwards", () => {
  // Exactly the run instant: inclusive, because the job is firing now and the
  // checkpoint belongs to it rather than to a forecast of it.
  assert.equal(dailyRunHasHappened(new Date("2026-08-11T08:00:00Z")), true);
  // 10:30 London.
  assert.equal(dailyRunHasHappened(new Date("2026-08-11T09:30:00Z")), true);
  // 23:00 London.
  assert.equal(dailyRunHasHappened(new Date("2026-08-11T22:00:00Z")), true);
});

test("[GMT] the same boundary, one hour earlier in local terms", () => {
  assert.equal(dailyRunHasHappened(new Date("2027-01-11T07:30:00Z")), false); // 07:30 London
  assert.equal(dailyRunHasHappened(new Date("2027-01-11T08:00:00Z")), true);  // 08:00 London
  assert.equal(dailyRunHasHappened(new Date("2027-01-11T08:30:00Z")), true);  // 08:30 London
});

// ── The predicate the forecast actually calls ──────────────────────────────

test("a checkpoint dated today is still upcoming until the run fires", () => {
  // BST, before the run.
  assert.equal(isBeforeDailyRun(BST_DAY, new Date("2026-08-10T23:30:00Z")), true);
  assert.equal(isBeforeDailyRun(BST_DAY, new Date("2026-08-11T07:59:59Z")), true);

  // BST, at and after the run.
  assert.equal(isBeforeDailyRun(BST_DAY, new Date("2026-08-11T08:00:00Z")), false);
  assert.equal(isBeforeDailyRun(BST_DAY, new Date("2026-08-11T09:30:00Z")), false);

  // GMT, both sides.
  assert.equal(isBeforeDailyRun(GMT_DAY, new Date("2027-01-11T07:30:00Z")), true);
  assert.equal(isBeforeDailyRun(GMT_DAY, new Date("2027-01-11T08:30:00Z")), false);
});

test("past checkpoints are never upcoming, and future ones always are", () => {
  const midMorning = new Date("2026-08-11T09:30:00Z");

  // Yesterday: missed. Manual "Prepare reminder" covers it; a forecast must
  // not claim it is still coming.
  assert.equal(isBeforeDailyRun("2026-08-10", midMorning), false);
  assert.equal(isBeforeDailyRun("2026-07-01", midMorning), false);

  // AND before today's run has fired — the combination that matters.
  //
  // Without an explicit past check, a missed checkpoint falls through to
  // "has today's run happened?", which is false at 07:00 London, so a
  // reminder that was skipped days ago would be reported as still coming.
  // Answering "not yet" about yesterday is the same class of error as the
  // BST bug, pointing the other way.
  for (const early of ["2026-08-10T23:30:00Z", "2026-08-11T06:00:00Z", "2026-08-11T07:59:59Z"]) {
    assert.equal(isBeforeDailyRun("2026-08-10", new Date(early)), false, `yesterday at ${early}`);
    assert.equal(isBeforeDailyRun("2026-06-15", new Date(early)), false, `weeks ago at ${early}`);
  }

  // Tomorrow and beyond, regardless of the hour today.
  assert.equal(isBeforeDailyRun("2026-08-12", midMorning), true);
  assert.equal(isBeforeDailyRun("2026-08-12", new Date("2026-08-11T00:10:00Z")), true);
  assert.equal(isBeforeDailyRun("2026-09-30", midMorning), true);
});

// ── The shared eligibility predicate ───────────────────────────────────────

test("canEmailCustomer accepts what the job can send to and rejects what it cannot", () => {
  for (const ok of ["dave@example.co.uk", "a@b.co", "first.last+tag@sub.domain.org"]) {
    assert.equal(canEmailCustomer(ok), true, ok);
  }
  for (const bad of ["", "   ", "not-an-email", "missing@domain", "@example.com", "a b@c.com", null, undefined]) {
    assert.equal(canEmailCustomer(bad as string), false, JSON.stringify(bad));
  }
});

test("[static] the cron and the forecast share one email predicate, not two copies", () => {
  const cron = readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8");
  const upcoming = readFileSync(join(ROOT, "lib/overview-upcoming.ts"), "utf8");

  for (const [name, code] of [["cron", cron], ["overview-upcoming", upcoming]] as const) {
    assert.match(code, /canEmailCustomer/, `${name} must call the shared predicate`);
    assert.equal(
      /const EMAIL_RE\s*=/.test(code),
      false,
      `${name} must not keep a private copy of the address rule`
    );
  }
});

test("[static] the cron resolves 'today' in Europe/London explicitly", () => {
  const cron = readFileSync(join(ROOT, "app/api/cron/send-reminders/route.ts"), "utf8");
  const code = cron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(code, /const today = getTodayLondonDate\(\)/);
  assert.equal(
    /const today = new Date\(\)/.test(code),
    false,
    "the raw instant made 'today' the UTC date, which only matched London by coincidence"
  );
});
