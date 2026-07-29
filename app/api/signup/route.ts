import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import type { BetaSignupFormData, ApiResponse } from "@/types";
import {
  ALLOWED_BUSINESS_TYPES,
  ALLOWED_UNPAID_RANGES,
  type SignupSource,
} from "@/lib/beta-options";

/** Field-level errors returned to the client alongside the message. */
type FieldErrors = Partial<Record<keyof BetaSignupFormData, string>>;

// ── Validation ─────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(
  body: Partial<BetaSignupFormData>,
  source: SignupSource
): FieldErrors | null {
  const e: FieldErrors = {};

  if (!body.name?.trim()) e.name = "Name is required.";
  else if (body.name.trim().length < 2) e.name = "Name must be at least 2 characters.";

  if (!body.business_name?.trim()) e.business_name = "Business name is required.";

  if (!body.email?.trim()) e.email = "Email address is required.";
  else if (!EMAIL_RE.test(body.email)) e.email = "Please enter a valid email address.";

  // The v2 form requires both selects. v1 has always allowed them to be empty,
  // so requiring them globally would reject valid v1 submissions.
  const type = body.business_type?.trim() ?? "";
  const range = body.unpaid_range?.trim() ?? "";

  if (source === "v2" && !type) e.business_type = "Please choose your business type.";
  if (source === "v2" && !range) e.unpaid_range = "Please choose an approximate amount.";

  // Whenever a value IS supplied it must be one we recognise — this blocks
  // manipulated requests writing arbitrary strings, for both forms.
  if (type && !ALLOWED_BUSINESS_TYPES.includes(type)) {
    e.business_type = "Please choose a valid business type.";
  }
  if (range && !ALLOWED_UNPAID_RANGES.includes(range)) {
    e.unpaid_range = "Please choose a valid amount.";
  }

  return Object.keys(e).length ? e : null;
}

// ── Terminal logger ────────────────────────────────────────────────────────
function logSignup(data: BetaSignupFormData, dest: "console" | "supabase") {
  const div = "═".repeat(52);
  const line = "─".repeat(52);
  console.log(`\n\x1b[36m${div}\x1b[0m`);
  console.log(`\x1b[36m  ✦ SERVICESIGNAL — BETA SIGNUP\x1b[0m`);
  console.log(`\x1b[36m${div}\x1b[0m`);
  console.log(`  \x1b[33mSaved to:\x1b[0m  ${dest === "supabase" ? "\x1b[32m✓ Supabase\x1b[0m" : "\x1b[33m⚠ Console only (add env vars to persist)\x1b[0m"}`);
  console.log(`  \x1b[33mTime:\x1b[0m      ${new Date().toLocaleString("en-GB", { timeZone: "Europe/London" })}`);
  console.log(`\x1b[36m${line}\x1b[0m`);
  console.log(`  \x1b[37mName:\x1b[0m              ${data.name}`);
  console.log(`  \x1b[37mBusiness:\x1b[0m          ${data.business_name}`);
  console.log(`  \x1b[37mEmail:\x1b[0m             ${data.email}`);
  console.log(`  \x1b[37mPhone:\x1b[0m             ${data.phone || "—"}`);
  console.log(`  \x1b[37mBusiness type:\x1b[0m     ${data.business_type || "—"}`);
  console.log(`  \x1b[37mUnpaid range:\x1b[0m      ${data.unpaid_range || "—"}`);
  console.log(`  \x1b[37mWilling to pay:\x1b[0m    ${data.willingness_to_pay || "—"}`);
  console.log(`\x1b[36m${div}\x1b[0m\n`);
}

// ── POST /api/signup ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: Partial<BetaSignupFormData>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse>(
      { success: false, message: "Invalid request body." },
      { status: 400 }
    );
  }

  // Server-side validation (mirrors client — never trust the client alone)
  const source: SignupSource =
    (body as { source?: string }).source === "v2" ? "v2" : "v1";

  const fieldErrors = validate(body, source);
  if (fieldErrors) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        message: Object.values(fieldErrors)[0] ?? "Please check the form and try again.",
        fieldErrors,
      },
      { status: 400 }
    );
  }

  // Safe cast — validation passed so required fields are present
  const data = body as BetaSignupFormData;

  const supabase = getServerSupabase();

  if (!supabase) {
    // Supabase is not configured. The record CANNOT be saved, so we must not
    // report success — doing so would silently lose the lead while telling the
    // visitor they were registered. Fail honestly instead.
    console.error(
      "\x1b[31m\u2717 Beta signup rejected: Supabase is not configured (missing URL and/or key).\x1b[0m"
    );
    return NextResponse.json<ApiResponse>(
      { success: false, message: "We couldn't submit your details. Please try again." },
      { status: 503 }
    );
  }

  const { error } = await supabase.from("beta_signups").insert({
    name:                data.name.trim(),
    business_name:       data.business_name.trim(),
    email:               data.email.trim().toLowerCase(),
    phone:               data.phone?.trim() || null,
    business_type:       data.business_type || null,
    unpaid_range:        data.unpaid_range || null,
    willingness_to_pay:  data.willingness_to_pay || null,
  });

  if (error) {
    // Postgres unique violation — duplicate email
    if (error.code === "23505") {
      return NextResponse.json<ApiResponse>(
        { success: false, message: "This email has already been registered for the ServiceSignal beta." },
        { status: 409 }
      );
    }
    console.error("\x1b[31m✗ Supabase beta_signups insert error:\x1b[0m", error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: "We couldn't submit your details. Please try again." },
      { status: 500 }
    );
  }

  logSignup(data, "supabase");

  return NextResponse.json<ApiResponse>({
    success: true,
    message: "Thanks — we've received your details. We'll be in touch about the founding beta.",
  });
}
