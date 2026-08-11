import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getVerifiedContext } from "@/lib/onboarding";
import { coerceInvoiceForm, createInvoiceForUser } from "@/lib/invoice-write";

/**
 * POST /api/onboarding/invoices — the first invoice, created during setup.
 *
 * WHY A DEDICATED ROUTE, AND WHY THE GENERAL ONE WAS REMOVED
 *
 * Onboarding needs two guarantees the dashboard must NOT have: the caller's
 * email must be confirmed, and the schedule must produce a reminder that can
 * be prepared today. The second cannot be a parameter on a shared endpoint,
 * because a parameter is supplied by the client and the client that wants to
 * skip the check simply omits it. Policy has to be fixed by which URL was
 * called.
 *
 * A previous revision of this work added a general POST /api/invoices that
 * required verification but not eligibility. Keeping it alongside this route
 * would have defeated the point entirely: anyone could post the same body one
 * path over and bypass eligibility completely. It has been deleted rather than
 * left as an unused convenience — an endpoint nobody calls is still an
 * endpoint anybody can call.
 *
 * The dashboard's existing browser-side insert is untouched and continues to
 * accept legitimate future-dated invoices.
 */
export async function POST(request: Request) {
  const context = await getVerifiedContext();

  // Covers no session AND session-without-confirmed-email. One message for
  // both, so the response cannot be used to distinguish the two states.
  if (!context) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const form = coerceInvoiceForm((body ?? {}) as Record<string, never>);
  const supabase = getSupabaseServer();

  // Eligibility is enabled HERE, in server code, on a route whose only purpose
  // is onboarding. The browser runs the same rule for the error message; this
  // is what makes it true.
  const result = await createInvoiceForUser(supabase, form, {
    requireReminderEligibility: true,
    requireOnboardingFields: true,
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      return NextResponse.json(
        { success: false, message: "Please check the invoice details.", errors: result.errors },
        { status: 400 }
      );
    }
    console.error(
      `[api/onboarding/invoices] Insert failed for user ${context.user.id}: ${result.message}`
    );
    return NextResponse.json(
      { success: false, message: "We couldn't save that invoice. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, invoiceId: result.invoice.id, invoice: result.invoice });
}
