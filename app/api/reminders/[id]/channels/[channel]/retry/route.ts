import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { retryReminderChannel } from "@/lib/reminder-approval";
import { makeApprovalDeps } from "@/lib/approval-wiring";
import type { ReminderChannel } from "@/lib/reminder-content";

/**
 * POST /api/reminders/[id]/channels/[channel]/retry
 *
 * Recovery for a PARTIALLY sent reminder: resends the one channel that did not
 * get through, and only that one.
 *
 * ── WHY A SEPARATE ROUTE FROM /approve ───────────────────────────────────
 *
 * After a partial send the parent reminder is `sent`, which is deliberately not
 * claimable — that is precisely what stops /approve from resending the channel
 * that already worked. Making the parent claimable again to enable recovery
 * would reopen the duplicate-send hole the status model exists to close, and
 * migration 011's reminder_logs_dispatched_final trigger would refuse the
 * transition regardless.
 *
 * So this route never touches reminder_logs. It operates on the child row in
 * reminder_channel_messages, whose lifecycle columns migration 010 already
 * provides.
 *
 * ── NO REVIEW TOKEN, AND WHY THAT IS NOT A WEAKENING ─────────────────────
 *
 * /approve requires a signed review token because it is the moment an owner
 * authorises content they have read. This route composes nothing new: it
 * resends the SAME stored body to the SAME recipient for a message that was
 * already approved and already partially delivered. The content hash is
 * unchanged by construction.
 *
 * What it does still enforce, in the service: ownership (through the caller's
 * own session and RLS), the paid-invoice kill switch, the per-channel atomic
 * claim, and channelRetryable() — which admits ONLY a channel that failed
 * beside one that succeeded. Both-failed goes back through /approve, and an
 * unresolved channel is never retryable at all.
 *
 * NO ALLOWANCE IS CLAIMED. One logical reminder is one unit, and it was
 * consumed when the first channel was accepted.
 */

const CHANNELS: readonly string[] = ["email", "sms"];

export async function POST(
  _request: Request,
  { params }: { params: { id: string; channel: string } }
) {
  const supabase = getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  // The channel comes from the URL, so it is untrusted. An unknown value is
  // refused rather than defaulted — defaulting would let a typo silently
  // resend the wrong channel.
  if (!CHANNELS.includes(params.channel)) {
    return NextResponse.json(
      { success: false, message: "Unknown reminder channel." },
      { status: 400 }
    );
  }

  const result = await retryReminderChannel(
    makeApprovalDeps(supabase, user.id, user.email ?? null),
    { reminderId: params.id, channel: params.channel as ReminderChannel }
  );

  return NextResponse.json(result.body, { status: result.status });
}
