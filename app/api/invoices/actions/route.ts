import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  markInvoicePaidForOwner, setEscalationForOwner, dismissPendingForOwner,
} from "@/lib/invoice-owner-writes";
import { escalationStatusForAction } from "@/lib/escalation";
import type { InvoiceActionType } from "@/types";

const VALID_ACTIONS: InvoiceActionType[] = [
  "call_logged",
  "promised_to_pay",
  "disputed",
  "paused",
  "final_notice",
  "written_off",
  "marked_paid",
];

/**
 * POST /api/invoices/actions
 * Body: { invoice_id: string, action_type: InvoiceActionType, note?: string }
 *
 * Records an action in invoice_actions (immutable history) and, where the
 * action implies a state change, updates invoices.escalation_status or
 * marks the invoice paid.
 *
 * SECURITY: uses the authenticated user's session (anon key + cookies).
 * RLS on invoice_actions (which also verifies the invoice belongs to the
 * user via EXISTS) and on invoices enforces ownership at the database level.
 * user_id is taken from the session, never from the request body.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: { invoice_id?: string; action_type?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  if (!body.invoice_id) {
    return NextResponse.json({ success: false, message: "Missing invoice_id." }, { status: 400 });
  }
  if (!body.action_type || !VALID_ACTIONS.includes(body.action_type as InvoiceActionType)) {
    return NextResponse.json({ success: false, message: "Invalid action_type." }, { status: 400 });
  }

  const actionType = body.action_type as InvoiceActionType;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  // Verify the invoice exists and is owned by this user (RLS returns null otherwise)
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", body.invoice_id)
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json({ success: false, message: "Invoice not found." }, { status: 404 });
  }

  // 1. Insert the action history row. user_id from session; RLS WITH CHECK
  //    also confirms the invoice belongs to the user.
  const { error: actionError } = await supabase
    .from("invoice_actions")
    .insert({
      user_id: user.id,
      invoice_id: body.invoice_id,
      action_type: actionType,
      note,
    });

  if (actionError) {
    return NextResponse.json(
      { success: false, message: "Failed to record action." },
      { status: 500 }
    );
  }

  // 2. Apply any state change implied by the action.
  //
  // These invoice writes go through the SERVICE-ROLE client, because migration
  // 012 revokes UPDATE on invoices from `authenticated`. service_role bypasses
  // RLS, so the ownership guarantee RLS used to provide is replaced by an
  // explicit `.eq("user_id", user.id)` inside every helper — with user.id taken
  // from the session verified above, never from the request body.
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { success: true, message: "Action recorded, but the status change failed.", partial: true },
      { status: 200 }
    );
  }

  if (actionType === "marked_paid") {
    const paid = await markInvoicePaidForOwner(
      admin, body.invoice_id, user.id, new Date().toISOString()
    );

    if (!paid.ok || !paid.matched) {
      return NextResponse.json(
        { success: true, message: "Action recorded, but marking paid failed.", partial: true },
        { status: 200 }
      );
    }

    // Kill switch: dismiss any reminders still awaiting approval for this
    // invoice so future chasing stops. Historical sent logs are untouched.
    await dismissPendingForOwner(admin, body.invoice_id, user.id);
  } else {
    const newEscalation = escalationStatusForAction(actionType);
    if (newEscalation) {
      const esc = await setEscalationForOwner(admin, body.invoice_id, user.id, newEscalation);

      if (!esc.ok || !esc.matched) {
        return NextResponse.json(
          { success: true, message: "Action recorded, but status update failed.", partial: true },
          { status: 200 }
        );
      }
    }
  }

  return NextResponse.json({ success: true, message: "Action recorded." });
}

/**
 * GET /api/invoices/actions?invoice_id=...
 *
 * Returns the action history for a single invoice, newest first.
 * RLS ensures only the owner's actions are returned.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const invoiceId = request.nextUrl.searchParams.get("invoice_id");
  if (!invoiceId) {
    return NextResponse.json({ success: false, message: "Missing invoice_id." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("invoice_actions")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, message: "Failed to load actions." }, { status: 500 });
  }

  return NextResponse.json({ success: true, actions: data ?? [] });
}
