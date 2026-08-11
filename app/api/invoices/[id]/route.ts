import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { editInvoice, deleteInvoiceLifecycle } from "@/lib/invoice-lifecycle-service";
import { makeLifecycleDb } from "@/lib/invoice-lifecycle-db";
import { coerceInvoiceForm } from "@/lib/invoice-write";
import { validateInvoiceForm, normaliseInvoiceForm } from "@/lib/invoice-form";
import { parseAmount } from "@/lib/invoice-input";

/**
 * PATCH  /api/invoices/[id]   edit
 * DELETE /api/invoices/[id]   hard delete, when the lifecycle permits it
 *
 * Thin adapters. Every rule lives in lib/invoice-lifecycle-service.ts.
 *
 * Ownership is proven three ways, none of which trust the client: the session
 * is read server-side, every query is scoped to that user id explicitly, and
 * RLS independently scopes the same rows. An id from the request body is never
 * used for anything but lookup.
 */

async function requireUser(supabase: SupabaseClient) {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  // Validated with the SAME module the browser used, so the two cannot drift.
  const form = coerceInvoiceForm(body as never);
  const errors = validateInvoiceForm(form);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { success: false, state: "invalid", message: "Please check the highlighted fields.", errors },
      { status: 400 }
    );
  }

  const clean = normaliseInvoiceForm(form);
  const result = await editInvoice(
    { db: makeLifecycleDb(supabase, getSupabaseAdmin()), userId: user.id, log: (m) => console.error(m) },
    {
      invoiceId: params.id,
      acceptRefresh: body.accept_refresh === true,
      patch: {
        customer_name: clean.customer_name,
        customer_email: clean.customer_email,
        customer_phone: clean.customer_phone,
        invoice_reference: clean.invoice_reference || null,
        job_description: clean.job_description || null,
        amount: parseAmount(clean.amount) as number,
        due_date: clean.due_date,
        payment_link: clean.payment_link,
      },
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServer();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const result = await deleteInvoiceLifecycle(
    { db: makeLifecycleDb(supabase, getSupabaseAdmin()), userId: user.id },
    params.id
  );
  return NextResponse.json(result.body, { status: result.status });
}
