"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { V2_BUSINESS_TYPES, V2_UNPAID_RANGES } from "@/lib/beta-options";
import { writeSignupPrefill, clearSignupPrefill } from "@/lib/signup-prefill";

/**
 * Section 3 — Founding beta access.
 *
 * A live registration form, not a visual mock. It submits to the existing
 * /api/signup route and the existing beta_signups table — no second
 * datastore, no fabricated success. Success is shown only when the API
 * confirms the record was saved.
 *
 * Five required fields. Phone, willingness-to-pay, customer, invoice and
 * payment details are deliberately not collected here.
 */

const BUSINESS_TYPES: readonly string[] = V2_BUSINESS_TYPES;
const UNPAID_RANGES: readonly string[] = V2_UNPAID_RANGES;

type Fields = {
  name: string;
  business_name: string;
  email: string;
  business_type: string;
  unpaid_range: string;
};

type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", business_name: "", email: "", business_type: "", unpaid_range: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FoundingBetaSection() {
  const [form, setForm] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  /* True only when the API confirms Resend accepted the access email. */
  const [emailSent, setEmailSent] = useState(false);
  // The server distinguishes "already on the list" from "the send failed".
  // Without it the two collapse into one arm and a deliberate product decision
  // gets reported to the visitor as an infrastructure failure.
  const [alreadyListed, setAlreadyListed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * The address we actually submitted, captured at the moment of success.
   *
   * Deliberately NOT read from `form.email` at render time: "Use a different
   * email" puts the visitor back in the form and lets them edit that field, so
   * reading it live would let the confirmation drift away from the address the
   * email was really sent to.
   */
  const [submittedEmail, setSubmittedEmail] = useState("");
  /* Set when returning to the form, so the cursor lands on the field to fix. */
  const [refocusEmail, setRefocusEmail] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!refocusEmail) return;
    formRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus();
    setRefocusEmail(false);
  }, [refocusEmail]);

  const set = (k: keyof Fields, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (f: Fields): Errors => {
    const e: Errors = {};
    if (!f.name.trim()) e.name = "Please enter your name.";
    else if (f.name.trim().length < 2) e.name = "Name must be at least 2 characters.";
    if (!f.business_name.trim()) e.business_name = "Please enter your business name.";
    if (!f.email.trim()) e.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(f.email.trim())) e.email = "Please enter a valid email address.";
    if (!f.business_type) e.business_type = "Please choose your business type.";
    if (!f.unpaid_range) e.unpaid_range = "Please choose an approximate amount.";
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault(); // never reload — the visitor keeps their position
    setFormError(null);

    const found = validate(form);
    if (Object.keys(found).length) {
      setErrors(found);
      // Move focus to the first invalid field
      const first = (Object.keys(found) as (keyof Fields)[])[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    // Normalised once, then used for the request, the handover and the
    // confirmation — so all three can never disagree about the address.
    const cleanEmail = form.email.trim().toLowerCase();

    setStatus("sending");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          business_name: form.business_name.trim(),
          email: cleanEmail,
          business_type: form.business_type,
          unpaid_range: form.unpaid_range,
          source: "v2",
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        // The API reports saving and sending as separate outcomes, so the
        // confirmation below can only claim an email was sent when one was.
        setEmailSent(Boolean(data.emailSent));
        setAlreadyListed(data.outcome === "already_listed");
        // Hand the two reusable values to /signup via same-origin
        // sessionStorage — never a query string, so the address stays out of
        // history, referrer headers and server logs.
        writeSignupPrefill({
          businessName: form.business_name,
          email: cleanEmail,
        });
        setSubmittedEmail(cleanEmail);
        setStatus("done"); // only on confirmed save
        return;
      }
      setStatus("idle");
      if (data?.fieldErrors && typeof data.fieldErrors === "object") {
        setErrors(data.fieldErrors as Errors);
        const first = Object.keys(data.fieldErrors)[0];
        formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      }
      setFormError(
        data?.message ?? "We couldn't submit your details. Please try again."
      );
    } catch {
      setStatus("idle");
      setFormError("We couldn't submit your details. Please try again.");
    }
  };

  const sending = status === "sending";

  /**
   * "Use a different email" — a typo recovery route, and nothing more.
   *
   * PURELY CLIENT-SIDE. It makes no request, so it cannot create a second beta
   * record, cannot issue a token and cannot send an email. Nothing new happens
   * until the corrected form is submitted again, which goes through the same
   * validated, rate-limited endpoint as the first attempt.
   *
   * The name, business name, business type and amount are kept — they were
   * correct, and making someone retype four fields to fix one is the reason
   * people abandon a form. Only the email is cleared, because it is the field
   * being corrected and a pre-filled wrong address is easy to resubmit by
   * accident.
   *
   * The /signup handover is cleared too. It currently holds the mistyped
   * address, and leaving it would let the typo prefill the account form later
   * in the journey — the exact error the visitor just came back to fix.
   *
   * Nothing here treats the old address as verified: no token is held on the
   * client at any point, and the previously issued one is untouched. It simply
   * expires, and issuing a token for any address supersedes that address's
   * earlier tokens server-side.
   */
  const useDifferentEmail = () => {
    setForm((f) => ({ ...f, email: "" }));
    setErrors({});
    setFormError(null);
    setEmailSent(false);
    setAlreadyListed(false);
    setSubmittedEmail("");
    clearSignupPrefill();
    setStatus("idle");
    setRefocusEmail(true);
  };

  return (
    <section id="access" className="v2-beta" aria-labelledby="beta-heading">
      <div className="v2-section v2-beta-grid">
        {/* ── Copy ── */}
        <div className="v2-beta-copy">
          <p className="v2-beta-eyebrow">Founding beta</p>
          <h2 id="beta-heading" className="v2-beta-heading">
            Built for UK trades. Join the founding beta.
          </h2>
          <p className="v2-beta-sub">
            We&rsquo;re opening ServiceSignal to trades and local service businesses
            who want a simpler way to follow up overdue invoices. Tell us about your
            work, verify your email and finish creating your account.
          </p>
        </div>

        {/* ── Live form ── */}
        <div className="v2-beta-card">
          {status === "done" ? (
            <div className="v2-beta-done" role="status" aria-live="polite">
              <span className="v2-beta-done-ico" aria-hidden="true">✓</span>

              {/* There is deliberately NO link to account setup here.
                  Verification now happens BEFORE the account exists, so
                  offering a route onward would let an unverified person skip
                  the one step that proves they own the address — and would
                  recreate the two competing funnels this replaced.
                  The two states stay genuinely distinct: "Check your inbox" is
                  shown only when the API confirmed Resend accepted the email. */}
              {emailSent ? (
                <>
                  <p className="v2-beta-done-t">Check your inbox</p>
                  <p className="v2-beta-done-s">
                    We&rsquo;ve sent a verification link to{" "}
                    {/* The exact address we mailed, shown so a typo is
                        caught here rather than after a silent non-arrival.
                        overflow-wrap lets a long address break mid-string
                        instead of pushing the card wide. */}
                    <span className="v2-beta-done-email">{submittedEmail}</span>.
                  </p>
                  <p className="v2-beta-done-s">
                    Open it to finish creating your ServiceSignal account. The link
                    expires in 48 hours. If it hasn&rsquo;t arrived after a few
                    minutes, check your spam folder.
                  </p>
                </>
              ) : alreadyListed ? (
                <>
                  {/* NOT a failure. This address is already on the list and we
                      deliberately do not resend — sending again on demand would
                      let anyone mail the same address repeatedly, and the
                      per-address cooldown that would make it safe does not
                      exist yet. Saying "we couldn't send" here described that
                      product decision as an infrastructure fault. */}
                  <p className="v2-beta-done-t">You&rsquo;re already on the list</p>
                  <p className="v2-beta-done-s">
                    <span className="v2-beta-done-email">{submittedEmail}</span> is
                    already registered for the founding beta. If you still have our
                    verification email, open the link in it to finish creating your
                    account.
                  </p>
                  {/* The 48 hours is not decoration. Tokens expire after
                      VERIFICATION_TTL_HOURS, submitting this form again does NOT
                      issue a replacement, and nothing here resends — so telling
                      someone to "check your inbox" and stopping would, after two
                      days, be an instruction that cannot work.

                      IT DOES NOT PROMISE A NEW LINK. issueVerification has
                      exactly one caller (the signup route, which duplicates
                      never reach); there is no admin route, script or task that
                      can mint and send a replacement token. Support can help a
                      person, so that is all this claims. See the launch gap in
                      the report. */}
                  <p className="v2-beta-done-s">
                    Verification links expire 48 hours after they&rsquo;re sent. If
                    yours has expired, or you can&rsquo;t find the email, check your
                    spam folder or email support@servicesignal.app and we&rsquo;ll
                    help you get set up.
                  </p>
                </>
              ) : (
                <>
                  <p className="v2-beta-done-t">Thanks — your details are saved.</p>
                  <p className="v2-beta-done-s">
                    We couldn&rsquo;t send a verification link to{" "}
                    <span className="v2-beta-done-email">{submittedEmail}</span> just
                    now. We&rsquo;ll be in touch shortly, or email
                    support@servicesignal.app and we&rsquo;ll get you set up.
                  </p>
                </>
              )}

              {/* Restrained on purpose: the primary path is the inbox, and
                  this must not compete with it. Offered in BOTH states —
                  a wrong address is the most likely reason an email did not
                  arrive, whichever branch the visitor is looking at. */}
              <button
                type="button"
                className="v2-beta-done-alt"
                onClick={useDifferentEmail}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form ref={formRef} onSubmit={onSubmit} noValidate>
              <div className="v2-beta-fields">
                <div className="v2-beta-field">
                  <label htmlFor="beta-name">Your name</label>
                  <input
                    id="beta-name" name="name" type="text" autoComplete="name"
                    value={form.name} onChange={(e) => set("name", e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "beta-name-err" : undefined}
                    disabled={sending}
                  />
                  {errors.name && <p id="beta-name-err" className="v2-beta-err">{errors.name}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-business">Business name</label>
                  <input
                    id="beta-business" name="business_name" type="text" autoComplete="organization"
                    value={form.business_name} onChange={(e) => set("business_name", e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.business_name}
                    aria-describedby={errors.business_name ? "beta-business-err" : undefined}
                    disabled={sending}
                  />
                  {errors.business_name && <p id="beta-business-err" className="v2-beta-err">{errors.business_name}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-email">Email address</label>
                  <input
                    id="beta-email" name="email" type="email" autoComplete="email"
                    value={form.email} onChange={(e) => set("email", e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "beta-email-err" : undefined}
                    disabled={sending}
                  />
                  {errors.email && <p id="beta-email-err" className="v2-beta-err">{errors.email}</p>}
                </div>

                <div className="v2-beta-field">
                  <label htmlFor="beta-type">Business type</label>
                  <select
                    id="beta-type" name="business_type"
                    value={form.business_type} onChange={(e) => set("business_type", e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.business_type}
                    aria-describedby={errors.business_type ? "beta-type-err" : undefined}
                    disabled={sending}
                  >
                    <option value="">Please choose…</option>
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {errors.business_type && <p id="beta-type-err" className="v2-beta-err">{errors.business_type}</p>}
                </div>

                <div className="v2-beta-field v2-beta-field-wide">
                  <label htmlFor="beta-range">Roughly how much are you currently chasing?</label>
                  <select
                    id="beta-range" name="unpaid_range"
                    value={form.unpaid_range} onChange={(e) => set("unpaid_range", e.target.value)}
                    aria-required="true"
                    aria-invalid={!!errors.unpaid_range}
                    aria-describedby={errors.unpaid_range ? "beta-range-err" : undefined}
                    disabled={sending}
                  >
                    <option value="">Please choose…</option>
                    {UNPAID_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {errors.unpaid_range && <p id="beta-range-err" className="v2-beta-err">{errors.unpaid_range}</p>}
                </div>
              </div>

              {formError && (
                <p className="v2-beta-formerr" role="alert">{formError}</p>
              )}

              <button type="submit" className="v2-beta-btn" disabled={sending}>
                {sending ? "Sending…" : "Join the founding beta"}
              </button>

              <p className="v2-beta-privacy">
                We&rsquo;ll use your details to create your account, send essential
                service emails and keep you updated about the ServiceSignal beta.
                Read our{" "}
                <Link href="/privacy?from=landing" className="v2-beta-privacy-link">Privacy Policy</Link>.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
