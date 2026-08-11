import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcileReminders } from "@/lib/reminder-reconcile";
import { isAuthorisedCronRequest } from "@/lib/cron-auth";
import { SEND_LEASE_SECONDS } from "@/lib/reminder-send-state";
import {
  FakeProviderLookup,
  FakeReconcileDb,
  makeStoredReminder,
} from "./support/fakes";

/**
 * SCENARIOS 37–45 — reconciliation.
 *
 * The whole point of this module is that it settles uncertainty WITHOUT ever
 * sending. Every test therefore also holds it to that: FakeReconcileDb has no
 * mailer, and the module has no send port to give it one.
 */

const NOW = new Date("2026-07-29T12:00:00Z");
const LONG_AGO = new Date(NOW.getTime() - (SEND_LEASE_SECONDS + 600) * 1000).toISOString();
const JUST_NOW = new Date(NOW.getTime() - 5_000).toISOString();

test("37–38. an abandoned `sending` row becomes delivery_unknown, never pending", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "stale", status: "sending", sendStartedAt: LONG_AGO }),
    makeStoredReminder({ id: "fresh", status: "sending", sendStartedAt: JUST_NOW }),
  ]);

  const summary = await reconcileReminders({
    db,
    provider: new FakeProviderLookup(),
    now: () => NOW,
  });

  assert.equal(db.rows.get("stale")!.status, "delivery_unknown");
  assert.notEqual(db.rows.get("stale")!.status, "pending");
  assert.equal(summary.movedToUnknown, 1);

  // A lease that has not expired is left strictly alone.
  assert.equal(db.rows.get("fresh")!.status, "sending");
});

test("38b. a `sending` row with no lease timestamp is treated as abandoned", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "no-lease", status: "sending", sendStartedAt: null }),
  ]);

  await reconcileReminders({ db, provider: new FakeProviderLookup(), now: () => NOW });
  assert.equal(db.rows.get("no-lease")!.status, "delivery_unknown");
});

test("39. a provider lookup resolves an accepted message to sent", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({
      id: "unknown-1",
      status: "delivery_unknown",
      providerMessageId: "pm-1",
    }),
  ]);
  const provider = new FakeProviderLookup({
    "pm-1": { ok: true, lastEvent: "delivered", createdAt: "2026-07-29T11:58:00Z" },
  });

  const summary = await reconcileReminders({ db, provider, now: () => NOW });

  const row = db.rows.get("unknown-1")!;
  assert.equal(row.status, "sent");
  assert.equal(row.sentAt, "2026-07-29T11:58:00Z");
  assert.equal(row.providerLastEvent, "delivered");
  assert.equal(summary.resolvedSent, 1);
});

test("40. a provider-recorded delivery failure is NOT ordinary retryable `failed`", async () => {
  for (const event of ["bounced", "complained", "suppressed", "failed", "canceled"]) {
    const db = new FakeReconcileDb([
      makeStoredReminder({
        id: "u",
        status: "delivery_unknown",
        providerMessageId: "pm-x",
      }),
    ]);
    const provider = new FakeProviderLookup({
      "pm-x": { ok: true, lastEvent: event, createdAt: null },
    });

    const summary = await reconcileReminders({ db, provider, now: () => NOW });
    const row = db.rows.get("u")!;

    assert.equal(row.status, "undelivered", event);
    assert.notEqual(row.status, "failed", `${event} must not become retryable failed`);
    assert.notEqual(row.status, "sent", `${event} must not be reported as delivered`);
    assert.equal(row.providerLastEvent, event);
    assert.equal(summary.resolvedUndelivered, 1);
    assert.match(String(row.lastSendError), /delivery was unsuccessful/i);
  }
});

test("40b. an accepted-but-delayed message is parked, not resolved either way", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({
      id: "delayed",
      status: "delivery_unknown",
      providerMessageId: "pm-d",
    }),
  ]);
  const provider = new FakeProviderLookup({
    "pm-d": { ok: true, lastEvent: "delivery_delayed", createdAt: null },
  });

  await reconcileReminders({ db, provider, now: () => NOW });
  const row = db.rows.get("delayed")!;
  assert.equal(row.status, "undelivered");
  assert.equal(row.providerLastEvent, "delivery_delayed");
  assert.equal(row.sentAt, null, "a delayed message has not been delivered");

  // A later run finds it again and can resolve it when the provider knows more.
  const later = new FakeProviderLookup({
    "pm-d": { ok: true, lastEvent: "delivered", createdAt: "2026-07-29T12:30:00Z" },
  });
  await reconcileReminders({ db, provider: later, now: () => NOW });
  assert.equal(db.rows.get("delayed")!.status, "sent");
});

