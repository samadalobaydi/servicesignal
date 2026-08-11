import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildReminderEmail } from "@/lib/email-templates";
import { todaysSchedule } from "@/lib/reminder-schedule";
import { sendAndUpdateLog } from "@/lib/reminder-sender";
import { BETA_APPROVAL_ONLY } from "@/lib/beta-capabilities";
import { canEmailCustomer } from "@/lib/daily-reminder-run";
import { getTodayLondonDate } from "@/lib/date-status";
import type { Invoice, Profile } from "@/types";

interface RunSummary {
  invoicesScanned: number;
  remindersCreated: number;
  remindersSent: number;
  remindersSkipped: number;
  errors: string[];
}

/**
 * GET /api/cron/send-reminders
 *
 * Triggered daily by Vercel Cron (see vercel.json).
 * Authenticated via CRON_SECRET — Vercel sends this as a Bearer token.
 *
 * Uses the service-role client (trusted server process, no user session)
 * but explicitly filters every query — never relies on RLS here since
 * RLS is bypassed by service role.
 *
 * For each invoice:
 *  1. Must be unpaid (status != 'paid')
 *  2. Must have a valid customer_email
 *  3. The owning user must have a profile row
 *  4. Today's date must match one of the invoice's chosen reminder_schedules
 *  5. No existing reminder_logs row for (invoice_id, schedule)
 *
 * If all checks pass → insert a 'pending' reminder_logs row.
 * If profile.reminder_mode === 'auto' → also send immediately via Resend
 * and mark the log 'sent' + update invoices.reminders_sent.
 * Default mode is 'approval' — pending rows wait for manual approval
 * in the dashboard.
 */
