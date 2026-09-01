import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeLifecycleDb } from "@/lib/invoice-lifecycle-db";
import { deleteInvoiceLifecycle } from "@/lib/invoice-lifecycle-service";

/**
 * PROVES WHICH CLIENT deleteInvoice ACTUALLY USES.
 *
 * tests/invoice-lifecycle.test.ts exercises deleteInvoiceLifecycle exclusively
 * against a hand-written FakeDb implementing LifecycleDb — it has never
 * exercised lib/invoice-lifecycle-db.ts's real makeLifecycleDb() at all, so it
 * could not have caught (and does not now duplicate-test in a way that would
 * mask) which underlying Supabase client the real DELETE statement is issued
 * through. These tests drive makeLifecycleDb() itself, with two DISTINCT
 * client doubles (one standing in for the user-session client, one for the
 * service-role client), so "which client received the DELETE" is a directly
 * observable fact, not an inference from the production adapter's source.
 */

interface FakeCall {
  label: "session" | "admin";
  table: string;
  op: "select" | "delete";
  filters: Record<string, unknown>;
}

interface FakeInvoiceRow {
  id: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  invoice_reference: string | null;
  job_description: string | null;
  amount: number;
  due_date: string;
  payment_link: string;
  archived_at: string | null;
}

interface FakeReminderRow {
  id: string;
  invoice_id: string;
  user_id: string;
  status: string;
}

/**
 * A minimal, purpose-built double of exactly the Supabase query shapes
 * lib/invoice-lifecycle-db.ts issues against `invoices` and `reminder_logs` —
 * not a general-purpose mock. `label` identifies WHICH client (session vs
 * admin) this instance represents, recorded on every call so a test can
 * assert which one actually received the delete.
 */
