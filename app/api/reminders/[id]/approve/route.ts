import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { approveAndSendReminder } from "@/lib/reminder-approval";
import { makeApprovalDeps } from "@/lib/approval-wiring";

/**
 * POST /api/reminders/[id]/approve
 *
 * A THIN ADAPTER. Every decision — status gating, the paid-invoice kill switch,
 * eligibility revalidation, review-token verification, atomic claiming, the
 * per-channel dispatch and the known-vs-ambiguous split — lives in
 * lib/reminder-approval.ts, where executable tests drive it. The Supabase,
 * Resend and Twilio wiring is shared with the channel-retry route through
 * lib/approval-wiring.ts, so the two cannot be given different rules.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  // Untrusted. Verified against a server-minted HMAC inside the service.
  let reviewToken: string | null = null;
  try {
    const body = await request.json();
    reviewToken = typeof body?.review_token === "string" ? body.review_token : null;
  } catch {
    reviewToken = null;
  }

  const result = await approveAndSendReminder(
    makeApprovalDeps(supabase, user.id, user.email ?? null),
    { reminderId: params.id, reviewToken }
  );

  return NextResponse.json(result.body, { status: result.status });
}
