import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import type { ProfileUpdate, ReminderTone, ReminderMode } from "@/types";

const VALID_TONES: ReminderTone[] = ["friendly", "firm", "final"];
const VALID_MODES: ReminderMode[] = ["approval", "auto"];

/**
 * GET /api/profile
 *
 * Returns the current user's profile row, creating it with defaults
 * if it doesn't exist yet (first dashboard load after signup).
 *
 * user_id is taken exclusively from the authenticated session —
 * never accepted from the client.
 */
export async function GET() {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  const { data: existing, error: fetchError } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ success: false, message: "Failed to load profile." }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ success: true, profile: existing });
  }

  // First load — create a default profile row.
  // user_id DEFAULT auth.uid() on the table — we don't pass it explicitly,
  // but RLS insert_own_profile policy requires auth.uid() = user_id regardless.
  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert({})
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ success: false, message: "Failed to create profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true, profile: created });
}

/**
 * PUT /api/profile
 *
 * Updates business_name, contact_email, contact_phone, default_tone,
 * and/or reminder_mode for the current user.
 *
 * user_id is never read from the request body — RLS update_own_profile
 * (auth.uid() = user_id) ensures the update only ever affects the
 * caller's own row, regardless of what's in the body.
 */
export async function PUT(request: NextRequest) {
  const supabase = getSupabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Not authenticated." }, { status: 401 });
  }

  let body: Partial<ProfileUpdate>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  const update: ProfileUpdate = {};

  if (typeof body.business_name === "string") {
    update.business_name = body.business_name.trim().slice(0, 100);
  }
  if (typeof body.contact_email === "string") {
    update.contact_email = body.contact_email.trim().slice(0, 200);
  }
  if (typeof body.contact_phone === "string") {
    update.contact_phone = body.contact_phone.trim().slice(0, 50);
  }
  if (body.default_tone && VALID_TONES.includes(body.default_tone)) {
    update.default_tone = body.default_tone;
  }
  if (body.reminder_mode && VALID_MODES.includes(body.reminder_mode)) {
    update.reminder_mode = body.reminder_mode;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, message: "No valid fields to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("user_id", user.id) // belt-and-braces — RLS already enforces this
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, message: "Failed to update profile." }, { status: 500 });
  }

  return NextResponse.json({ success: true, profile: data });
}