test("41. a row with no provider id stays unknown and is never guessed at", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "orphan", status: "delivery_unknown", providerMessageId: null }),
  ]);
  const provider = new FakeProviderLookup();

  const summary = await reconcileReminders({ db, provider, now: () => NOW });

  assert.equal(db.rows.get("orphan")!.status, "delivery_unknown");
  assert.equal(provider.lookups.length, 0, "there is nothing to ask about");
  assert.equal(summary.resolvedSent, 0);
  assert.equal(summary.resolvedUndelivered, 0);
});

test("41b. a provider that cannot answer leaves the row uncertain", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "u", status: "delivery_unknown", providerMessageId: "pm-?" }),
  ]);
  const provider = new FakeProviderLookup({ "pm-?": { ok: false, reason: "not found" } });

  const summary = await reconcileReminders({ db, provider, now: () => NOW });
  assert.equal(db.rows.get("u")!.status, "delivery_unknown");
  assert.equal(summary.stillUnknown, 1);
});

test("41c. an unrecognised provider event is never mapped to a conclusion", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "u", status: "delivery_unknown", providerMessageId: "pm-n" }),
  ]);
  const provider = new FakeProviderLookup({
    "pm-n": { ok: true, lastEvent: "some_future_event", createdAt: null },
  });

  await reconcileReminders({ db, provider, now: () => NOW });
  assert.equal(db.rows.get("u")!.status, "delivery_unknown");
});

test("42. repeated reconciliation runs are idempotent", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "a", status: "sending", sendStartedAt: LONG_AGO, providerMessageId: "pm-a" }),
    makeStoredReminder({ id: "b", status: "delivery_unknown", providerMessageId: "pm-b" }),
  ]);
  const provider = new FakeProviderLookup({
    "pm-a": { ok: true, lastEvent: "delivered", createdAt: "2026-07-29T11:00:00Z" },
    "pm-b": { ok: true, lastEvent: "bounced", createdAt: null },
  });

  await reconcileReminders({ db, provider, now: () => NOW });
  const afterFirst = JSON.stringify(Array.from(db.rows.values()).map((r) => [r.id, r.status, r.sentAt]));

  await reconcileReminders({ db, provider, now: () => NOW });
  await reconcileReminders({ db, provider, now: () => NOW });
  const afterThird = JSON.stringify(Array.from(db.rows.values()).map((r) => [r.id, r.status, r.sentAt]));

  assert.equal(afterFirst, afterThird, "further runs must change nothing");
});

test("45. overlapping reconciliation runs neither duplicate work nor submit anything", async () => {
  const db = new FakeReconcileDb([
    makeStoredReminder({ id: "a", status: "sending", sendStartedAt: LONG_AGO, providerMessageId: "pm-a" }),
    makeStoredReminder({ id: "b", status: "delivery_unknown", providerMessageId: "pm-b" }),
  ]);
  const provider = new FakeProviderLookup({
    "pm-a": { ok: true, lastEvent: "delivered", createdAt: "2026-07-29T11:00:00Z" },
    "pm-b": { ok: true, lastEvent: "bounced", createdAt: null },
  });

  const [one, two] = await Promise.all([
    reconcileReminders({ db, provider, now: () => NOW }),
    reconcileReminders({ db, provider, now: () => NOW }),
  ]);

  // Each state change happens exactly once across BOTH runs, because every
  // write is conditional on the status the row was read at.
  assert.equal(one.movedToUnknown + two.movedToUnknown, 1);
  assert.equal(one.resolvedUndelivered + two.resolvedUndelivered, 1);
  assert.equal(db.rows.get("b")!.status, "undelivered");
  assert.equal(
    db.writes.filter((w) => w === "apply:b:undelivered").length,
    1,
    "a state change must not be applied twice"
  );
});

test("43–44. cron authorisation fails closed and accepts only the exact bearer token", () => {
  // 43: unauthorised in every shape.
  assert.equal(isAuthorisedCronRequest("Bearer secret", undefined), false, "no secret configured");
  assert.equal(isAuthorisedCronRequest("Bearer secret", ""), false, "blank secret");
  assert.equal(isAuthorisedCronRequest("Bearer secret", "   "), false, "whitespace secret");
  assert.equal(isAuthorisedCronRequest(null, "secret"), false, "no header");
  assert.equal(isAuthorisedCronRequest("", "secret"), false, "empty header");
  assert.equal(isAuthorisedCronRequest("secret", "secret"), false, "missing Bearer prefix");
  assert.equal(isAuthorisedCronRequest("Bearer wrong", "secret"), false);
  assert.equal(isAuthorisedCronRequest("bearer secret", "secret"), false, "case matters");
  assert.equal(isAuthorisedCronRequest("Bearer secretX", "secret"), false, "prefix is not enough");

  // 44: the exact header Vercel sends when CRON_SECRET is configured.
  assert.equal(isAuthorisedCronRequest("Bearer secret", "secret"), true);
  assert.equal(isAuthorisedCronRequest("Bearer secret", " secret "), true, "secret is trimmed");
});
