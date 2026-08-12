process.env.REVIEW_TOKEN_SECRET ??= "test-review-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  editInvoice, deleteInvoiceLifecycle, archiveInvoiceLifecycle,
  type LifecycleDb, type LifecycleInvoice, type ReminderFact,
} from "@/lib/invoice-lifecycle-service";
import { approveAndSendReminder } from "@/lib/reminder-approval";
import {
  FakeApprovalDb, FakeMailer, FakeAllowanceStore, REMINDER_ID, freshToken, makeDeps, makeStoredReminder,
} from "./support/fakes";
import {
  UNDELETABLE_REMINDER_STATUSES,
  blocksDeletion,
  isDispatched,
  isInFlight,
  removalFor,
  canHardDelete,
  REMINDER_CONTENT_FIELDS,
  changedContentFields,
  editConsequence,
  editWarning,
  type EditableInvoiceSnapshot,
} from "@/lib/invoice-lifecycle";

/**
 * Invoice lifecycle — edit, delete, archive.
 *
 * The claims worth proving here are all negative: allowance is never refunded,
 * sent history is never erased, and a stale draft can never survive an edit.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Recursive source listing, so privilege audits scan the tree, not a list. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name.startsWith(".")
      ? []
      : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}
const MIGRATION = readFileSync(join(ROOT, "supabase/sql/012_invoice_lifecycle.sql"), "utf8");
const DDL = MIGRATION.replace(/^\s*--.*$/gm, "");

/**
 * Migration 013 is a SEPARATE file on purpose — see the deployment-order tests
 * below. PERMS is the raw text (comments included, so the deployment plan and
 * rollback can be asserted); PERMS_DDL is the executable statements only.
 *
 * Comments are stripped before asserting on executable content because this
 * file's own prose quotes the statements it is checking for — a hazard that has
 * caught us before.
 */
const PERMS = readFileSync(join(ROOT, "supabase/sql/013_invoice_permissions.sql"), "utf8");
const PERMS_DDL = PERMS.replace(/^\s*--.*$/gm, "");

const ALL: string[] = [
  "pending", "sending", "sent", "dismissed", "failed", "delivery_unknown", "undelivered",
];

function snap(over: Partial<EditableInvoiceSnapshot> = {}): EditableInvoiceSnapshot {
  return {
    customer_name: "Dave Morrison",
    customer_email: "dave@example.co.uk",
    customer_phone: "07700 900000",
    invoice_reference: "INV-1042",
    job_description: "Boiler repair",
    amount: 1500,
    due_date: "2026-08-01",
    payment_link: "",
    ...over,
  };
}

// ── Delete eligibility ─────────────────────────────────────────────────────

test("only dispatched or in-flight reminders block deletion", () => {
  for (const s of ["sent", "delivery_unknown", "undelivered", "sending"]) {
    assert.equal(blocksDeletion(s), true, s);
  }
  for (const s of ["pending", "dismissed", "failed"]) {
    assert.equal(blocksDeletion(s), false, s);
  }
  assert.equal(UNDELETABLE_REMINDER_STATUSES.length, 4);
});

test("a dispatched reminder makes an invoice permanently un-deletable", () => {
  for (const s of ["sent", "delivery_unknown", "undelivered"]) {
    assert.equal(isDispatched(s), true, s);
    assert.equal(canHardDelete({ reminderStatuses: [s], archivedAt: null }), false, s);
    assert.deepEqual(
      removalFor({ reminderStatuses: [s], archivedAt: null }),
      { allowed: true, action: "archive" },
      `${s} must offer archive, never delete`
    );
  }
});

test("an invoice that never dispatched anything is deletable", () => {
  for (const statuses of [[], ["pending"], ["dismissed"], ["failed"], ["pending", "failed"]]) {
    assert.equal(canHardDelete({ reminderStatuses: statuses, archivedAt: null }), true, String(statuses));
    assert.deepEqual(
      removalFor({ reminderStatuses: statuses, archivedAt: null }),
      { allowed: true, action: "delete" },
      String(statuses)
    );
  }
});

test("one dispatched reminder among many unsent ones still forces archive", () => {
  const facts = { reminderStatuses: ["pending", "dismissed", "failed", "sent"], archivedAt: null };
  assert.equal(canHardDelete(facts), false);
  assert.deepEqual(removalFor(facts), { allowed: true, action: "archive" });
});

test("delete and archive are never offered at the same time", () => {
  // The menu shows one word. Offering both asks the customer a question the
  // system already knows the answer to, and the wrong answer is unrecoverable.
  for (const s of ALL) {
    const d = removalFor({ reminderStatuses: [s], archivedAt: null });
    if (d.allowed) assert.ok(d.action === "delete" || d.action === "archive");
  }
});

// ── In flight ──────────────────────────────────────────────────────────────

test("an in-flight send refuses every removal action", () => {
  assert.equal(isInFlight(["sending"]), true);
  assert.deepEqual(
    removalFor({ reminderStatuses: ["sending"], archivedAt: null }),
    { allowed: false, reason: "in_flight" }
  );
  // Even alongside deletable states.
  assert.deepEqual(
    removalFor({ reminderStatuses: ["pending", "sending"], archivedAt: null }),
    { allowed: false, reason: "in_flight" }
  );
  assert.equal(canHardDelete({ reminderStatuses: ["sending"], archivedAt: null }), false);
});

test("an in-flight send refuses edits too", () => {
  assert.deepEqual(
    editConsequence(["amount"], null, ["sending"]),
    { kind: "in_flight" }
  );
});

test("an already-archived invoice offers nothing further", () => {
  assert.deepEqual(
    removalFor({ reminderStatuses: ["sent"], archivedAt: "2026-08-01T00:00:00Z" }),
    { allowed: false, reason: "already_archived" }
  );
});

// ── Which edits matter ─────────────────────────────────────────────────────

test("every field that appears in a message is tracked", () => {
  assert.deepEqual([...REMINDER_CONTENT_FIELDS], [
    "customer_name", "customer_email", "customer_phone",
    "invoice_reference", "job_description", "amount", "due_date", "payment_link",
  ]);

  // Each one, changed individually, is detected.
  const before = snap();
  const changes: Array<[string, Partial<EditableInvoiceSnapshot>]> = [
    ["customer_name", { customer_name: "Dave M" }],
    ["customer_email", { customer_email: "new@example.co.uk" }],
    ["customer_phone", { customer_phone: "07700 900999" }],
    ["invoice_reference", { invoice_reference: "INV-2000" }],
    ["job_description", { job_description: "Boiler service" }],
    ["amount", { amount: 1200 }],
    ["due_date", { due_date: "2026-09-01" }],
    ["payment_link", { payment_link: "https://pay.example/x" }],
  ];
  for (const [field, over] of changes) {
    assert.deepEqual(changedContentFields(before, snap(over)), [field], field);
  }
});

test("an edit that changes nothing in the message has no consequence", () => {
  assert.deepEqual(changedContentFields(snap(), snap()), []);
  assert.deepEqual(
    editConsequence([], { id: "rem-1", status: "pending", ownerEdited: false }, ["pending"]),
    { kind: "none" }
  );
});

test("null and empty string are the same absence", () => {
  // "no reference recorded" must not read as a change when the form round-trips
  // it as "" — that would refresh a perfectly correct draft for nothing.
  assert.deepEqual(
    changedContentFields(
      snap({ invoice_reference: null, job_description: null }),
      snap({ invoice_reference: "", job_description: "" } as Partial<EditableInvoiceSnapshot>)
    ),
    []
  );
});

// ── The stale-draft invariant ──────────────────────────────────────────────

test("THE INVARIANT: a content change with a pending reminder always refreshes it", () => {
  // £1,500 → £1,200 with an unsent reminder still quoting £1,500 is the exact
  // failure this feature exists to prevent. The reviewed-token model does NOT
  // catch it on its own: the token is invalidated, but the reminder would then
  // be re-reviewed and sent still quoting the old figure, because the stored
  // channel content is what the send path uses and nothing touched it.
  const changed = changedContentFields(snap(), snap({ amount: 1200 }));
  assert.deepEqual(changed, ["amount"]);

  assert.deepEqual(
    editConsequence(changed, { id: "rem-1", status: "pending", ownerEdited: false }, ["pending"]),
    { kind: "refresh_pending", reminderId: "rem-1", ownerEdited: false }
  );
});

test("a dispatched reminder is never refreshed by an invoice edit", () => {
  // If it said £1,500 when it went out, it says £1,500 for ever.
  for (const s of ["sent", "delivery_unknown", "undelivered", "dismissed", "failed"]) {
    assert.deepEqual(
      editConsequence(["amount"], { id: "rem-1", status: s, ownerEdited: false }, [s]),
      { kind: "none" },
      `${s} history must not be rewritten`
    );
  }
});

test("owner-edited drafts are refreshed too, and flagged so the owner is told", () => {
  const c = editConsequence(["amount"], { id: "rem-1", status: "pending", ownerEdited: true }, ["pending"]);
  assert.deepEqual(c, { kind: "refresh_pending", reminderId: "rem-1", ownerEdited: true });

  // Silently discarding someone's typing is worse than the stale figure it
  // prevents, so the warning says so explicitly.
  const warning = editWarning(c)!;
  assert.match(warning, /you have edited its wording/);
  assert.match(warning, /your edits to it will be lost/);
});

test("no warning is shown when saving costs nothing", () => {
  assert.equal(editWarning({ kind: "none" }), null);
  assert.equal(editWarning({ kind: "in_flight" }), null);

  const plain = editWarning({ kind: "refresh_pending", reminderId: "r", ownerEdited: false })!;
  assert.match(plain, /reminder ready for review/);
  assert.match(plain, /refresh the unsent reminder so it matches the invoice/);
  assert.equal(/edits to it will be lost/.test(plain), false);
});

// ── The database guard ─────────────────────────────────────────────────────

