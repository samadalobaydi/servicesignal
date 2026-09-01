import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { regenerateReminder } from "@/lib/reminder-regenerate";
import { makeRegenerateDeps } from "@/lib/regenerate-wiring";
import { isRegenerateEnabled } from "@/lib/regenerate-capability";

/**
 * POST /api/reminders/[id]/regenerate
 *
 * A THIN ADAPTER. Every decision lives in lib/reminder-regenerate.ts, where
 * it is exercised by executable tests. This route only gates, authenticates,
 * and wires Supabase into that port.
 *
 * Recovery path for migration 015's fail-closed identity-drift gate: rebuilds
 * a PENDING or FAILED reminder's stored SMS+email from the CURRENT invoice
 * and sender identity when they can no longer be proven to agree with what
 * is stored. SENDS NOTHING — no Resend/Twilio client is reachable from this
 * path at all.
 *
 * THE FEATURE GATE IS FIRST, BEFORE AUTHENTICATION. See
 * lib/regenerate-capability.ts for why this exists and the intended
 * deployment sequence. Disabled is the default; while disabled, nothing
 * below this check — not the session lookup, not regenerateReminder(), not
 * the RPC — is ever reached. This is the authoritative gate; hiding the
 * button in the UI (lib/reminder-review.ts's regenerateEnabled field) is a
 * courtesy on top of this, never a substitute for it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isRegenerateEnabled()) {
    return NextResponse.json(
      { success: false, state: "feature_disabled", message: "Regenerating reminders isn't available yet." },
      { status: 503 }
    );
  }

  const supabase = getSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const result = await regenerateReminder(makeRegenerateDeps(supabase, user.id), {
    reminderId: params.id,
  });

  return NextResponse.json(result.body, { status: result.status });
}
