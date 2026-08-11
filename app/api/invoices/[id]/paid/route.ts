import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { markInvoicePaidForOwner, dismissPendingForOwner } from "@/lib/invoice-owner-writes";

/**
 * POST /api/invoices/[id]/paid
 *
 * Mark Paid. This used to be a direct browser
 * `supabase.from("invoices").update({ status: "paid" })`, which only worked
 * because `authenticated` held table UPDATE. Migration 012 revokes that, so
 * the transition moves here.
 *
 * The UX is unchanged: same button, same optimistic update, same notice.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { success: false, state: "database_unavailable", message: "We couldn't update this invoice. Please try again." },
      { status: 503 }
    );
  }

  // userId comes from the verified session, never the request.
  const result = await markInvoicePaidForOwner(admin, params.id, user.id, new Date().toISOString());

  if (!result.ok) {
    return NextResponse.json(
      { success: false, state: "database_unavailable", message: "We couldn't update this invoice. Please try again." },
      { status: 503 }
    );
  }
  // Not yours, or gone. Same answer either way — this cannot confirm that
  // someone else's invoice exists.
  if (!result.matched) {
    return NextResponse.json({ success: false, state: "not_found", message: "Invoice not found." }, { status: 404 });
  }

  // Kill switch: unsent drafts leave the queue and can never be sent.
  // Non-fatal — the invoice IS paid, and the queue filters paid invoices.
  await dismissPendingForOwner(admin, params.id, user.id);

  return NextResponse.json({ success: true, state: "paid", message: "Invoice marked paid." });
}