test("[static] migration 012 refuses an ineligible delete at the database", () => {
  assert.match(DDL, /create trigger invoices_deletable_guard/);
  assert.match(DDL, /before delete on public\.invoices/);
  assert.match(DDL, /for each row/);
  assert.match(DDL, /execute function public\.enforce_invoice_deletable\(\)/);

  const fn = DDL.slice(DDL.indexOf("function public.enforce_invoice_deletable"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // The same four statuses the application refuses — asserted as a set so the
  // two cannot drift.
  const listed = (body.match(/r\.status in \(([^)]*)\)/) ?? [])[1] ?? "";
  const sqlSet = listed.split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(sqlSet, [...UNDELETABLE_REMINDER_STATUSES].sort());

  assert.match(body, /raise exception/, "the delete must be refused, not logged");
  // SECURITY DEFINER: a guard evadable by rows being invisible under RLS is
  // not a guard.
  assert.match(fn.slice(0, 300), /security definer/);
  assert.match(fn.slice(0, 300), /set search_path = pg_catalog, pg_temp/);
});

test("[static] archive is its own column, not a status value", () => {
  assert.match(DDL, /add column if not exists archived_at timestamptz/);
  // invoices.status is 'unpaid' | 'paid' and carries the paid kill switch.
  // Adding 'archived' to it would make archived-and-paid unrepresentable and
  // silently reclassify every query testing status <> 'paid'.
  // The RPCs legitimately RETURN the text 'archived' as an outcome, so a bare
  // string search is meaningless. What must not exist is 'archived' as an
  // invoices.status value or a status assignment.
  assert.equal(
    /status\s*=\s*'archived'/.test(DDL), false,
    "archive must never be written into invoices.status"
  );
  assert.equal(
    /status in \([^)]*'archived'/.test(DDL), false,
    "archive must never join the status vocabulary"
  );
  assert.match(DDL, /where archived_at is null/, "the active-workflow predicate is indexed");
});

test("[static] the migration is not self-applying and names its blast radius", () => {
  assert.match(MIGRATION, /NOT RUN AUTOMATICALLY/);
  assert.match(MIGRATION, /NOT YET APPLIED TO ANY REMOTE PROJECT/);
  assert.match(MIGRATION, /PRODUCTION/);
  // Rollback drops the trigger before its function, as in 011.
  const rb = MIGRATION.slice(MIGRATION.indexOf("── Rollback"));
  assert.ok(
    rb.indexOf("drop trigger if exists invoices_deletable_guard") <
      rb.indexOf("drop function if exists public.enforce_invoice_deletable")
  );
});

test("[static] the live unguarded delete is documented as the reason for the guard", () => {
  // lib/invoices.ts still contains a bare client-side delete wired to the Paid
  // page. The guard covers it without editing that page — but the finding must
  // not be silent.
  const invoices = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");
  assert.match(invoices, /\.from\("invoices"\)\.delete\(\)/, "the raw delete still exists");
  assert.match(MIGRATION, /deleteInvoice\(\)/, "and the migration explains why it is now guarded");
});

// ── The service ────────────────────────────────────────────────────────────


const OWNER = "user-1";

class FakeDb implements LifecycleDb {
  invoices = new Map<string, LifecycleInvoice>();
  reminders = new Map<string, ReminderFact[]>();
  regenerated: string[] = [];
  composed: string[] = [];
  /** Awaited inside commitEdit, so a test can open the race window. */
  settle: () => Promise<void> = async () => {};
  deleted: string[] = [];
  archived: string[] = [];
  updated: string[] = [];
  /** Simulates the migration-012 BEFORE DELETE guard refusing. */
  databaseRefusesDelete = false;
  /** Models the SQL's `and invoice_id = p_invoice_id` binding. */
  bindReminderToInvoice = false;
  /** Models the RPC's archived_at check, read under the invoice lock. */
  refuseArchivedEdit = false;
  regenerationFails = false;

  constructor(inv: Partial<LifecycleInvoice> = {}, reminders: ReminderFact[] = []) {
    // Seeded from snap() so "an edit that changes nothing" genuinely changes
    // nothing — a mismatched fixture would make that test assert the opposite
    // of its name.
    const invoice: LifecycleInvoice = {
      id: "inv-1", userId: OWNER, ...snap(), archivedAt: null, ...inv,
    } as LifecycleInvoice;
    this.invoices.set(invoice.id, invoice);
    this.reminders.set(invoice.id, reminders);
  }

  async loadInvoice(id: string, userId: string) {
    const i = this.invoices.get(id);
    // Scoped to the caller: another user's invoice does not exist.
    return i && i.userId === userId ? i : null;
  }
  async loadReminders(invoiceId: string) { return this.reminders.get(invoiceId) ?? []; }
  /** Composes without writing. Failure here must leave everything untouched. */
  async composeRefresh(_i: string, _u: string, reminderId: string) {
    if (this.regenerationFails) return null;
    this.composed.push(reminderId);
    return [
      { channel: "email" as const, subject: "New subject", body: "New email body" },
      { channel: "sms" as const, subject: null, body: "New sms body" },
    ];
  }

  /**
   * Models the ONE TRANSACTION of update_invoice_with_refresh: it re-reads the
   * reminder state at commit time, exactly as the locked SQL does, and writes
   * nothing at all unless every check passes.
   */
  async commitEdit(input: {
    invoiceId: string; userId: string; patch: EditableInvoiceSnapshot;
    reminderId: string | null; channels: unknown[] | null;
  }) {
    // The interleaving hook: a send can be let in exactly here, which is the
    // window between the service's read and the commit.
    await this.settle();

    const statuses = (this.reminders.get(input.invoiceId) ?? []).map((r) => r.status);
    if (statuses.includes("sending")) return "in_flight" as const;

    if (input.reminderId) {
      // Bound to THIS invoice, exactly as the SQL is. A reminder belonging to
      // another invoice of the same owner is not found here, so the whole edit
      // returns before any write.
      const r = (this.reminders.get(input.invoiceId) ?? []).find((x) => x.id === input.reminderId);
      if (!r || r.status !== "pending") return "reminder_changed" as const;
    }

    const inv = this.invoices.get(input.invoiceId);
    if (!inv) return "not_found" as const;
    if (this.refuseArchivedEdit && inv.archivedAt) return "invoice_archived" as const;

    Object.assign(inv, input.patch);
    this.updated.push(input.invoiceId);
    if (input.reminderId) this.regenerated.push(input.reminderId);
    return "updated" as const;
  }
  async deleteInvoice(id: string) {
    if (this.databaseRefusesDelete) return { ok: false, refusedByDatabase: true };
    this.deleted.push(id); this.invoices.delete(id); return { ok: true };
  }
  /**
   * Models archive_invoice_safely: one transaction that locks, re-reads under
   * the locks, refuses before any mutation, and otherwise commits everything.
   * `settle` is the interleaving hook — anything a test does inside it happens
   * BEFORE the locks are taken, i.e. the racer got there first.
   */
  async archiveInvoice(
    id: string, userId: string
  ): Promise<"archived" | "in_flight" | "not_found" | "error"> {
    await this.settle();

    const inv = this.invoices.get(id);
    // Scoped by owner, exactly as `where id = ? and user_id = ?` in the RPC.
    // The fake previously looked up by id alone, which would have hidden a
    // cross-user hole rather than caught one.
    if (!inv || inv.userId !== userId) return "not_found" as const;
    if (inv.archivedAt) return "archived" as const;

    const rows = this.reminders.get(id) ?? [];
    // Re-read under the locks. Refuse BEFORE writing anything.
    if (rows.some((r) => r.status === "sending")) return "in_flight" as const;

    inv.archivedAt = "2026-08-10T00:00:00Z";  // db-generated in production
    this.reminders.set(id, rows.map((r) =>
      r.status === "pending" ? { ...r, status: "dismissed" } : r));
    this.archived.push(id);
    return "archived" as const;
  }

}

const deps = (db: FakeDb, userId = OWNER) => ({ db, userId });
const patch = (over: Partial<EditableInvoiceSnapshot> = {}) => ({ ...snap(), ...over });

// ── Edit ───────────────────────────────────────────────────────────────────

test("editing another user's invoice is not found, not forbidden", async () => {
  const db = new FakeDb();
  const r = await editInvoice(deps(db, "attacker"), { invoiceId: "inv-1", patch: patch() });
  assert.equal(r.outcome, "not_found");
  assert.equal(db.updated.length, 0, "nothing was written");
  // 404, not 403: the response must not confirm that someone else's invoice exists.
  assert.equal(r.status, 404);
});

test("a harmless edit saves without touching any reminder", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  const r = await editInvoice(deps(db), { invoiceId: "inv-1", patch: patch() });
  assert.equal(r.outcome, "updated");
  assert.deepEqual(db.regenerated, [], "no content changed, so no refresh");
});

test("THE INVARIANT: a content edit refuses until the consequence is acknowledged", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  const first = await editInvoice(deps(db), { invoiceId: "inv-1", patch: patch({ amount: 1200 }) });

  assert.equal(first.status, 409);
  assert.equal(first.body.requiresRefreshConfirmation, true);
  assert.equal(db.updated.length, 0, "the invoice must NOT change before confirmation");
  assert.deepEqual(db.regenerated, []);
});

test("THE INVARIANT: once acknowledged, the stale draft is regenerated", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });
  assert.equal(r.outcome, "updated");
  assert.equal(r.body.refreshedReminder, true);
  assert.deepEqual(db.regenerated, ["rem-1"], "£1,500 draft cannot survive a £1,200 invoice");
});

test("composition failure leaves the invoice COMPLETELY unchanged", async () => {
  // The old sequence UPDATEd the invoice and then tried to regenerate, so a
  // regeneration failure left £1,200 on the invoice beside a £1,500 draft.
  // Content is now composed BEFORE anything is written, so a failure has
  // nothing to roll back.
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  db.regenerationFails = true;

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });

  assert.equal(r.body.success, false);
  assert.deepEqual(db.updated, [], "THE POINT: the invoice was never written");
  assert.equal(db.invoices.get("inv-1")!.amount, 1500, "still the original figure");
  assert.match(String(r.body.message), /Nothing has been changed/);
});

// ── The edit ↔ send race ───────────────────────────────────────────────────

test("RACE: send wins — the invoice is not mutated at all", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);

  // The send claims the reminder in the window between the edit's read and
  // its commit — precisely where the old three-statement sequence broke.
  db.settle = async () => {
    db.reminders.set("inv-1", [{ id: "rem-1", status: "sending", ownerEdited: false }]);
  };

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });

  assert.equal(r.outcome, "in_flight");
  assert.deepEqual(db.updated, [], "no invoice write");
  assert.deepEqual(db.regenerated, [], "no content write");
  assert.equal(db.invoices.get("inv-1")!.amount, 1500);
  // The send proceeds against the content it already reviewed.
  assert.equal(db.reminders.get("inv-1")![0].status, "sending");
});

test("RACE: edit wins — invoice and both channels move together", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });

  assert.equal(r.outcome, "updated");
  assert.deepEqual(db.updated, ["inv-1"]);
  assert.deepEqual(db.regenerated, ["rem-1"]);
  assert.equal(db.invoices.get("inv-1")!.amount, 1200, "invoice moved");
  // Composed before the commit, so the pair was ready before anything landed.
  assert.deepEqual(db.composed, ["rem-1"]);
});

test("RACE: the draft changes underneath — nothing is written", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  // Dismissed between the read and the commit.
  db.settle = async () => {
    db.reminders.set("inv-1", [{ id: "rem-1", status: "dismissed", ownerEdited: false }]);
  };

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });

  assert.equal(r.body.requiresReload, true);
  assert.deepEqual(db.updated, [], "no partial mutation");
  assert.equal(db.invoices.get("inv-1")!.amount, 1500);
});

test("both channels are composed as a pair, never one without the other", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  const channels = await db.composeRefresh("inv-1", OWNER, "rem-1");
  assert.equal(channels!.length, 2);
  assert.deepEqual(channels!.map((c) => c.channel).sort(), ["email", "sms"]);
});

