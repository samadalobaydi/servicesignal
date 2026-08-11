import { NextResponse } from "next/server";
import { resolveContinuation } from "@/lib/beta-continuation-server";

/**
 * GET /api/beta/continuation — what account setup should prefill.
 *
 * Thin wrapper over the shared resolver so the page-level gate and this
 * endpoint can never disagree about what counts as a verified invitation.
 *
 * Returns ONLY the two values the form needs. The token itself is never
 * returned to the browser — that is the point of holding it in an httpOnly
 * cookie: the page can act on the invitation without possessing it.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET() {
  const continuation = await resolveContinuation();

  if (!continuation) {
    return NextResponse.json({ present: false }, { headers: NO_STORE });
  }

  return NextResponse.json(
    {
      present: true,
      email: continuation.email,
      businessName: continuation.businessName,
    },
    { headers: NO_STORE }
  );
}
