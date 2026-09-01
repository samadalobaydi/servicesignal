import { test } from "node:test";
import assert from "node:assert/strict";
import { statusBadgeFor } from "@/lib/status-badge";

/**
 * Real (executed, not grepped) coverage of the Active Chasing status-badge
 * decision. "overdue" -> null is deliberate: the Due column's date line
 * already states "N days overdue" in red, so a same-row badge would repeat
 * the identical fact a second time. See the "days-overdue text must stay
 * red" check in tests/allowance-preparation.test.ts for the surviving
 * indicator this decision leans on.
 */

test("statusBadgeFor: overdue renders no badge", () => {
  assert.equal(statusBadgeFor("overdue"), null);
});

test("statusBadgeFor: unpaid renders a badge", () => {
  const info = statusBadgeFor("unpaid");
  assert.ok(info);
  assert.equal(info?.label, "Unpaid");
});

test("statusBadgeFor: paid renders a badge", () => {
  const info = statusBadgeFor("paid");
  assert.ok(info);
  assert.equal(info?.label, "Paid");
});

test("statusBadgeFor: unpaid and paid use distinct colours", () => {
  const unpaid = statusBadgeFor("unpaid");
  const paid = statusBadgeFor("paid");
  assert.ok(unpaid && paid);
  assert.notEqual(unpaid?.color, paid?.color);
  assert.notEqual(unpaid?.bg, paid?.bg);
});