export async function GET(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    console.error("\x1b[31m✗ CRON_SECRET is not set — cron route disabled.\x1b[0m");
    return NextResponse.json(
      { success: false, message: "Cron not configured." },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized." },
      { status: 401 }
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { success: false, message: "Supabase admin client not configured." },
      { status: 500 }
    );
  }

  const summary: RunSummary = {
    invoicesScanned: 0,
    remindersCreated: 0,
    remindersSent: 0,
    remindersSkipped: 0,
    errors: [],
  };

  // ── 1. Fetch all unpaid invoices ──────────────────────────────────────────
  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("*")
    .neq("status", "paid")
    // Archived invoices are out of the workflow entirely. The BEFORE INSERT
    // guard in migration 012 also refuses a reminder for an archived invoice,
    // which closes the race between this SELECT and the INSERT below.
    .is("archived_at", null);

  if (invoicesError) {
    console.error("✗ Failed to fetch invoices:", invoicesError.message);
    return NextResponse.json(
      { success: false, message: "Failed to fetch invoices." },
      { status: 500 }
    );
  }

  const allInvoices = (invoices ?? []) as Invoice[];
  summary.invoicesScanned = allInvoices.length;

  if (allInvoices.length === 0) {
    return NextResponse.json({ success: true, summary });
  }

  // ── 2. Fetch profiles for all owning users in one query ───────────────────
  const userIds = Array.from(new Set(allInvoices.map((inv) => inv.user_id).filter(Boolean)));

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("*")
    .in("user_id", userIds as string[]);

  if (profilesError) {
    console.error("✗ Failed to fetch profiles:", profilesError.message);
    return NextResponse.json(
      { success: false, message: "Failed to fetch profiles." },
      { status: 500 }
    );
  }

  const profileMap = new Map<string, Profile>(
    (profiles ?? []).map((p) => [p.user_id, p as Profile])
  );

  // ── 3. Fetch user emails for fallback business name ────────────────────────
  // auth.admin.listUsers is paginated; for MVP scale this is acceptable.
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const userEmailMap = new Map<string, string>(
    (usersData?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  // ── 4. Process each invoice ────────────────────────────────────────────────
  //
  // The Europe/London calendar date, explicitly — not `new Date()`.
  //
  // Passing the raw instant worked only by coincidence: daysFromDue()
  // truncates with setUTCHours(0,0,0,0), so "today" became the UTC date, which
  // happens to equal the London date at 08:00 UTC. Move the cron to 23:00 and
  // that silently breaks during BST, because 23:00 UTC is already tomorrow in
  // London. Naming the timezone here removes the coincidence, and matches what
  // the Overview forecast uses to predict this job.
  const today = getTodayLondonDate();

  for (const invoice of allInvoices) {
    if (!invoice.user_id) {
      summary.remindersSkipped++;
      continue;
    }

    // Check 1: valid email. Shared predicate — the Overview's "Coming up"
    // forecast imports the same function, so it can never promise a reminder
    // for an address this job rejects.
    if (!canEmailCustomer(invoice.customer_email)) {
      summary.remindersSkipped++;
      continue;
    }

    // Check 2: profile must exist
    const profile = profileMap.get(invoice.user_id);
    if (!profile) {
      summary.remindersSkipped++;
      continue;
    }

    // Check 3: does today match a chosen schedule for this invoice?
    const schedule = todaysSchedule(invoice.due_date, today);
    if (!schedule) {
      summary.remindersSkipped++;
      continue;
    }
    if (!invoice.reminder_schedules.includes(schedule)) {
      summary.remindersSkipped++;
      continue;
    }

    // Check 4: no existing reminder_log for this invoice + schedule
    const { data: existingLog } = await supabase
      .from("reminder_logs")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("schedule", schedule)
      .maybeSingle();

    if (existingLog) {
      summary.remindersSkipped++;
      continue;
    }

    // ── All checks passed — build the email content ──────────────────────────
    const businessName =
      profile.business_name?.trim() ||
      userEmailMap.get(invoice.user_id) ||
      "ServiceSignal";

    const { subject, html, text } = buildReminderEmail({
      tone: invoice.reminder_tone,
      schedule,
      customerName: invoice.customer_name,
      businessName,
      amount: invoice.amount,
      dueDate: invoice.due_date,
      paymentLink: invoice.payment_link || undefined,
    });

    // Final sending gate. While BETA_APPROVAL_ONLY holds, a stored 'auto'
    // value can never cause a send — the reminder is still prepared and left
    // 'pending' for the owner to approve. This gate is authoritative: it also
    // covers rows written before the flag existed, direct API calls and any
    // future UI regression.
    const storedAutoMode = profile.reminder_mode === "auto";
    const isAutoMode = !BETA_APPROVAL_ONLY && storedAutoMode;

    if (storedAutoMode && !isAutoMode) {
      console.warn(
        `[cron] Profile ${invoice.user_id} is stored as 'auto', but approval-only is enforced for the founding beta. Reminder left pending for approval.`
      );
    }

    // ── Insert the reminder_logs row first (always — detection is automatic) ──
    const { data: insertedLog, error: insertError } = await supabase
      .from("reminder_logs")
      .insert({
        invoice_id: invoice.id,
        user_id: invoice.user_id,
        schedule,
        status: "pending",
        email_to: invoice.customer_email,
        subject,
      })
      .select()
      .single();

    if (insertError) {
      // Unique constraint violation = race condition with another run, safe to skip
      if (insertError.code === "23505") {
        summary.remindersSkipped++;
      } else {
        console.error(`✗ Failed to insert reminder_log for invoice ${invoice.id}:`, insertError.message);
        summary.errors.push(`Insert failed for invoice ${invoice.id}: ${insertError.message}`);
      }
      continue;
    }

    summary.remindersCreated++;

    // ── Auto mode: send immediately ────────────────────────────────────────────
    if (isAutoMode) {
      // THE SECOND SEND PATH, and therefore the second enforcement point.
      //
      // Unreachable today — BETA_APPROVAL_ONLY holds isAutoMode false — but
      // this is exactly the sort of gate that gets forgotten on the day the
      // flag flips, and a cap with a bypass is not a cap. The same atomic
      // function the approval route uses, so the two cannot drift.
      //
      // service_role has no auth.uid(), so the user is named explicitly; the
      // function accepts that only from a trusted server process.
      const { data: claimData, error: claimError } = await supabase.rpc(
        "claim_reminder_allowance",
        // The cap is server-side; see the security note in migration 011.
        {
          p_reminder_log_id: insertedLog.id,
          p_user_id: invoice.user_id,
        }
      );

      const claimRow = Array.isArray(claimData) ? claimData[0] : claimData;

      // Fails closed, like the approval route. The reminder stays 'pending' —
      // prepared, reviewable, and sendable once the customer upgrades.
      if (claimError || !claimRow?.outcome || claimRow.outcome === "exhausted") {
        console.warn(
          `[cron] Reminder ${insertedLog.id} not auto-sent: ` +
            (claimError
              ? `allowance check failed (${claimError.message})`
              : `founding beta allowance ${claimRow?.outcome ?? "unavailable"}`) +
            ". Left pending."
        );
        summary.remindersSkipped++;
        continue;
      }

      const sent = await sendAndUpdateLog({
        supabase,
        logId: insertedLog.id,
        to: invoice.customer_email,
        replyTo: userEmailMap.get(invoice.user_id) || undefined,
        subject,
        html,
        text,
        invoiceId: invoice.id,
        schedule,
      });

      if (sent) {
        summary.remindersSent++;
      } else {
        summary.errors.push(`Send failed for invoice ${invoice.id} (${schedule})`);
      }
    }
    // Approval mode: leave as 'pending' — dashboard ReminderQueue handles the rest
  }

  return NextResponse.json({ success: true, summary });
}
