import Link from "next/link";
import { AuthShell, AuthHeading, BRAND_BLUE } from "@/components/auth/AuthShell";
import { SignupAside } from "@/components/auth/SignupAside";
import splitStyles from "@/components/auth/auth-split.module.css";

/**
 * Shown at /signup when there is no verified founding-beta invitation.
 *
 * Reuses the split-screen shell so the journey looks continuous rather than
 * like an error page — the visitor is early, not wrong.
 *
 * It states only that access starts with the beta form. It does NOT say
 * whether any particular address has applied, been invited, or already has an
 * account: this page is reachable by anyone, so anything more specific would
 * leak account existence.
 *
 * Every route from here stays inside the current journey — the founding-beta
 * section on /v2, or sign-in. Nothing points at the original landing page.
 */
export function BetaAccessRequired() {
  return (
    <AuthShell
      aside={<SignupAside />}
      footer={
        <>
          <p className={splitStyles.footerPrimary}>
            Already have an account?{" "}
            <Link href="/login" style={{ color: BRAND_BLUE, fontWeight: 600 }}>
              Sign in
            </Link>
          </p>
          <Link href="/v2" className={splitStyles.footerSecondary}>
            Back to ServiceSignal
          </Link>
        </>
      }
    >
      <AuthHeading
        title="Founding beta access"
        subtitle="ServiceSignal accounts are currently created through the founding beta."
      />

      <div
        className="rounded-lg p-4 text-sm"
        style={{ background: "#f8fafc", border: "1px solid #e5e7eb", color: "#475569", lineHeight: 1.65 }}
      >
        <p style={{ fontWeight: 650, color: "#0f172a", marginBottom: "0.4rem" }}>
          How to get started
        </p>
        <p>
          Join the founding beta with your business details. We&rsquo;ll email you a
          link to verify your address, and you can create your account from there.
        </p>
        <p style={{ marginTop: "0.6rem" }}>
          Already applied? Open the most recent verification email we sent you —
          links expire after 48 hours.
        </p>
      </div>

      <Link
        href="/v2#access"
        className="mt-5 w-full inline-flex items-center justify-center rounded-lg"
        style={{
          background: BRAND_BLUE,
          color: "#ffffff",
          padding: "0.8rem 1.25rem",
          fontSize: "0.95rem",
          fontWeight: 650,
          textDecoration: "none",
        }}
      >
        Join the founding beta
      </Link>
    </AuthShell>
  );
}