test("[static] the commit is one transaction that locks the reminders", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // The lock is what makes it atomic: an approve claim on any of these rows
  // waits for this transaction to commit.
  assert.match(body, /from public\.reminder_logs[\s\S]*?for update/);
  assert.match(body, /select archived_at into v_archived[\s\S]*?for update;/, "the invoice is locked too");

  // In-flight is re-checked INSIDE the transaction, and returns before any
  // write — so "send wins" cannot leave a partial mutation.
  const sendingCheck = body.indexOf("if v_sending then");
  const firstWrite = body.indexOf("update public.invoices");
  assert.ok(sendingCheck > -1 && firstWrite > sendingCheck, "the check precedes every write");

  // The version bump is what makes an in-flight claim fail its CAS.
  assert.match(body, /send_attempt_count    = send_attempt_count \+ 1/);
  assert.match(body, /reviewed_content_hash = null/, "the old approval is invalidated");

  // Both channels, and the owner edit replaced rather than merged.
  assert.match(body, /jsonb_array_elements\(p_channels\)/);
  assert.match(body, /edited_body       = null/);

  // ── OWNERSHIP, honestly ─────────────────────────────────────────────
  //
  // There must be NO auth.uid() check. These RPCs are granted to service_role
  // only and the app calls them through the service-role client, where
  // auth.uid() is always NULL — so such a guard could never fire. Security
  // code whose semantics do not match the runtime invites the next reader to
  // believe a protection exists.
  assert.equal(
    /auth\.uid\(\)/.test(body), false,
    "auth.uid() is meaningless under service_role and must not pretend otherwise"
  );
  // The real protection: every statement scoped to the trusted user id.
  assert.match(body, /and user_id = p_user_id/);
  assert.match(DDL, /revoke all on function public\.update_invoice_with_refresh\(uuid, uuid, jsonb, uuid, jsonb\) from anon, authenticated;/);
  assert.match(DDL, /grant execute on function public\.update_invoice_with_refresh\(uuid, uuid, jsonb, uuid, jsonb\) to service_role;/);
  assert.equal(
    /grant execute on function public\.update_invoice_with_refresh[^;]*\b(anon|authenticated)\b/.test(DDL),
    false
  );
  assert.match(fn.slice(0, 400), /security definer/);
  assert.match(fn.slice(0, 400), /set search_path = pg_catalog, pg_temp/);
});

test("an owner-edited draft is flagged so the warning can say so", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: true }]);
  const r = await editInvoice(deps(db), { invoiceId: "inv-1", patch: patch({ amount: 1200 }) });
  assert.equal(r.body.ownerEdited, true);
});

test("dispatched reminders are never regenerated by an edit", async () => {
  for (const status of ["sent", "delivery_unknown", "undelivered"]) {
    const db = new FakeDb({}, [{ id: "rem-1", status, ownerEdited: false }]);
    const r = await editInvoice(deps(db), {
      invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
    });
    assert.equal(r.outcome, "updated", status);
    assert.deepEqual(db.regenerated, [], `${status} content is history and must not be rewritten`);
  }
});

test("an in-flight send blocks the edit before anything is written", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "sending", ownerEdited: false }]);
  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });
  assert.equal(r.outcome, "in_flight");
  assert.equal(db.updated.length, 0, "recipient details must not change under a live send");
});

// ── Delete ─────────────────────────────────────────────────────────────────

test("an invoice with no dispatched reminder deletes", async () => {
  for (const reminders of [[], [{ id: "r", status: "pending", ownerEdited: false }],
                           [{ id: "r", status: "failed", ownerEdited: false }],
                           [{ id: "r", status: "dismissed", ownerEdited: false }]]) {
    const db = new FakeDb({}, reminders as ReminderFact[]);
    const r = await deleteInvoiceLifecycle(deps(db), "inv-1");
    assert.equal(r.outcome, "deleted", JSON.stringify(reminders));
  }
});

test("a dispatched reminder makes delete impossible and points at archive", async () => {
  for (const status of ["sent", "delivery_unknown", "undelivered"]) {
    const db = new FakeDb({}, [{ id: "r", status, ownerEdited: false }]);
    const r = await deleteInvoiceLifecycle(deps(db), "inv-1");
    assert.equal(r.outcome, "delete_not_allowed", status);
    assert.equal(r.body.useArchive, true);
    assert.deepEqual(db.deleted, [], "no DELETE was even attempted");
  }
});

test("one dispatched reminder among many unsent ones still blocks delete", async () => {
  const db = new FakeDb({}, [
    { id: "a", status: "pending", ownerEdited: false },
    { id: "b", status: "dismissed", ownerEdited: false },
    { id: "c", status: "sent", ownerEdited: false },
  ]);
  const r = await deleteInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "delete_not_allowed");
});

test("an in-flight send blocks delete", async () => {
  const db = new FakeDb({}, [{ id: "r", status: "sending", ownerEdited: false }]);
  assert.equal((await deleteInvoiceLifecycle(deps(db), "inv-1")).outcome, "in_flight");
  assert.deepEqual(db.deleted, []);
});

test("the database guard refusing is reported as a lifecycle refusal, not a 500", async () => {
  // The race migration 012 exists for: a reminder became dispatched between
  // the service check and the DELETE.
  const db = new FakeDb({}, [{ id: "r", status: "pending", ownerEdited: false }]);
  db.databaseRefusesDelete = true;
  const r = await deleteInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "delete_not_allowed");
  assert.equal(r.status, 409);
  assert.equal(r.body.useArchive, true);
});

test("a duplicate delete is a clean 404, not corruption", async () => {
  const db = new FakeDb();
  assert.equal((await deleteInvoiceLifecycle(deps(db), "inv-1")).outcome, "deleted");
  const second = await deleteInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(second.outcome, "not_found");
  assert.deepEqual(db.deleted, ["inv-1"], "deleted exactly once");
});

test("deleting another user's invoice is not found", async () => {
  const db = new FakeDb();
  assert.equal((await deleteInvoiceLifecycle(deps(db, "attacker"), "inv-1")).outcome, "not_found");
  assert.deepEqual(db.deleted, []);
});

// ── Archive ────────────────────────────────────────────────────────────────

test("a dispatched invoice archives, preserving everything", async () => {
  const db = new FakeDb({}, [{ id: "r", status: "sent", ownerEdited: false }]);
  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "archived");
  assert.deepEqual(db.archived, ["inv-1"]);
  assert.deepEqual(db.deleted, [], "nothing was destroyed");
  assert.equal(db.invoices.has("inv-1"), true, "the row survives");
  assert.equal((db.reminders.get("inv-1") ?? []).length, 1, "reminder history survives");
});

test("archiving is idempotent", async () => {
  const db = new FakeDb({ archivedAt: "2026-08-01T00:00:00Z" }, []);
  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "archived");
  assert.deepEqual(db.archived, [], "no second write");
});

test("an in-flight send blocks archive", async () => {
  const db = new FakeDb({}, [{ id: "r", status: "sending", ownerEdited: false }]);
  assert.equal((await archiveInvoiceLifecycle(deps(db), "inv-1")).outcome, "in_flight");
  assert.deepEqual(db.archived, []);
});

test("archiving another user's invoice is not found", async () => {
  const db = new FakeDb();
  assert.equal((await archiveInvoiceLifecycle(deps(db, "attacker"), "inv-1")).outcome, "not_found");
});

// ── No lifecycle bypass remains ────────────────────────────────────────────

test("[static] no bare client-side invoice delete survives anywhere", () => {
  const files = [
    "lib/invoices.ts", "components/dashboard/DashboardProvider.tsx",
    "app/dashboard/paid/page.tsx", "app/dashboard/chasing/page.tsx",
  ];
  for (const f of files) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(
      /\.from\("invoices"\)[\s\S]{0,80}\.delete\(\)/.test(code), false,
      `${f} still deletes invoices directly, bypassing the lifecycle`
    );
  }
  // Deletion goes through the guarded API instead.
  const invoices = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");
  assert.match(invoices, /fetch\(`\/api\/invoices\/\$\{id\}`, \{ method: "DELETE" \}\)/);
});

test("[static] archived invoices never reach the browser, and never get reminders", () => {
  // One boundary rather than nine filters — see lib/invoice-live.ts.
  const invoices = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");
  assert.match(invoices, /fetchInvoices[\s\S]{0,400}\.is\("archived_at", null\)/);

  // The two server paths that do not go through fetchInvoices.
  for (const f of ["app/api/cron/send-reminders/route.ts", "app/api/reminders/prepare/route.ts"]) {
    const code = readFileSync(join(ROOT, f), "utf8");
    assert.match(code, /\.is\("archived_at", null\)/, `${f} must exclude archived invoices`);
  }

  // And the database closes the read-then-write race the filters cannot.
  assert.match(DDL, /create trigger reminder_logs_archived_guard/);
  assert.match(DDL, /before insert on public\.reminder_logs/);
});

test("[static] the menu offers one removal action, from the same rule the server uses", () => {
  const raw = readFileSync(join(ROOT, "components/dashboard/InvoiceRowMenu.tsx"), "utf8");
  // Comments describe the control and necessarily name it; only executable
  // code can render a glyph.
  const menu = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(menu, /removalActionFor\(reminderStatuses, invoice\.archived_at \?\? null\)/);
  assert.match(menu, /removal === "delete"/);
  assert.match(menu, /removal === "archive"/);
  // Never both: they are separate branches on one value, not two conditions.
  assert.equal(/removal === "delete" \|\| removal === "archive"/.test(menu), false);

  // Accessibility.
  assert.match(menu, /aria-label=\{`More actions for \$\{label\}`\}/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /e\.key !== "Escape"/);
  assert.match(menu, /mousedown/, "outside click closes");
  // Drawn dots, not an emoji.
  assert.equal(/⋯|…/.test(menu), false);
  assert.match(menu, /<circle cx="5"/);
});


// ── Archive stands down unsent drafts ──────────────────────────────────────

test("archiving dismisses any unsent draft — no sendable reminder is left behind", async () => {
  // Setting archived_at alone left a `pending` reminder claimable: the approve
  // route does not read archived_at, so a bookmarked review URL would still
  // have sent it. Archive must mean no future customer contact.
  const db = new FakeDb({}, [
    { id: "rem-pending", status: "pending", ownerEdited: false },
    { id: "rem-sent", status: "sent", ownerEdited: false },
  ]);

  assert.equal((await archiveInvoiceLifecycle(deps(db), "inv-1")).outcome, "archived");

  const after = db.reminders.get("inv-1")!;
  assert.equal(after.find((r) => r.id === "rem-pending")!.status, "dismissed");
  // Dispatched history is untouched — and its allowance unit stays consumed.
  assert.equal(after.find((r) => r.id === "rem-sent")!.status, "sent");
});

