import "server-only";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { lookupToken } from "@/lib/beta-verification";
import { BETA_CONTINUATION_COOKIE } from "@/lib/beta-continuation";

/**
 * Resolves the verified founding-beta invitation held in the httpOnly cookie.
 *
 * ONE implementation, shared by the /signup page (which decides whether to
 * render the form at all) and /api/beta/continuation (which supplies the
 * prefill). Two copies of this check would be two chances for one of them to
 * accept an unverified token.
 *
 * Returns null for every failure — absent, expired, consumed, superseded, or
 * issued-but-never-clicked — so no caller can distinguish them and use this to
 * probe token state.
 */
export interface VerifiedContinuation {
  email: string;
  businessName: string;
}

export async function resolveContinuation(): Promise<VerifiedContinuation | null> {
  const token = cookies().get(BETA_CONTINUATION_COOKIE)?.value;
  if (!token) return null;

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error("[beta-continuation] Admin client unavailable — check SUPABASE_SERVICE_ROLE_KEY.");
    return null;
  }

  const outcome = await lookupToken(admin, token);

  // Live AND actually clicked. A token that was issued but whose link was
  // never opened must not unlock account setup — that is the whole proof.
  if (outcome.status !== "valid" || !outcome.row.verified_at) return null;

  return {
    email: outcome.row.beta_signup_email,
    businessName: outcome.row.business_name ?? "",
  };
}
