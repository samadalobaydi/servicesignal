import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

/**
 * POST /api/reminders/[id]/dismiss
 *
 * Marks a pending reminder as 'dismissed' without sending it.
 *
 * Security: uses the authenticated user's session client (anon key + cookies).
 * RLS policy update_own_reminder_logs (auth.uid() = user_id) means this
 * update silently affects 0 rows if the reminder isn't owned by the caller —
 * we check the row count afterwards to return an accurate response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  // Confirm the reminder exists and is pending (RLS returns null if not owned)
  const { data: log, error: fetchError } = await supabase
    .from("reminder_logs")
    .select("id, status")
    .eq("id", params.id)
    .single();

  if (fetchError || !log) {
    return NextResponse.json({ success: false, message: "Reminder not found." }, { status: 404 });
  }

  if (log.status !== "pending") {
    return NextResponse.json(
      { success: false, message: `Reminder is already ${log.status}.` },
      { status: 409 }
    );
  }

  const { error: updateError } = await supabase
    .from("reminder_logs")
    .update({ status: "dismissed" })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json(
      { success: false, message: "Failed to dismiss reminder." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "Reminder dismissed." });
}
