import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { archiveInvoiceLifecycle } from "@/lib/invoice-lifecycle-service";
import { makeLifecycleDb } from "@/lib/invoice-lifecycle-db";

/**
 * POST /api/invoices/[id]/archive
 *
 * Archive, not delete. The invoice row, every reminder_logs row, all channel
 * content and every allowance slot survive untouched — archiving removes an
 * invoice from the workflow, it does not erase what happened.
 *
 * Idempotent: archiving an already-archived invoice succeeds.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const result = await archiveInvoiceLifecycle(
    { db: makeLifecycleDb(supabase, getSupabaseAdmin()), userId: user.id },
    params.id
  );
  return NextResponse.json(result.body, { status: result.status });
}
