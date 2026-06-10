import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import type { BetaSignupFormData, ApiResponse } from "@/types";

// ── Validation ─────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body: Partial<BetaSignupFormData>): string | null {
  if (!body.name?.trim())          return "Name is required.";
  if (body.name.trim().length < 2) return "Name must be at least 2 characters.";
  if (!body.business_name?.trim()) return "Business name is required.";
  if (!body.email?.trim())         return "Email address is required.";
  if (!EMAIL_RE.test(body.email))  return "Please enter a valid email address.";
  return null;
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
  const validationError = validate(body);
  if (validationError) {
    return NextResponse.json<ApiResponse>(
      { success: false, message: validationError },
      { status: 400 }
    );
  }

  // Safe cast — validation passed so required fields are present
  const data = body as BetaSignupFormData;

  const supabase = getServerSupabase();

  if (!supabase) {
    // No env vars yet — log to terminal so leads aren't lost during dev
    logSignup(data, "console");
    return NextResponse.json<ApiResponse>({
      success: true,
      message: "You're on the list! We'll be in touch soon.",
    });
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
        { success: false, message: "That email is already on the list — we'll be in touch!" },
        { status: 409 }
      );
    }
    console.error("\x1b[31m✗ Supabase beta_signups insert error:\x1b[0m", error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  logSignup(data, "supabase");

  return NextResponse.json<ApiResponse>({
    success: true,
    message: "You're on the beta list! We'll be in touch soon.",
  });
}