function makeFakeSupabase(
  label: "session" | "admin",
  calls: FakeCall[],
  invoices: FakeInvoiceRow[],
  reminders: FakeReminderRow[],
  deleteErrorCode?: string
): SupabaseClient {
  return {
    from(table: string) {
      if (table === "invoices") {
        return {
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              maybeSingle() {
                calls.push({ label, table, op: "select", filters: { ...filters } });
                const row = invoices.find((r) =>
                  Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
                );
                return Promise.resolve({ data: row ?? null, error: null });
              },
            };
            return builder;
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const chain: {
              eq: (col: string, val: unknown) => typeof chain;
              then: (resolve: (v: { error: { code: string } | null }) => void) => void;
            } = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return chain;
              },
              then(resolve) {
                calls.push({ label, table, op: "delete", filters: { ...filters } });
                resolve({ error: deleteErrorCode ? { code: deleteErrorCode } : null });
              },
            };
            return chain;
          },
        };
      }
      if (table === "reminder_logs") {
        return {
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const builder: {
              eq: (col: string, val: unknown) => typeof builder;
              then: (resolve: (v: { data: unknown[]; error: null }) => void) => void;
            } = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              then(resolve) {
                calls.push({ label, table, op: "select", filters: { ...filters } });
                const rows = reminders.filter((r) =>
                  Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
                );
                resolve({ data: rows, error: null });
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table in fake: ${table}`);
    },
  } as unknown as SupabaseClient;
}

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const INVOICE_ID = "inv-1";

function baseInvoice(overrides: Partial<FakeInvoiceRow> = {}): FakeInvoiceRow {
  return {
    id: INVOICE_ID,
    user_id: OWNER,
    customer_name: "Dave Wilson",
    customer_email: "dave@example.com",
    customer_phone: "07700900000",
    invoice_reference: null,
    job_description: null,
    amount: 100,
    due_date: "2026-01-01",
    payment_link: "",
    archived_at: null,
    ...overrides,
  };
}

// ── A. Owner delete succeeds through the admin-backed path ─────────────────

test("A. owner delete succeeds via db.deleteInvoice(), issued through the ADMIN client only", async () => {
  const calls: FakeCall[] = [];
  const session = makeFakeSupabase("session", calls, [baseInvoice()], []);
  const admin = makeFakeSupabase("admin", calls, [baseInvoice()], []);
  const db = makeLifecycleDb(session, admin);

  const result = await db.deleteInvoice(INVOICE_ID, OWNER);

  assert.equal(result.ok, true);
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assert.equal(deleteCalls.length, 1, "exactly one delete call");
  assert.equal(deleteCalls[0].label, "admin", "the delete must be issued through the admin client");
  assert.deepEqual(deleteCalls[0].filters, { id: INVOICE_ID, user_id: OWNER }, "scoped by BOTH invoice id and user id");
});

test("A2. owner delete succeeds end-to-end through deleteInvoiceLifecycle()", async () => {
  const calls: FakeCall[] = [];
  const session = makeFakeSupabase("session", calls, [baseInvoice()], []);
  const admin = makeFakeSupabase("admin", calls, [baseInvoice()], []);
  const db = makeLifecycleDb(session, admin);

  const result = await deleteInvoiceLifecycle({ db, userId: OWNER }, INVOICE_ID);

  assert.equal(result.status, 200);
  assert.equal(result.outcome, "deleted");
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].label, "admin");
});

// ── B. Wrong owner cannot delete ────────────────────────────────────────────

test("B. a non-owner's delete attempt is refused (not_found) and never reaches a delete call at all", async () => {
  const calls: FakeCall[] = [];
  // The invoice belongs to OWNER; OTHER_USER attempts to delete it.
  const session = makeFakeSupabase("session", calls, [baseInvoice()], []);
  const admin = makeFakeSupabase("admin", calls, [baseInvoice()], []);
  const db = makeLifecycleDb(session, admin);

  const result = await deleteInvoiceLifecycle({ db, userId: OTHER_USER }, INVOICE_ID);

  // loadInvoice's own .eq("user_id", userId) scoping means the wrong owner's
  // read matches nothing — the SAME ownership pattern RLS or a service-role
  // predicate enforces — so the lifecycle never proceeds to a delete at all.
  assert.equal(result.status, 404);
  assert.equal(result.outcome, "not_found");
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assert.equal(deleteCalls.length, 0, "no delete of any kind was attempted for a mismatched owner");
});

// ── C. Missing admin dependency fails closed ────────────────────────────────

test("C. admin unavailable: db.deleteInvoice() refuses outright, zero delete calls on either client", async () => {
  const calls: FakeCall[] = [];
  const session = makeFakeSupabase("session", calls, [baseInvoice()], []);
  const db = makeLifecycleDb(session, null); // no admin client configured

  const result = await db.deleteInvoice(INVOICE_ID, OWNER);

  assert.equal(result.ok, false);
  assert.equal(result.refusedByDatabase, undefined, "not a lifecycle-trigger refusal — an infrastructure one");
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assert.equal(deleteCalls.length, 0, "no delete was attempted through the session client as a fallback");
});

test("C2. admin unavailable, end-to-end: deleteInvoiceLifecycle() surfaces a database_unavailable 503, not a false success", async () => {
  const calls: FakeCall[] = [];
  const session = makeFakeSupabase("session", calls, [baseInvoice()], []);
  const db = makeLifecycleDb(session, null);

  const result = await deleteInvoiceLifecycle({ db, userId: OWNER }, INVOICE_ID);

  assert.equal(result.status, 503);
  assert.equal(result.outcome, "database_unavailable");
  assert.equal(result.body.success, false);
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assert.equal(deleteCalls.length, 0);
});

// ── D. No session-client DELETE is used by deleteInvoice ────────────────────

test("D. across every scenario above, the session client never receives a delete call", async () => {
  const calls: FakeCall[] = [];
  const invoice = baseInvoice();
  const session = makeFakeSupabase("session", calls, [invoice], []);
  const admin = makeFakeSupabase("admin", calls, [invoice], []);
  const db = makeLifecycleDb(session, admin);

  await db.deleteInvoice(INVOICE_ID, OWNER);
  await db.deleteInvoice(INVOICE_ID, OTHER_USER); // wrong owner, direct call
  const dbNoAdmin = makeLifecycleDb(session, null);
  await dbNoAdmin.deleteInvoice(INVOICE_ID, OWNER);

  const sessionDeletes = calls.filter((c) => c.op === "delete" && c.label === "session");
  assert.equal(sessionDeletes.length, 0, "the session client must never be asked to delete an invoice, under any of these calls");
});

test("D2. [static] lib/invoice-lifecycle-db.ts's deleteInvoice contains no session-client delete call", () => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const src = readFileSync(join(ROOT, "lib/invoice-lifecycle-db.ts"), "utf8");
  const fnStart = src.indexOf("async deleteInvoice(id, userId) {");
  assert.ok(fnStart > -1, "deleteInvoice must exist with this exact signature");
  const fnEnd = src.indexOf("\n    },", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);

  assert.doesNotMatch(
    fnBody,
    /supabase\.from\("invoices"\)\.delete\(/,
    "deleteInvoice must never call .delete() on the session client, even as a fallback"
  );
  assert.match(
    fnBody,
    /admin\.from\("invoices"\)\.delete\(/,
    "deleteInvoice must issue its delete through the admin (service-role) client"
  );
  assert.match(fnBody, /if \(!admin\)/, "must explicitly guard against a missing admin client");
});

// ── E. Existing lifecycle protections still pass ────────────────────────────
// Deliberately NOT duplicated here — tests/invoice-lifecycle.test.ts's own
// FakeDb-based suite (in-flight refusal, delete_not_allowed / useArchive,
// idempotent re-delete, ownership via loadInvoice) is untouched by this fix
// (lib/invoice-lifecycle-service.ts was not modified) and its continued
// pass/fail is confirmed by the full `npm test` run, not re-asserted here.
