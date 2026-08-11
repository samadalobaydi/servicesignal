import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getVerifiedContext, statusOf } from "@/lib/onboarding";
import { prepareEligibility } from "@/lib/reminder-schedule";
import type { Invoice } from "@/types";

/**
 * GET /api/onboarding/resume — where is this user up to in onboarding?
 *
 * WHY THIS WAS REWRITTEN (Note 44)
 *
 * The previous version answered a narrower question: "which invoice still
 * needs a reminder prepared?" It deliberately EXCLUDED any invoice that
 * already had a `pending` or `sent` reminder, because it existed only to
 * recover the retry case — invoice saved, preparation failed.
 *
 * That exclusion was the bug. A user who reached Step 2 successfully has an
 * invoice AND a pending reminder, so their invoice was filtered out, the
 * endpoint returned `invoiceId: null`, and the flow fell through to a blank
 * Step 1. The onboarding STATUS persisted correctly all along; the sub-step
 * did not, because it only ever lived in React state that navigation discards.
 *
 * This now reports a STATE, so every sub-step can be restored from the server:
 *
 *   fresh              — nothing to resume. Show Step 1.
 *   needs_preparation  — invoice exists, no live reminder. Show the retry state.
 *   review             — invoice + PENDING reminder. Restore Step 2 and load the
 *                        preview from the canonical composition path.
 *
 * Idempotent and read-only: it creates nothing, prepares nothing, and can be
 * called repeatedly. Every query runs under the caller's own session, so RLS
 * makes another user's invoice and reminder unreachable.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export type ResumeState = "fresh" | "needs_preparation" | "review";

export async function GET() {
  const context = await getVerifiedContext();
  if (!context) {
    return NextResponse.json(
      { success: false, message: "Not authenticated." },
      { status: 401, headers: NO_STORE }
    );
  }

  // Only mid-setup accounts resume. Somebody `completed` or `exempt` has no
  // partial attempt to pick up, and offering them one would drag an unrelated
  // invoice into a flow they have finished with.
  const status = statusOf(context);
  if (status !== "required" && status !== "skipped") {
    return NextResponse.json(
      { success: true, state: "fresh" as ResumeState },
      { headers: NO_STORE }
    );
  }

  const supabase = getSupabaseServer();

  // Newest unpaid invoices first. RLS scopes this to the caller.
  const { data: invoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("status", "unpaid")
    .order("created_at", { ascending: false });

  if (invoiceError || !invoices || invoices.length === 0) {
    return NextResponse.json(
      { success: true, state: "fresh" as ResumeState },
      { headers: NO_STORE }
    );
  }

  const candidates = invoices as Invoice[];

  // Live reminders for those invoices. `dismissed` and `failed` are NOT live:
  // an invoice whose only reminder was thrown away or never got out still
  // needs a usable one, so it counts as needing preparation.
  const { data: reminders } = await supabase
    .from("reminder_logs")
    .select("id, invoice_id, status, created_at")
    .in(
      "invoice_id",
      candidates.map((i) => i.id)
    )
    .in("status", ["pending", "sent"])
    .order("created_at", { ascending: false });

  const liveByInvoice = new Map<string, { id: string; status: string }>();
  for (const r of (reminders ?? []) as {
    id: string;
    invoice_id: string;
    status: string;
  }[]) {
    // Ordered newest first, so the first seen per invoice is the current one.
    if (!liveByInvoice.has(r.invoice_id)) {
      liveByInvoice.set(r.invoice_id, { id: r.id, status: r.status });
    }
  }

  // ── review ────────────────────────────────────────────────────────────
  // The successful Step 2 case the old version could not see. A PENDING
  // reminder means the user reached the preview and nothing has been sent, so
  // that is exactly where they should land again.
  const inReview = candidates.find(
    (invoice) => liveByInvoice.get(invoice.id)?.status === "pending"
  );

  if (inReview) {
    return NextResponse.json(
      {
        success: true,
        state: "review" as ResumeState,
        invoiceId: inReview.id,
        reminderId: liveByInvoice.get(inReview.id)!.id,
      },
      { headers: NO_STORE }
    );
  }

  // ── needs_preparation ─────────────────────────────────────────────────
  // An invoice with no live reminder, which must ALSO still be eligible —
  // otherwise "try preparing again" would be an invitation to fail.
  const needsPreparation = candidates.find(
    (invoice) =>
      !liveByInvoice.has(invoice.id) &&
      !!prepareEligibility(
        invoice.reminder_schedules ?? [],
        invoice.reminders_sent ?? [],
        invoice.due_date
      ).schedule
  );

  if (needsPreparation) {
    return NextResponse.json(
      {
        success: true,
        state: "needs_preparation" as ResumeState,
        invoiceId: needsPreparation.id,
      },
      { headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { success: true, state: "fresh" as ResumeState },
    { headers: NO_STORE }
  );
}