test("[static] no multi-statement archive path survives anywhere", () => {
  const files = [
    "lib/invoice-lifecycle-db.ts", "lib/invoice-lifecycle-service.ts",
    "lib/invoices.ts", "components/dashboard/DashboardProvider.tsx",
    "app/api/invoices/[id]/archive/route.ts",
  ];
  for (const f of files) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Setting archived_at from application code is the half of the old
    // sequence that must not survive anywhere.
    assert.equal(
      /\.update\(\{ archived_at/.test(code), false,
      `${f} still sets archived_at directly instead of via the atomic RPC`
    );
  }

  // markInvoicePaid also dismisses pending drafts by invoice_id — that is the
  // PAID kill switch, a different and legitimate operation, so a blanket
  // search for bulk dismissal would flag it wrongly. What matters is that no
  // dismissal sits next to an archive.
  const dbSource = readFileSync(join(ROOT, "lib/invoice-lifecycle-db.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const archiveFn = dbSource.slice(dbSource.indexOf("async archiveInvoice("));
  assert.equal(
    /\.update\(\{ status: "dismissed" \}\)/.test(archiveFn.slice(0, 900)), false,
    "archive must not dismiss drafts in its own statement"
  );
  assert.match(dbSource, /rpc\("archive_invoice_safely"/, "one lifecycle-safe path");
});

// ── Archived view ──────────────────────────────────────────────────────────

test("[static] archived rows have exactly one read path, and it is not the live one", () => {
  const invoices = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");

  // The live boundary still excludes them.
  assert.match(invoices, /fetchInvoices[\s\S]{0,400}\.is\("archived_at", null\)/);
  // And the one deliberate exception is a separate function, so an archived
  // row cannot arrive somewhere operational via a flag someone forgot.
  assert.match(invoices, /export async function fetchArchivedInvoices/);
  assert.match(invoices, /\.not\("archived_at", "is", null\)/);

  const page = readFileSync(join(ROOT, "app/dashboard/archived/page.tsx"), "utf8");
  assert.match(page, /fetchArchivedInvoices/);
  // Read only: no lifecycle actions on this page.
  assert.equal(/InvoiceRowMenu|handleDeleteInvoice|handleArchiveInvoice|updateInvoice/.test(page), false);
});

test("[static] the archived view shows identity without inventing history", () => {
  const raw = readFileSync(join(ROOT, "app/dashboard/archived/page.tsx"), "utf8");
  const page = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(page, /inv\.customer_name/);
  assert.match(page, /inv\.invoice_reference/);
  assert.match(page, /formatCurrency\(inv\.amount\)/);
  assert.match(page, /inv\.due_date/);
  assert.match(page, /inv\.archived_at/);

  // Paid and archived are different facts, and archiving never touched status.
  assert.match(page, /inv\.status === "paid" \? "Paid" : "Unpaid"/);

  // No fabricated delivery or open claims.
  for (const banned of [/delivered/i, /opened/i, /read receipt/i, /clicked/i]) {
    assert.equal(banned.test(page), false, `${banned}`);
  }
  // Restrained empty state, nothing more.
  assert.match(page, /No archived invoices/);
  assert.match(page, /Invoices you archive will appear here\./);
});

test("[static] the archive confirmation promises only what the page can show", () => {
  const lifecycle = readFileSync(join(ROOT, "lib/invoice-lifecycle.ts"), "utf8");
  const code = lifecycle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.match(code, /Its existing records will be kept, and you can find it under Archived\./);
  // The page lists invoices; it does not browse per-reminder delivery history.
  assert.equal(/Existing reminder history will be kept/.test(code), false);

  const sidebar = readFileSync(join(ROOT, "components/dashboard/DashboardSidebar.tsx"), "utf8");
  assert.match(sidebar, /href: "\/dashboard\/archived"/, "discoverable in the invoice nav group");
  assert.match(sidebar, /label: "Archived"/);
});

// ── Archive concurrency ────────────────────────────────────────────────────
//
// `settle` runs BEFORE the fake takes its locks, so whatever a test does there
// is the racer winning. Every case asserts PERSISTED state, not the response.

test("ARCHIVE RACE: send wins — zero mutation, invoice stays unarchived", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  // The approve path claims the draft before archive gets its locks.
  db.settle = async () => {
    db.reminders.set("inv-1", [{ id: "rem-1", status: "sending", ownerEdited: false }]);
  };

  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");

  assert.equal(r.outcome, "in_flight");
  assert.equal(db.invoices.get("inv-1")!.archivedAt, null, "NOT archived");
  assert.deepEqual(db.archived, [], "no write at all");
  // The send keeps its valid, already-reviewed content.
  assert.equal(db.reminders.get("inv-1")![0].status, "sending");
});

test("ARCHIVE RACE: archive wins — draft is stood down in the same transaction", async () => {
  const db = new FakeDb({}, [
    { id: "rem-pending", status: "pending", ownerEdited: false },
    { id: "rem-sent", status: "sent", ownerEdited: false },
  ]);

  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "archived");

  const after = db.reminders.get("inv-1")!;
  // Non-claimable: CLAIMABLE_STATUSES is ('pending','failed'), so a concurrent
  // approve — and a bookmarked review URL — can no longer take this.
  assert.equal(after.find((x) => x.id === "rem-pending")!.status, "dismissed");
  // History and its consumed allowance are untouched.
  assert.equal(after.find((x) => x.id === "rem-sent")!.status, "sent");
  assert.ok(db.invoices.get("inv-1")!.archivedAt);
});

test("ARCHIVE RACE: prepare wins — the new draft is caught and stood down", async () => {
  // RACE A: the cron inserts a reminder before archive takes its locks. The
  // old two-statement flow dismissed first and would have missed this one
  // entirely, leaving an archived invoice owning a sendable reminder.
  const db = new FakeDb({}, []);
  db.settle = async () => {
    db.reminders.set("inv-1", [{ id: "rem-cron", status: "pending", ownerEdited: false }]);
  };

  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");

  assert.equal(r.outcome, "archived");
  assert.equal(db.reminders.get("inv-1")![0].status, "dismissed",
    "THE POINT: an archived invoice must own no sendable reminder");
  const sendable = db.reminders.get("inv-1")!.filter((x) => ["pending", "failed"].includes(x.status));
  assert.deepEqual(sendable, [], "nothing claimable remains");
});

test("ARCHIVE RACE: archive wins before prepare — the insert is then refused", async () => {
  // The other ordering. Once archived_at is set, migration 012's BEFORE INSERT
  // guard refuses any new reminder — and that guard takes `for share` on the
  // invoice, so it cannot slip in during the archive transaction either.
  const db = new FakeDb({}, []);
  assert.equal((await archiveInvoiceLifecycle(deps(db), "inv-1")).outcome, "archived");
  assert.ok(db.invoices.get("inv-1")!.archivedAt);

  const fn = DDL.slice(DDL.indexOf("function public.enforce_reminder_not_archived"));
  const body = fn.slice(0, fn.indexOf("$$;"));
  assert.match(body, /for share/, "the guard must LOCK, or it cannot serialise against archive");
  assert.match(body, /if v_archived is not null then/);
  assert.match(body, /raise exception/);
});

test("ARCHIVE: a mid-transaction failure leaves nothing half-done", async () => {
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  db.archiveInvoice = async () => "error" as const;

  const r = await archiveInvoiceLifecycle(deps(db), "inv-1");
  assert.equal(r.outcome, "database_unavailable");
  assert.equal(db.invoices.get("inv-1")!.archivedAt, null, "not archived");
  assert.equal(db.reminders.get("inv-1")![0].status, "pending", "draft not stood down");
});

test("[static] archive locks the invoice, then the reminders, and refuses before writing", () => {
  const fn = DDL.slice(DDL.indexOf("function public.archive_invoice_safely"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  const invoiceLock = body.indexOf("for update");
  const reminderLock = body.indexOf("for update", body.indexOf("from public.reminder_logs"));
  const sendingCheck = body.indexOf("if v_sending then");
  const firstWrite = body.indexOf("update public.invoices");

  assert.ok(invoiceLock > -1 && reminderLock > invoiceLock,
    "invoice before reminders — the same order everywhere, so no deadlock");
  assert.ok(sendingCheck > reminderLock, "the check happens UNDER the locks");
  assert.ok(firstWrite > sendingCheck, "and before any mutation");

  // Only unsent drafts; history untouched.
  assert.match(body, /set status = 'dismissed'[\s\S]*?and status = 'pending'/);
  for (const historical of ["sent", "delivery_unknown", "undelivered"]) {
    assert.equal(
      new RegExp(`status = '${historical}'\\s*;`).test(body), false,
      `${historical} must never be rewritten by archive`
    );
  }

  // Server-only, like every other lifecycle mutation.
  assert.match(fn.slice(0, 400), /security definer/);
  assert.match(fn.slice(0, 400), /set search_path = pg_catalog, pg_temp/);
  assert.equal(/auth\.uid\(\)/.test(body), false, "no false auth.uid() defence");
  assert.match(body, /and i\.user_id = p_user_id/, "the invoice lookup is owner-scoped");
  assert.match(body, /and user_id = p_user_id/, "and so is every reminder statement");
  assert.match(DDL, /revoke all on function public\.archive_invoice_safely\(uuid, uuid\) from anon, authenticated;/);
  assert.match(DDL, /grant execute on function public\.archive_invoice_safely\(uuid, uuid\) to service_role;/);
  assert.equal(
    /grant execute on function public\.archive_invoice_safely[^;]*\b(anon|authenticated)\b/.test(DDL),
    false
  );
});

// ── The edit patch whitelist ───────────────────────────────────────────────

test("[static] the edit RPC assigns named columns, never a generic JSON merge", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // Every editable column is assigned explicitly by name.
  for (const col of [
    "customer_name", "customer_email", "customer_phone",
    "invoice_reference", "job_description", "amount", "due_date", "payment_link",
  ]) {
    assert.match(
      body, new RegExp(`${col}\\s*=\\s*(nullif\\(|coalesce\\(|\\()?p_patch ->>`),
      `${col} must be assigned explicitly`
    );
  }

  // No jsonb_populate_record / row-merge primitive that would mutate whatever
  // key happened to arrive.
  for (const generic of [/jsonb_populate_record/, /#= /, /to_jsonb\(invoices/]) {
    assert.equal(generic.test(body), false, `no generic merge: ${generic}`);
  }
  // And no dynamic SQL, so no column name can be constructed from input.
  assert.equal(/execute\s+format\(/i.test(body), false, "no dynamic column construction");
});

test("[static] internal and lifecycle columns are unreachable through the patch", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const update = fn.slice(fn.indexOf("update public.invoices"));
  const setClause = update.slice(0, update.indexOf("where id = p_invoice_id"));

  // The update touches these columns and no others. Ownership, lifecycle and
  // payment state are all outside the set clause by construction.
  for (const forbidden of [
    "id", "user_id", "status", "archived_at", "created_at", "paid_at",
    "reminders_sent", "reminder_schedules", "reminder_tone", "escalation_status",
  ]) {
    assert.equal(
      new RegExp(`(^|[\\s,])${forbidden}\\s*=`, "m").test(setClause), false,
      `${forbidden} must never be assignable from p_patch`
    );
  }
});

test("[static] unknown patch keys are REJECTED, not silently ignored", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // Explicit assignment already makes a stray key inert. The rejection exists
  // so it cannot be sent silently: a caller who believes they set `status` and
  // receives success has been misled.
  assert.match(body, /jsonb_object_keys\(p_patch\)/);
  assert.match(body, /where k not in \(/);
  assert.match(body, /raise exception 'patch contains fields that are not editable/);

  // The allow-list in the guard must be exactly the columns assigned below it.
  const allowed = (body.match(/where k not in \(([\s\S]*?)\)/) ?? [])[1] ?? "";
  const listed = allowed.split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean).sort();
  assert.deepEqual(listed, [
    "amount", "customer_email", "customer_name", "customer_phone",
    "due_date", "invoice_reference", "job_description", "payment_link",
  ]);

  // The rejection must run before the invoice is touched.
  assert.ok(
    body.indexOf("raise exception 'patch contains fields") < body.indexOf("update public.invoices"),
    "reject before any write"
  );
});

test("the API only ever builds a patch of editable fields", () => {
  const route = readFileSync(join(ROOT, "app/api/invoices/[id]/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const patch = route.slice(route.indexOf("patch: {"), route.indexOf("},\n    }\n  );"));

  for (const forbidden of ["user_id", "status", "archived_at", "reminders_sent", "paid_at", "id:"]) {
    assert.equal(patch.includes(forbidden), false, `${forbidden} must not be in the patch`);
  }
  // Built from the validated form, never spread from the request body.
  assert.equal(/\.\.\.body/.test(patch), false, "no body spread into the patch");
  assert.match(patch, /clean\.customer_name/);
});

// ── The archived-send guard ────────────────────────────────────────────────

test("[static] a reminder on an archived invoice can never become 'sending'", () => {
  const fn = DDL.slice(DDL.indexOf("function public.enforce_send_not_archived"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  assert.match(DDL, /create trigger reminder_logs_archived_send_guard/);
  assert.match(DDL, /before update of status on public\.reminder_logs/);
  // Only the transition that can contact a customer — not every unrelated
  // update (reconciliation, attempt counters, content hashes).
  assert.match(DDL, /when \(new\.status = 'sending' and old\.status is distinct from 'sending'\)/);
  assert.match(body, /if v_archived is not null then/);
  assert.match(body, /raise exception/);
});

test("[static] the send guard covers 'failed', which archive deliberately leaves alone", () => {
  // archive_invoice_safely stands down 'pending' but not 'failed' — rewriting a
  // provider rejection as "the owner declined it" would destroy real history.
  // 'failed' is in CLAIMABLE_STATUSES, so the transition had to be guarded
  // instead of the status rewritten.
  const archiveFn = DDL.slice(DDL.indexOf("function public.archive_invoice_safely"));
  const archiveBody = archiveFn.slice(0, archiveFn.indexOf("$$;"));
  assert.match(archiveBody, /and status = 'pending'/);
  assert.equal(/'failed'/.test(archiveBody), false, "failed history must stay truthful");

  // The guard keys on the DESTINATION status, so it applies whatever the row
  // came from — pending, failed, or anything added later.
  const guard = DDL.slice(DDL.indexOf("function public.enforce_send_not_archived"));
  const guardBody = guard.slice(0, guard.indexOf("$$;"));
  assert.equal(/old\.status/.test(guardBody), false, "the source status is irrelevant");
  assert.match(DDL, /when \(new\.status = 'sending'/);
});

test("[static] the send guard does NOT lock, preserving the invoice→reminder order", () => {
  const fn = DDL.slice(DDL.indexOf("function public.enforce_send_not_archived"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // The firing statement has already locked the reminder row. Taking an
  // invoice lock here would be reminder→invoice while archive_invoice_safely
  // takes invoice→reminder: a deadlock between the two most important
  // operations in the product.
  assert.equal(/for update|for share/.test(body), false,
    "an unlocked read is required to keep the lock order consistent");
  assert.match(body, /from public\.invoices/);

  // Every other function keeps invoice-then-reminder.
  for (const name of ["archive_invoice_safely", "update_invoice_with_refresh"]) {
    const f = DDL.slice(DDL.indexOf(`function public.${name}`));
    const b = f.slice(0, f.indexOf("$$;"));
    const inv = b.indexOf("for update");
    const rem = b.indexOf("for update", b.indexOf("from public.reminder_logs"));
    assert.ok(inv > -1 && rem > inv, `${name} must lock invoice before reminders`);
  }
});

test("a bookmarked approval on an archived invoice is refused, calmly and typed", async () => {
  // The database raises 23514; the customer must never see a SQLSTATE, a
  // trigger name or a Postgres message.
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  db.claim = async () => ({ claimed: false, archived: true });

  const r = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: new FakeAllowanceStore() }),
    { reminderId: REMINDER_ID, reviewToken: token }
  );

  assert.equal(r.status, 409);
  assert.equal(r.body.state, "invoice_archived");
  assert.equal(r.body.message, "This invoice has been archived and can no longer send reminders.");
  assert.equal(mailer.calls.length, 0, "nothing was submitted");
  for (const leak of [/23514/, /trigger/i, /postgres/i, /supabase/i, /pg_/]) {
    assert.equal(leak.test(String(r.body.message)), false, `must not leak ${leak}`);
  }
});

test("a retry of a FAILED reminder on an archived invoice is refused the same way", async () => {
  // 'failed' is claimable, so without the guard this is the path that would
  // have contacted the customer from an archived invoice.
  const db = new FakeApprovalDb([makeStoredReminder({ status: "failed" })]);
  const mailer = new FakeMailer();
  const token = await freshToken(db);
  db.claim = async () => ({ claimed: false, archived: true });

  const r = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: new FakeAllowanceStore() }),
    { reminderId: REMINDER_ID, reviewToken: token }
  );

  assert.equal(r.body.state, "invoice_archived");
  assert.equal(mailer.calls.length, 0);
});

test("an unarchived invoice still sends normally", async () => {
  const db = new FakeApprovalDb([makeStoredReminder()]);
  const mailer = new FakeMailer();
  const r = await approveAndSendReminder(
    makeDeps(db, mailer, { allowance: new FakeAllowanceStore() }),
    { reminderId: REMINDER_ID, reviewToken: await freshToken(db) }
  );
  assert.equal(r.status, 200);
  assert.equal(mailer.calls.length, 1, "the guard must not block legitimate sends");
});

// ── Ownership under service role ───────────────────────────────────────────

test("cross-user: User A cannot edit, delete or archive User B's invoice", async () => {
  // The route derives userId from the verified session; the RPC scopes every
  // statement to it. Substituting User B's invoice id matches no row.
  for (const op of ["edit", "delete", "archive"] as const) {
    const db = new FakeDb({ userId: "user-B" }, [{ id: "r", status: "pending", ownerEdited: false }]);
    const asUserA = { db, userId: "user-A" };

    const r =
      op === "edit"   ? await editInvoice(asUserA, { invoiceId: "inv-1", patch: patch({ amount: 1 }), acceptRefresh: true })
    : op === "delete" ? await deleteInvoiceLifecycle(asUserA, "inv-1")
    :                   await archiveInvoiceLifecycle(asUserA, "inv-1");

    assert.equal(r.outcome, "not_found", op);
    // Zero persisted mutation — asserted on state, not the status code.
    assert.deepEqual(db.updated, [], `${op} wrote to the invoice`);
    assert.deepEqual(db.deleted, [], `${op} deleted`);
    assert.deepEqual(db.archived, [], `${op} archived`);
    assert.equal(db.invoices.get("inv-1")!.archivedAt, null, op);
    assert.equal(db.invoices.get("inv-1")!.amount, 1500, `${op} changed the amount`);
    assert.equal(db.reminders.get("inv-1")![0].status, "pending", `${op} touched the draft`);
  }
});

test("[static] the routes derive userId from the session, never from the body", () => {
  for (const f of ["app/api/invoices/[id]/route.ts", "app/api/invoices/[id]/archive/route.ts"]) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    assert.match(code, /auth\.getUser\(\)/, `${f} must authenticate server-side`);
    assert.match(code, /userId: user\.id/, `${f} must pass the session identity`);
    // A body-supplied identity would make p_user_id an attacker-chosen value.
    for (const bad of [/user_id:\s*body/, /userId:\s*body/, /p_user_id:\s*body/, /body\.user_id/]) {
      assert.equal(bad.test(code), false, `${f} must not take an id from the request`);
    }
  }
  // And the adapter passes that trusted id straight through.
  const db = readFileSync(join(ROOT, "lib/invoice-lifecycle-db.ts"), "utf8");
  assert.match(db, /p_user_id: userId/);
});

test("[static] archive takes no caller timestamp — the database records the time", () => {
  const fn = DDL.slice(DDL.indexOf("function public.archive_invoice_safely"));
  const sig = fn.slice(0, fn.indexOf("as $$"));
  assert.equal(/p_at|p_archived_at|timestamptz/.test(sig), false, "no timestamp parameter");

  const body = fn.slice(0, fn.indexOf("$$;"));
  assert.match(body, /set archived_at = pg_catalog\.now\(\)/);

  const adapter = readFileSync(join(ROOT, "lib/invoice-lifecycle-db.ts"), "utf8");
  const archiveFn = adapter.slice(adapter.indexOf("async archiveInvoice("));
  assert.equal(/p_at:/.test(archiveFn.slice(0, 600)), false, "the adapter must not send one either");
});

test("[static] EVERY function in 012 is locked down — no exceptions, now or later", () => {
  // A per-function assertion list is one `create function` away from being
  // incomplete. This derives the list from the migration itself, so a function
  // added tomorrow is covered without anyone remembering to add a test.
  const created = Array.from(DDL.matchAll(/create or replace function public\.(\w+)\(/g))
    .map((m) => m[1]);
  assert.equal(created.length, 5, "delete guard, archive guard, send guard, edit RPC, archive RPC");

  const MUTATION_RPCS = ["update_invoice_with_refresh", "archive_invoice_safely"];

  for (const name of created) {
    // PostgreSQL grants EXECUTE to PUBLIC on creation — revoking is required.
    assert.match(DDL, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public;`),
      `${name} must be revoked from PUBLIC`);
    assert.match(DDL, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from anon, authenticated;`),
      `${name} must be revoked from browser roles`);

    // No browser role may ever be granted EXECUTE on anything here.
    const grants = Array.from(DDL.matchAll(
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)[^;]*;`, "g")
    )).map((m) => m[0]);

    for (const g of grants) {
      assert.equal(/\banon\b/.test(g), false, `${name}: anon must never be granted`);
      assert.equal(/\bauthenticated\b/.test(g), false, `${name}: authenticated must never be granted`);
      assert.match(g, /service_role/, `${name}: the only grantee is service_role`);
    }

    if (MUTATION_RPCS.includes(name)) {
      assert.equal(grants.length, 1, `${name} is called by the server and needs exactly one grant`);
    } else {
      // Trigger functions are invoked BY the trigger; EXECUTE is checked at
      // creation time, not fire time, so they need no grant at all.
      assert.equal(grants.length, 0, `${name} is a trigger function and needs no grant`);
    }
  }
});

// ── FINDING 1: the delete guard locks before deciding ──────────────────────

test("[static] the delete guard LOCKS every reminder row before judging deletability", () => {
  const fn = DDL.slice(DDL.indexOf("function public.enforce_invoice_deletable"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  const lock = body.indexOf("for update");
  const read = body.indexOf("select r.status");
  assert.ok(lock > -1, "the guard must lock, not merely read");
  assert.ok(lock < read, "lock BEFORE the status read, or a claim can overtake it");

  // ALL rows, not only the protected ones — locking only protected statuses
  // would miss the 'pending' row the race actually needs.
  const lockStmt = body.slice(body.indexOf("perform 1"), lock + 12);
  assert.match(lockStmt, /where invoice_id = old\.id/);
  assert.equal(/status in \(/.test(lockStmt), false, "the lock must not filter by status");

  // The migration must no longer claim the statement boundary alone suffices.
  assert.match(MIGRATION, /NECESSARY BUT NOT\n-- SUFFICIENT/);
});

test("delete loses to a concurrent send, and the invoice survives", async () => {
  // Models the locked guard: the claim commits first, so when the DELETE
  // resumes it sees a protected state and refuses.
  const db = new FakeDb({}, [{ id: "rem-1", status: "pending", ownerEdited: false }]);
  db.databaseRefusesDelete = true;   // the trigger's refusal
  db.reminders.set("inv-1", [{ id: "rem-1", status: "sending", ownerEdited: false }]);

  const r = await deleteInvoiceLifecycle(deps(db), "inv-1");

  assert.equal(r.outcome, "in_flight");
  assert.deepEqual(db.deleted, [], "no DELETE was attempted");
  assert.equal(db.invoices.has("inv-1"), true, "invoice and history survive");
});

// ── FINDING 2: the reminder must belong to the invoice ─────────────────────

test("[static] every p_reminder_id operation is bound to p_invoice_id", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // The status read.
  assert.match(body, /where id = p_reminder_id\s*\n\s*and user_id = p_user_id\s*\n\s*and invoice_id = p_invoice_id;/);
  // The reminder update.
  assert.match(body, /where id = p_reminder_id\s*\n\s*and user_id = p_user_id\s*\n\s*and invoice_id = p_invoice_id;[\s\S]*?generated_subject/);

  // Owner-only scoping is not enough on its own anywhere near p_reminder_id.
  const near = body.slice(body.indexOf("if p_reminder_id is not null then"));
  const ownerOnly = Array.from(near.matchAll(/where id = p_reminder_id and user_id = p_user_id;/g));
  assert.equal(ownerOnly.length, 0, "an (id, user_id) match alone lets Invoice A rewrite Reminder B");
});

test("a reminder from ANOTHER invoice of the same owner is refused, with zero mutation", async () => {
  // Invoice A + Reminder A, Invoice B + Reminder B, one owner. Editing A while
  // naming B's reminder must change nothing at all.
  const db = new FakeDb({}, [{ id: "rem-A", status: "pending", ownerEdited: false }]);
  db.invoices.set("inv-B", { ...db.invoices.get("inv-1")!, id: "inv-B" });
  db.reminders.set("inv-B", [{ id: "rem-B", status: "pending", ownerEdited: false }]);
  // The commit re-checks the binding, as the SQL does.
  db.bindReminderToInvoice = true;

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
    overrideReminderId: "rem-B",
  });

  assert.equal(r.body.requiresReload, true, "typed refusal, no cross-object detail");
  assert.deepEqual(db.updated, [], "Invoice A unchanged");
  assert.equal(db.invoices.get("inv-1")!.amount, 1500);
  assert.deepEqual(db.regenerated, [], "no channel content rewritten");
  assert.equal(db.reminders.get("inv-B")![0].status, "pending", "Reminder B untouched");
  assert.equal(db.reminders.get("inv-1")![0].status, "pending", "Reminder A untouched");
});

// ── FINDING 3: the SMS + email pair is enforced ────────────────────────────

test("[static] the channel pair is validated before any write", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  assert.match(body, /if p_channels is null or jsonb_typeof\(p_channels\) <> 'array' then/);
  assert.match(body, /<> 2 then\s*\n\s*raise exception 'a reminder refresh requires exactly two channels/);
  // The comparison matters as much as the expression: `<> 0` would let a
  // duplicated email through as "one distinct channel".
  assert.match(
    body,
    /count\(distinct c ->> 'channel'\)[\s\S]*?\) <> 2 then/,
    "exactly TWO distinct channels — duplicates must not pass"
  );
  assert.match(body, /c ->> 'channel' in \('email', 'sms'\)/, "unknown channels rejected");
  assert.match(body, /coalesce\(c ->> 'body', ''\) <> ''/, "each channel needs a body");

  // All of it before the first channel write.
  assert.ok(
    body.indexOf("requires exactly two channels") < body.indexOf("update public.reminder_channel_messages"),
    "validate before mutating"
  );
});

test("[static] exactly two stored rows must actually update, or everything rolls back", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // Set-based with a row count, not a loop that can silently match nothing.
  assert.match(body, /with supplied as \(/);
  assert.match(body, /returning 1\s*\n\s*\)\s*\n\s*select count\(\*\) into v_applied from applied;/);
  assert.match(body, /if v_applied <> 2 then/);
  assert.match(body, /raise exception[\s\S]*?both SMS and email must refresh together/);
  assert.equal(/for v_channel in/.test(body), false, "the unverifiable loop is gone");

  // Raising inside the transaction is what rolls the invoice update back too.
  assert.ok(
    body.indexOf("update public.invoices") < body.indexOf("if v_applied <> 2 then"),
    "the invoice update precedes the check, so the rollback is what protects it"
  );
  // Missing rows are NOT quietly inserted — migration 010 creates both when a
  // reminder is prepared, so a missing row means the data is already wrong.
  assert.equal(/insert into public\.reminder_channel_messages/.test(body), false);
});

// ── FINDING 4: direct browser UPDATE ───────────────────────────────────────


test("[static] no invoice UPDATE runs under a browser role any more", () => {
  // Migration 013 revokes UPDATE on invoices from `authenticated` outright.
  // Every legitimate writer must therefore go through the service-role client.
  //
  // The file list is DERIVED, not enumerated. An earlier version named three
  // files by hand and therefore said nothing about app/api/onboarding/resume
  // or app/api/reminders/prepare — both of which run as `authenticated`. They
  // are SELECT-only today, but nothing was checking that.
  //
  // Anything holding a browser or session client is in scope; only the
  // service-role client (getSupabaseAdmin) may mutate invoices after 013.
  const SESSION_CLIENT_FILES = walk(join(ROOT, "lib"))
    .concat(walk(join(ROOT, "app")))
    .concat(walk(join(ROOT, "components")))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => f.slice(ROOT.length))
    .filter((f) => {
      const code = readFileSync(join(ROOT, f), "utf8");
      return /getSupabaseServer|getSupabaseBrowser/.test(code)
        && /\.from\("invoices"\)/.test(code);
    });

  // The derivation must actually find something, or the loop below is vacuous
  // and would pass no matter what the code did.
  assert.ok(SESSION_CLIENT_FILES.length >= 3,
    `expected several session-client invoice files, found ${SESSION_CLIENT_FILES.length}`);

  for (const f of SESSION_CLIENT_FILES) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(
      /\.from\("invoices"\)\s*\n?\s*\.update\(/.test(code), false,
      `${f} still updates invoices directly; 013 revokes that privilege`
    );
    // DELETE is revoked by the same migration, and unlike UPDATE it also
    // cascades through reminder_logs into the allowance ledger.
    assert.equal(
      /\.from\("invoices"\)\s*\n?\s*\.delete\(/.test(code), false,
      `${f} still deletes invoices directly; 013 revokes that privilege`
    );
  }

  // The three transitions live in one trusted module, each owner-scoped.
  const writes = readFileSync(join(ROOT, "lib/invoice-owner-writes.ts"), "utf8");
  for (const fn of [
    "markInvoicePaidForOwner", "setEscalationForOwner", "setRemindersSentForOwner",
  ]) {
    assert.match(writes, new RegExp(`export function ${fn}`), `${fn} must exist`);
  }
  // service_role bypasses RLS, so this predicate IS the ownership check —
  // asserted as one contiguous chain, because a loose two-part match passes
  // even when the user scoping has been deleted.
  assert.match(
    writes,
    /\.update\(patch\)\s*\n\s*\.eq\("id", invoiceId\)\s*\n(?:\s*\/\/[^\n]*\n)*\s*\.eq\("user_id", userId\)/,
    "every scopedUpdate must filter on BOTH id and user_id"
  );
  // And every reminder_logs write in this module is owner-scoped too.
  const dismiss = writes.slice(writes.indexOf("dismissPendingForOwner"));
  assert.match(dismiss, /\.eq\("invoice_id", invoiceId\)\s*\n\s*\.eq\("user_id", userId\)/);

  assert.match(writes, /matched: \(data\?\.length \?\? 0\) > 0/, "a mismatch must be detectable");
});

test("[static] Mark Paid goes through the server, and cannot be told whose invoice", () => {
  const invoices = readFileSync(join(ROOT, "lib/invoices.ts"), "utf8");
  assert.match(invoices, /fetch\(`\/api\/invoices\/\$\{id\}\/paid`, \{ method: "POST" \}\)/);

  const route = readFileSync(join(ROOT, "app/api/invoices/[id]/paid/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(route, /auth\.getUser\(\)/, "authenticate server-side");
  assert.match(route, /markInvoicePaidForOwner\(admin, params\.id, user\.id/);
  // The body is never read, so it cannot carry a user id.
  assert.equal(/request\.json\(\)|body\./.test(route), false, "no request body is trusted");
  // Not-yours and gone are the same answer.
  assert.match(route, /if \(!result\.matched\)[\s\S]{0,160}"not_found"/);
  // The kill switch survives the move.
  assert.match(route, /dismissPendingForOwner\(admin, params\.id, user\.id\)/);
});

test("[static] the actions route and approve route scope by the session user", () => {
  const actions = readFileSync(join(ROOT, "app/api/invoices/actions/route.ts"), "utf8");
  assert.match(actions, /markInvoicePaidForOwner\(\s*\n?\s*admin, body\.invoice_id, user\.id/);
  assert.match(actions, /setEscalationForOwner\(admin, body\.invoice_id, user\.id, newEscalation\)/);
  // invoice_id may come from the body; the USER never may.
  assert.equal(/user\.id\s*=|userId:\s*body/.test(actions), false);

  const approve = readFileSync(join(ROOT, "app/api/reminders/[id]/approve/route.ts"), "utf8");
  assert.match(approve, /setRemindersSentForOwner\(admin, invoiceId, userId,/);
  assert.match(approve, /\.eq\("user_id", userId\)/, "the read is owner-scoped too");
});

// ── The p_patch contract ───────────────────────────────────────────────────

test("[static] p_patch is COMPLETE editable state, not a partial patch", () => {
  // The route builds every editable field on every request from the validated
  // form, so assigning all of them is correct. A genuinely partial PATCH would
  // blank the omitted ones — this test pins the contract that makes it safe.
  const route = readFileSync(join(ROOT, "app/api/invoices/[id]/route.ts"), "utf8");
  const patchBlock = route.slice(route.indexOf("patch: {"), route.indexOf("},\n    }\n  );"));
  for (const f of REMINDER_CONTENT_FIELDS) {
    assert.ok(patchBlock.includes(`${f}:`), `${f} must always be sent — the RPC assigns it unconditionally`);
  }

  // coerceInvoiceForm fills every key and validateInvoiceForm requires them,
  // so an omitted field is a 400 rather than a silent blanking.
  assert.match(route, /coerceInvoiceForm\(body as never\)/);
  assert.match(route, /validateInvoiceForm\(form\)/);
  const coerce = readFileSync(join(ROOT, "lib/invoice-write.ts"), "utf8");
  for (const f of REMINDER_CONTENT_FIELDS) {
    assert.ok(coerce.includes(`${f}:`), `coerceInvoiceForm must default ${f}`);
  }
});

// ── Final privilege matrix ─────────────────────────────────────────────────

/**
 * The audited Add Invoice payload — exactly the keys of InvoiceInsert
 * (types/index.ts), as built by DashboardProvider.handleAddInvoice and
 * lib/invoice-write.ts createInvoiceForUser.
 *
 * This list is the whole basis of 013's column-scoped INSERT grant, so it is
 * checked against the type in both directions below. If someone adds a field to
 * the form without widening the grant, Add Invoice breaks in production; if
 * someone widens the grant without the form needing it, the browser silently
 * gains authority over a column. Neither can happen quietly.
 */
const INSERT_COLUMNS = [
  "customer_name", "customer_email", "customer_phone", "amount", "due_date",
  "payment_link", "invoice_reference", "job_description", "reminder_tone",
  "reminder_schedules",
];

/**
 * Columns the browser must NEVER supply at creation time.
 *
 * Every one has a VERIFIED production default or is set by a later trusted
 * transition (read-only query on main — PRODUCTION):
 *   id gen_random_uuid() · user_id auth.uid() · created_at now()
 *   status 'unpaid' · reminders_sent '{}' · escalation_status 'active'
 *   paid_at nullable, Mark Paid route · archived_at nullable, migration 012
 */
const WITHHELD_COLUMNS = [
  "id", "user_id", "created_at", "status", "reminders_sent",
  "escalation_status", "paid_at", "archived_at",
];

/**
 * The subset of INSERT_COLUMNS that is NOT optional in InvoiceInsert, derived
 * from the type so the two cannot drift. `invoice_reference` and
 * `job_description` are declared `?:` and are nullable in production.
 */
const REQUIRED_INSERT_COLUMNS = (() => {
  const types = readFileSync(join(ROOT, "types/index.ts"), "utf8");
  const iface = types.slice(types.indexOf("export interface InvoiceInsert"));
  const body = iface.slice(0, iface.indexOf("\n}"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return Array.from(body.matchAll(/^\s*(\w+)(\??):/gm))
    .filter((m) => m[2] !== "?").map((m) => m[1]);
})();

/**
 * The two EXECUTABLE insert sites. Both run as `authenticated`:
 * invoice-create-payload feeds the browser client from DashboardProvider,
 * invoice-write runs via app/api/onboarding/invoices, which uses
 * getSupabaseServer() — a fact worth stating because it makes the onboarding
 * path subject to 013 too, and it was originally missed.
 */
const INSERT_SITES = [
  "lib/invoice-create-payload.ts",
  "lib/invoice-write.ts",
];

test("[static] 012 contains NO table privilege change — it is safe to apply first", () => {
  // THE DEPLOYMENT TRAP THIS CLOSES:
  //
  // 012 must be appliable while the CURRENTLY DEPLOYED app is still serving
  // traffic. A revoke in this file would break Mark Paid for every customer the
  // instant it landed, and would stay broken until the new deploy finished.
  // There is no ordering that makes a combined migration safe, which is why the
  // privilege work moved to 013.
  const stmts = DDL.split(";");
  for (const stmt of stmts) {
    if (!/\b(grant|revoke)\b/i.test(stmt)) continue;
    assert.equal(
      /\btable\b|\bon\s+public\.invoices\b/i.test(stmt), false,
      `012 must not change table privileges, found: ${stmt.trim().slice(0, 90)}`
    );
    // What IS allowed here: function grants, which are new objects 012 creates.
    assert.match(stmt, /on function/i,
      `012 may only grant on functions it creates, found: ${stmt.trim().slice(0, 90)}`);
  }
});

test("[static] 013 revokes everything first, then grants back only what is needed", () => {
  // Revoke-then-grant, not grant-over-existing: starting from zero is what
  // stops a privilege surviving because nobody remembered it was there.
  const revokeAuth = PERMS_DDL.indexOf("revoke all privileges on table public.invoices from authenticated;");
  const grantSelect = PERMS_DDL.indexOf("grant select on table public.invoices to authenticated;");
  const grantInsert = PERMS_DDL.indexOf("grant insert (");

  assert.ok(revokeAuth > -1, "authenticated must be fully revoked first");
  assert.ok(grantSelect > revokeAuth, "SELECT must be granted AFTER the revoke");
  assert.ok(grantInsert > revokeAuth, "INSERT must be granted AFTER the revoke");

  // anon keeps nothing, and never appears as a grantee.
  assert.match(PERMS_DDL, /revoke all privileges on table public\.invoices from anon;/);
  assert.equal(
    /grant [\s\S]*?on table public\.invoices to [^;]*\banon\b/.test(PERMS_DDL), false,
    "anon must hold no invoice privilege"
  );

  // No table-level UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES comes back.
  for (const priv of ["update", "delete", "truncate", "trigger", "references"]) {
    const granted = PERMS_DDL.match(
      new RegExp(`grant [^;]*\\b${priv}\\b[^;]*on table public\\.invoices`, "i")
    );
    assert.equal(granted, null, `${priv} must never be granted back`);
  }
});

test("[static] the INSERT grant is column-scoped to exactly the audited payload", () => {
  const m = PERMS_DDL.match(/grant insert \(([\s\S]*?)\)\s*on table public\.invoices to authenticated;/);
  assert.ok(m, "the INSERT grant must be column-scoped, not whole-table");

  const granted = m![1].split(",").map((c) => c.trim()).filter(Boolean).sort();
  assert.deepEqual(granted, [...INSERT_COLUMNS].sort(),
    "the granted columns must be exactly the audited Add Invoice payload");

  // And no whole-table INSERT anywhere as a softer version of the same hole.
  assert.equal(
    /grant [^(;]*\binsert\b[^(;]*on table public\.invoices/i.test(PERMS_DDL), false,
    "whole-table INSERT must not be granted"
  );

  for (const col of WITHHELD_COLUMNS) {
    assert.equal(granted.includes(col), false,
      `${col} is internal state and must not be browser-writable at creation`);
  }
});

test("[static] the grant matches InvoiceInsert in BOTH directions", () => {
  // The drift guard. INSERT_COLUMNS above is only trustworthy if it still
  // describes the real type, so it is checked against the source of truth
  // rather than maintained by hand.
  const types = readFileSync(join(ROOT, "types/index.ts"), "utf8");
  const iface = types.slice(types.indexOf("export interface InvoiceInsert"));
  const body = iface.slice(0, iface.indexOf("\n}"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const declared = Array.from(body.matchAll(/^\s*(\w+)\??:/gm)).map((x) => x[1]).sort();
  assert.deepEqual(declared, [...INSERT_COLUMNS].sort(),
    "InvoiceInsert and the 013 grant list must not drift apart");

  // Each withheld column named individually, so a failure says WHICH one.
  for (const col of WITHHELD_COLUMNS) {
    assert.equal(new RegExp(`^\\s*${col}\\??:`, "m").test(body), false,
      `InvoiceInsert must not invite callers to send ${col} — the database owns it`);
  }
});

test("[static] no executable insert payload sends a database-owned column", () => {
  // THE RUNTIME CONSEQUENCE THIS PROTECTS:
  //
  // After 013, naming any withheld column in an INSERT under `authenticated`
  // fails with "permission denied for column". A payload that still sends
  // status = 'unpaid' does not merely duplicate a default — it breaks Add
  // Invoice outright. Both sites are checked, including the onboarding path,
  // which runs on the session client and is therefore equally bound.
  for (const f of INSERT_SITES) {
    const code = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Brace-MATCHED, not indexOf("})"). invoice-write spreads two fields
    // conditionally — `...(x ? { invoice_reference: x } : {})` — so the naive
    // slice ended at that inner `})` and silently examined a fragment,
    // reporting the real fields further down as missing.
    const call = code.slice(code.search(/\.insert\(|return \{/));
    const open = call.indexOf("{");
    let depth = 0, close = open;
    for (let k = open; k < call.length; k++) {
      if (call[k] === "{") depth++;
      else if (call[k] === "}" && --depth === 0) { close = k; break; }
    }
    assert.ok(close > open, `${f}: could not locate the insert payload`);
    const payload = call.slice(open, close + 1);

    for (const col of WITHHELD_COLUMNS) {
      // `[,:]` — ES6 SHORTHAND COUNTS. `{ status }` sends the column just as
      // surely as `{ status: x }`, and a colon-only check would not see it.
      assert.equal(new RegExp(`\\b${col}\\s*[,:]`).test(payload), false,
        `${f} still sends ${col}; 013 denies INSERT on that column`);
    }
    // ...and the REQUIRED fields are still there, or creation is broken in the
    // other direction.
    //
    // The whitelist is a ceiling, not a floor: invoice_reference and
    // job_description are optional in InvoiceInsert and nullable in production,
    // and the dashboard Add Invoice form collects neither (only onboarding
    // does). Requiring all ten here would fail on a payload that is entirely
    // correct — so required/optional is read from the type rather than assumed.
    for (const col of REQUIRED_INSERT_COLUMNS) {
      assert.ok(new RegExp(`\\b${col}\\s*[,:]`).test(payload),
        `${f} must still supply ${col}`);
    }
  }
});

test("[static] the verified production defaults are written down, not assumed", () => {
  // Narrowing the grant is only safe BECAUSE these defaults exist. If the
  // reasoning is not recorded next to the SQL, the next person cannot tell
  // whether omitting status was justified or an oversight.
  const flat = PERMS.replace(/\n\s*--\s*/g, " ");
  for (const [col, def] of [
    ["id", "gen_random_uuid\\(\\)"], ["user_id", "auth\\.uid\\(\\)"],
    ["created_at", "now\\(\\)"], ["status", "'unpaid'"],
    ["reminders_sent", "empty text\\[\\]"], ["escalation_status", "'active'"],
    ["reminder_tone", "'firm'"], ["reminder_schedules", "empty text\\[\\]"],
  ] as const) {
    assert.match(flat, new RegExp(`${col}\\s+${def}`),
      `013 must record the verified default for ${col}`);
  }
  assert.match(flat, /VERIFIED PRODUCTION DEFAULTS/);

  // The onboarding path runs as `authenticated` too. That is the non-obvious
  // fact behind fixing invoice-write, so it must survive in the file.
  assert.match(flat, /getSupabaseServer\(\), so it[\s\S]{0,40}runs as `authenticated`/);
});

test("[static] each migration rolls back only its own concern", () => {
  const rb012 = MIGRATION.slice(MIGRATION.indexOf("── Rollback"));
  const rb013 = PERMS.slice(PERMS.indexOf("── Rollback"));

  // 012's rollback must not touch privileges — it did not change them.
  assert.equal(
    /privileges on table public\.invoices/.test(rb012), false,
    "012's rollback must not restore privileges it never revoked"
  );
  // ...but must still drop what it created.
  assert.match(rb012, /drop function[\s\S]*archive_invoice_safely/);
  assert.match(rb012, /archived_at/);

  // 013's rollback restores the EXACT verified pre-hardening state.
  for (const role of ["anon", "authenticated"]) {
    assert.match(
      rb013,
      new RegExp(`grant select, insert, update, delete, references, trigger, truncate\\s*\\n--\\s*on table public\\.invoices to ${role};`),
      `013's rollback must restore ${role}'s verified pre-013 grants exactly`
    );
    // The revoke must come first, or the column-scoped INSERT from this
    // migration survives underneath the restored table grant.
    //
    // indexOf is checked for presence BEFORE being compared: a missing revoke
    // returns -1, and -1 < anything is true, so the naive comparison passes
    // precisely when the revoke has been deleted.
    const revokeAt = rb013.indexOf(`revoke all privileges on table public.invoices from ${role};`);
    const grantAt = rb013.indexOf(`to ${role};`);
    assert.ok(revokeAt > -1, `013's rollback must revoke ${role} before re-granting`);
    assert.ok(grantAt > -1, `013's rollback must re-grant ${role}`);
    assert.ok(revokeAt < grantAt, `${role} must be revoked before being re-granted`);
  }
  assert.match(rb013, /RE-OPENS THE BROAD BROWSER MUTATION SURFACE/,
    "restoring must not read as a safe default");
});

test("[static] both files state the same deployment order", () => {
  for (const [name, text] of [["012", MIGRATION], ["013", PERMS]] as const) {
    // Slice to the DEPLOYMENT ORDER block ONLY. Reading from the top of the
    // file would match the "MIGRATION 013 of 2" in 013's own banner and call
    // that the apply step, which would pass while the order was wrong.
    const from = text.indexOf("── DEPLOYMENT ORDER");
    assert.ok(from > -1, `${name} must state the deployment order`);
    const rest = text.slice(from + 20);
    const plan = rest.slice(0, rest.indexOf("\n-- ──"));
    // 012 applied, app deployed and verified, THEN 013.
    const apply012 = plan.indexOf("012");
    const deploy = plan.search(/[Dd]eploy the application/);
    const verify = plan.search(/[Vv]erif/);
    const apply013 = plan.indexOf("013");
    assert.ok(apply012 > -1 && deploy > apply012, `${name}: 012 must precede the deploy`);
    assert.ok(verify > deploy, `${name}: verification must follow the deploy`);
    assert.ok(apply013 > verify, `${name}: 013 must come after verification`);
  }
  // 013 must carry an unmissable do-not-apply-early warning at the very top.
  assert.match(PERMS.slice(0, 600), /DO NOT APPLY UNTIL THE NEW APPLICATION IS DEPLOYED/);

  // ...and it must describe what 013 actually does. "The browser cannot write
  // invoices at all" was an overstatement: authenticated creation stays
  // deliberately allowed through the ten-column grant. An operator who
  // believes creation is blocked would read a working Add Invoice as a failed
  // migration — the same false alarm as the has_table_privilege error.
  const gate = PERMS.replace(/\n--\s*/g, " ");
  assert.equal(/the browser cannot write\s+invoices at all/.test(gate), false,
    "013 must not claim browser writes are entirely removed");
  assert.match(gate, /can no longer\s+UPDATE or DELETE invoices directly/);
  assert.match(gate, /Authenticated browser creation remains intentionally\s+allowed/);
});

test("[static] 013's verification cannot mistake a column grant for a table grant", () => {
  const v = PERMS.slice(PERMS.indexOf("── Verification"));

  // has_table_privilege() reports the TABLE-level grant ONLY. It does NOT
  // become true because the role holds the privilege on some columns —
  // has_any_column_privilege() is the function that covers table-OR-column.
  //
  // 013 revokes table-level INSERT and grants ten columns, so the correct
  // post-013 answer is has_table_privilege(...,'INSERT') = FALSE. An earlier
  // draft of this file said the opposite and told the operator to EXPECT true,
  // which would have made a correctly applied migration look like a broken
  // deploy at exactly the moment someone was deciding whether to roll back.
  assert.match(v, /has_table_privilege\('authenticated', 'public\.invoices', 'UPDATE'\)/);
  assert.match(v, /has_table_privilege\('authenticated', 'public\.invoices', 'DELETE'\)/);
  assert.match(v, /has_any_column_privilege\('authenticated', 'public\.invoices', 'INSERT'\)/,
    "column-derived INSERT must be checked with has_any_column_privilege");
  assert.match(v, /ins_table\s+f/,
    "table-level INSERT must be documented as expected FALSE after 013");
  assert.match(v, /ins_any_col\s+t/,
    "any-column INSERT must be documented as expected TRUE after 013");
  assert.equal(/EXPECT: sel t \| ins t/.test(v), false,
    "the old, wrong expectation must not return");
  assert.match(v, /information_schema\.column_privileges/,
    "the INSERT columns must be enumerated, not inferred from the table privilege");
  assert.match(v, /has_column_privilege\('authenticated','public\.invoices','user_id','INSERT'\)/);
  assert.match(v, /has_column_privilege\('authenticated','public\.invoices','archived_at','INSERT'\)/);
  // The distinction wraps across comment lines, so match it with the line
  // prefixes collapsed. Verification SQL is doubly commented ("--   --   ").
  const flat = v.replace(/\n\s*--\s*(--\s*)?/g, " ");
  assert.match(flat, /has_table_privilege\(\)\s+— the TABLE-level grant only/,
    "the two functions must be distinguished in writing, not just in the query");
  assert.match(flat, /It does NOT become true because the role holds the privilege on some columns/);
  assert.match(flat, /That is the migration working, not a broken deploy/,
    "the operator must be told FALSE is the correct result, or they may roll back");

  // Every permitted column proved TRUE and every denied column proved FALSE,
  // named individually — a count or a spot-check would let one slip.
  for (const col of INSERT_COLUMNS) {
    assert.match(v, new RegExp(`has_column_privilege\\('authenticated','public\\.invoices','${col}','INSERT'\\)`),
      `verification must prove ${col} is permitted`);
  }
  for (const col of WITHHELD_COLUMNS) {
    assert.match(v, new RegExp(`has_column_privilege\\('authenticated','public\\.invoices','${col}','INSERT'\\)`),
      `verification must prove ${col} is denied`);
  }

  // The behavioural checks. A denial must be demonstrated for each lifecycle
  // column an attacker would actually want to set at creation, not just
  // asserted by the privilege query above.
  assert.match(v, /permission denied for table invoices/);
  assert.match(v, /INSERT 0 1/, "a legitimate Add Invoice must be shown still working");
  for (const col of ["status", "user_id", "reminders_sent", "archived_at"]) {
    assert.match(v, new RegExp(`permission denied for column ${col}`),
      `verification must demonstrate ${col} being refused, not merely assert it`);
  }
  // status = 'paid' specifically: the case where a customer marks an invoice
  // paid at creation and silences their own chasing.
  assert.match(v, /'paid'\);/, "the status = 'paid' rejection test must be present");

  // Mutation examples must not persist. Every insert/update/delete in the
  // verification block is wrapped, so the count of BEGINs matches ROLLBACKs
  // and no COMMIT appears.
  const begins = (v.match(/^\s*--\s*--\s*begin;/gm) ?? []).length;
  const rollbacks = (v.match(/^\s*--\s*--\s*rollback;/gm) ?? []).length;
  assert.ok(begins >= 8, `expected the behavioural tests to be wrapped, found ${begins}`);
  assert.equal(begins, rollbacks, "every begin must have a matching rollback");
  assert.equal(/\bcommit;/i.test(v), false, "no verification example may commit");

  // RLS is narrowed alongside, never replaced.
  assert.match(v, /pg_policies/, "RLS policies must be confirmed intact");
  assert.equal(/(disable row level security|drop policy)/i.test(PERMS_DDL), false,
    "013 must not weaken RLS");
});

test("[static] every PL/pgSQL variable in 012 is declared in its own function", () => {
  // A COMPILE BLOCKER THAT NO OTHER GATE CATCHES.
  //
  // update_invoice_with_refresh referenced v_archived while its DECLARE block
  // listed only v_sending, v_status, v_applied and v_unknown. PostgreSQL
  // rejects the whole function at creation time, so migration 012 would have
  // failed on the FIRST statement of a production deployment.
  //
  // tsc, npm test and npm run build cannot see this — no SQL is executed
  // anywhere in this repo. Scoping is per-function: a variable declared in one
  // function says nothing about another, which is exactly how this slipped in.
  const bodies = Array.from(MIGRATION.matchAll(
    /create or replace function public\.(\w+)[\s\S]*?\nas \$\$\n([\s\S]*?)\n\$\$;/g
  ));
  assert.ok(bodies.length >= 5, `expected 012's functions, found ${bodies.length}`);

  for (const [, name, raw] of bodies) {
    // Comments stripped first: the prose in this migration names variables
    // while discussing them, which would otherwise read as usage.
    const body = raw.replace(/--.*$/gm, "");
    const declEnd = body.indexOf("begin");
    assert.ok(declEnd > -1, `${name}: no begin block found`);

    const declared = new Set(
      Array.from(body.slice(0, declEnd).matchAll(/^\s*(v_\w+)\s/gm)).map((m) => m[1])
    );
    // Array, not Set: the tsconfig target here does not permit Set iteration.
    const used = Array.from(
      new Set(Array.from(body.slice(declEnd).matchAll(/\b(v_\w+)\b/g)).map((m) => m[1]))
    );

    for (const v of used) {
      assert.ok(declared.has(v),
        `${name} uses ${v} but never declares it — PostgreSQL will refuse to create this function`);
    }
  }
});

test("[static] verification 14 sends a COMPLETE patch, so it tests what it claims", () => {
  // The RPC assigns every editable column unconditionally from p_patch, so an
  // omitted key writes NULL. A sparse patch therefore dies on a NOT NULL
  // constraint inside the UPDATE — which runs BEFORE the channel-pair check —
  // and the resulting error looks like a passing test while proving nothing.
  const v14 = MIGRATION.slice(MIGRATION.indexOf("-- 14. An incomplete channel pair"));
  const block = v14.slice(0, v14.indexOf("-- 15."));

  for (const f of [
    "customer_name", "customer_email", "customer_phone", "invoice_reference",
    "job_description", "amount", "due_date", "payment_link",
  ]) {
    assert.match(block, new RegExp(`'${f}'`),
      `verification 14's patch must include ${f} or it fails before the guard`);
  }
  // Exactly one channel is supplied — the single thing under test.
  assert.match(block, /\[\{"channel":"email","subject":"s","body":"b"\}\]/);
  assert.equal(/"channel":"sms"/.test(block), false, "only one channel may be sent");

  // And the expected error is the guard's, not a constraint violation.
  assert.match(block, /requires exactly two channels, got 1/);
  assert.match(block, /NOT a null-value \/ NOT NULL violation/,
    "the misleading failure mode must be called out for whoever runs this");
});

test("[static] 012 is backward-compatible with the currently deployed app", () => {
  // Everything 012 adds must be optional for a client that knows nothing about
  // it: a NULLABLE column, and guards that only refuse genuinely unsafe work.
  assert.match(DDL, /add column if not exists archived_at timestamptz/);
  assert.equal(/archived_at[^;]*not null/i.test(DDL), false,
    "archived_at must be nullable or the old app's INSERTs fail");
  assert.equal(/alter table public\.invoices[^;]*drop column/i.test(DDL), false,
    "012 must not remove anything the old app reads");

  // The one intentional behaviour change is documented as such.
  assert.match(MIGRATION, /ONE INTENTIONAL BEHAVIOUR CHANGE/);
});

// ── Archived invoices are read-only ────────────────────────────────────────

test("[static] the edit RPC refuses an archived invoice before any mutation", () => {
  const fn = DDL.slice(DDL.indexOf("function public.update_invoice_with_refresh"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  // Read under the invoice lock, so an archive committing alongside is seen.
  assert.match(body, /select archived_at into v_archived[\s\S]*?for update;/);
  assert.match(body, /if v_archived is not null then\s*\n\s*return 'invoice_archived';/);

  // Before the reminder lock and before every write.
  const check = body.indexOf("return 'invoice_archived'");
  assert.ok(check < body.indexOf("update public.invoices"), "refuse before writing the invoice");
  assert.ok(check < body.indexOf("perform 1 from public.reminder_logs"), "and before locking reminders");
});

test("a stale tab editing an archived invoice gets a typed refusal, not a write", async () => {
  const db = new FakeDb({ archivedAt: "2026-08-10T00:00:00Z" }, [
    { id: "rem-1", status: "pending", ownerEdited: false },
  ]);
  db.refuseArchivedEdit = true;

  const r = await editInvoice(deps(db), {
    invoiceId: "inv-1", patch: patch({ amount: 1200 }), acceptRefresh: true,
  });

  assert.equal(r.outcome, "invoice_archived");
  assert.match(String(r.body.message), /archived/i);
  assert.deepEqual(db.updated, [], "no invoice write");
  assert.equal(db.invoices.get("inv-1")!.amount, 1500);
  assert.deepEqual(db.regenerated, [], "no channel content rewritten");
});
