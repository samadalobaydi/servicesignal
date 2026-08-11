import { Suspense } from "react";
import { resolveContinuation } from "@/lib/beta-continuation-server";
import { SignupForm } from "@/components/auth/SignupForm";
import { BetaAccessRequired } from "@/components/auth/BetaAccessRequired";

export const metadata = { title: "Create your account — ServiceSignal" };

// Reads the continuation cookie, so it must never be statically rendered.
export const dynamic = "force-dynamic";

/**
 * Account setup — gated on a verified founding-beta invitation.
 *
 * THE GATE IS SERVER-SIDE AND THE FORM DOES NOT EXIST WITHOUT IT.
 *
 * Previously this route rendered the form to anyone and created accounts via
 * supabase.auth.signUp, which sent Supabase's own generic confirmation email.
 * That was the second of the two competing funnels: a visitor could reach
 * account setup without ever proving they owned the address.
 *
 * Now the invitation is resolved here, before any markup is produced. Without
 * one there is no form in the response at all — nothing to re-enable in
 * devtools, no client flag to flip, and no code path that can call signUp.
 * The verified email is passed down as a prop, so the form never has to decide
 * whether it trusts anything.
 *
 * This is a founding-beta posture, not a permanent one. Restoring a public
 * signup path later means adding an `else` branch that renders the form
 * without a beta invitation — the form itself needs no further change.
 */
export default async function SignupPage() {
  const continuation = await resolveContinuation();

  if (!continuation) return <BetaAccessRequired />;

  return (
    <Suspense>
      <SignupForm
        betaEmail={continuation.email}
        betaBusinessName={continuation.businessName}
      />
    </Suspense>
  );
}
