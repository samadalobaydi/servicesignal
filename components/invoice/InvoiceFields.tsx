"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SCHEDULE_LABELS, SCHEDULE_ORDER } from "@/lib/invoices";
import { PRESETS, TONE_OPTIONS } from "@/lib/invoice-form";
import {
  formatAmountOnBlur,
  isoToUkDate,
  ukDateToIso,
} from "@/lib/invoice-input";
import { describeScheduleFromDueDate } from "@/lib/onboarding-schedule";
import type { InvoiceFormState } from "./useInvoiceForm";

/**
 * The invoice fields themselves, with no container.
 *
 * Renders no <form>, no heading and no submit button: the dashboard drawer
 * wraps these in a slide-over with its own footer, and onboarding wraps them
 * in a page step. A component owning its own form element would force one of
 * the two to nest forms.
 *
 * WHAT CHANGED, AND WHY
 *
 * The form previously showed three tone cards and four schedule cards
 * permanently, plus a full-width payment-link field — a page of advanced
 * decisions before a first-time user had seen anything ServiceSignal does.
 * Tone and schedule now show as one-line summaries of their existing defaults
 * with a Change control, and the two genuinely optional fields are collapsed.
 * Nothing was removed: every option is still reachable in one click.
 */

// ── Small building blocks ───────────────────────────────────────────────────

/**
 * A collapsed optional section.
 *
 * A real <button> with aria-expanded and aria-controls, so the state is
 * announced rather than implied by a rotating chevron. The content is
 * unmounted when closed — nothing hidden with CSS that a screen reader would
 * still find.
 */
function Collapsible({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="opt-add"
      >
        {/* A sized, bordered glyph rather than a bare "+" character: the text
            plus sign inherited the label's metrics and sat slightly high, which
            is what made these read as floating links rather than controls.
            Decorative — aria-expanded already conveys the state. */}
        <span className="opt-add-icon" aria-hidden="true">{open ? "−" : "+"}</span>
        {label}
      </button>
      {open && (
        <div id={id} className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** One-line summary of a defaulted setting, with a Change disclosure. */
function SettingSummary({
  label,
  value,
  detail,
  open,
  onToggle,
  controls,
}: {
  label: string;
  value: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg p-3"
      style={{ background: "#f8fafc", border: "1px solid var(--dash-border, #e5e7eb)" }}
    >
      <div style={{ minWidth: 0 }}>
        <p className="text-sm" style={{ fontWeight: 650, color: "#0f172a" }}>
          {label}: {value}
        </p>
        {detail && (
          <p className="text-xs mt-0.5" style={{ color: "#64748b", lineHeight: 1.5 }}>
            {detail}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={controls}
        className="text-sm rounded flex-shrink-0"
        style={{
          background: "none",
          border: "none",
          padding: "0.2rem 0.3rem",
          color: "var(--dash-accent-strong, #2a5fe3)",
          fontWeight: 650,
          cursor: "pointer",
        }}
      >
        {open ? "Done" : "Change"}
      </button>
    </div>
  );
}

/**
 * Which surface is collecting the invoice.
 *
 * A union, not a boolean: adding a third surface later extends this without
 * anyone having to guess what `false` meant.
 */
export type InvoiceFieldsVariant = "dashboard" | "onboarding";

// ── Main ────────────────────────────────────────────────────────────────────

export function InvoiceFields({
  state,
  showCustomerSection = true,
  variant,
  savedPaymentLink = null,
  saveAsDefault = false,
  onSaveAsDefaultChange,
}: {
  state: InvoiceFormState;
  showCustomerSection?: boolean;
  /**
   * WHICH SURFACE IS RENDERING THIS — required, with no default.
   *
   * This replaced an `onboarding?: boolean` that defaulted to false. That
   * default was the whole bug: the dashboard passed nothing, silently selected
   * the legacy branch, and shipped the pre-refactor form to production while
   * every gate stayed green. A boolean named after ONE caller cannot describe
   * two surfaces, and an optional prop lets a caller forget to choose.
   *
   * Both variants now render the SAME modern layout. The variant no longer
   * selects a design — it selects only the genuine rule differences below.
   */
  variant: InvoiceFieldsVariant;
  /** The account default from profiles.default_payment_link, if any. */
  savedPaymentLink?: string | null;
  /** Whether this invoice's link should become the account default. */
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (next: boolean) => void;
}) {
  const { form, errors, preset, setField, toggleSchedule, selectPreset } = state;

  // ── THE ONLY THINGS THE VARIANT CHANGES ────────────────────────────────
  //
  // Layout, labels and the reminder-plan presentation are now identical on
  // both surfaces. What legitimately differs is which fields are MANDATORY,
  // and those flags mirror validateInvoiceForm's `requireOnboardingFields`
  // exactly — see lib/invoice-form.ts. If they ever disagree, the form marks a
  // field required that nothing enforces (or vice versa), which is the defect
  // this pass exists to prevent.
  //
  // The dashboard deliberately does NOT require a reference or a phone number:
  // invoices without either already exist in production, and rejecting them
  // would be a regression, not a tightening.
  const isOnboarding = variant === "onboarding";
  const requireReference = isOnboarding;
  const requirePhone = isOnboarding;

  const pickerRef = useRef<HTMLInputElement>(null);
  const [toneOpen, setToneOpen] = useState(false);   // summary + Change, both surfaces
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // The amount is held as typed while focused and formatted on blur, so
  // "1,500" never round-trips through a parser that would read it as 1.
  const [amountDisplay, setAmountDisplay] = useState(form.amount);
  useEffect(() => {
    setAmountDisplay((current) => (current === form.amount ? current : form.amount));
    // Only re-sync when the stored value changes underneath us (reset/prefill).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount]);

  // The date is typed as dd/mm/yyyy and picked from a native calendar; both
  // write the same ISO value, so they cannot drift apart.
  const [dateText, setDateText] = useState(() => isoToUkDate(form.due_date));
  useEffect(() => {
    setDateText(isoToUkDate(form.due_date));
  }, [form.due_date]);

  const toneLabel =
    TONE_OPTIONS.find((t) => t.value === form.reminder_tone)?.desc ?? "Professional & direct";
  const activePreset = PRESETS.find((p) => p.key === preset);

  const err = (key: keyof typeof errors) => errors[key];

  return (
    <div className="space-y-6">
      {showCustomerSection && (
        <div>
          <p className="section-legend">{"Customer"}</p>
          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="inv-customer-name">
                {"Customer name *"}
              </label>
              <input
                id="inv-customer-name" type="text" className="dash-input" placeholder="Dave Morrison"
                value={form.customer_name}
                onChange={(e) => setField("customer_name", e.target.value)}
                aria-invalid={!!err("customer_name")}
                aria-describedby={err("customer_name") ? "inv-customer-name-err" : undefined}
              />
              {err("customer_name") && (
                <p id="inv-customer-name-err" className="field-err">{err("customer_name")}</p>
              )}
            </div>

            {/* SMS and email are equal channels, so the two fields sit together
                and their helper text is symmetrical — neither is described as
                primary, supporting or richer than the other.

                The previous helper text ("which are being finalised", "sent by
                email while SMS is being finalised") was development-era status
                reporting. It told a paying customer about our build order,
                ranked the channels against each other, and would have had to be
                edited again at launch. The wording below states what each field
                is FOR, which is true now and stays true. */}
            {/* Mobile and email sit side by side from `sm` up: they are the
                two channels a reminder goes out on, so pairing them says that
                visually, and it removes a full field's height from the tallest
                section of the form. Same `grid-cols-1 sm:grid-cols-2` pattern
                the amount/date row already uses — no new breakpoint. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="inv-customer-phone">
                {requirePhone ? "Mobile number *" : <>Mobile number <span className="opt">(optional)</span></>}
              </label>
              <input
                id="inv-customer-phone" type="tel" inputMode="tel" className="dash-input"
                placeholder="07700 900000" autoComplete="tel"
                value={form.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value)}
                aria-invalid={!!err("customer_phone")}
                aria-describedby={
                  err("customer_phone") ? "inv-customer-phone-err" : "inv-customer-phone-help"
                }
              />
              {err("customer_phone") ? (
                <p id="inv-customer-phone-err" className="field-err">{err("customer_phone")}</p>
              ) : (
                <p id="inv-customer-phone-help" className="field-help">
                  Used for SMS reminders.
                </p>
              )}
            </div>

            <div>
              <label className="field-label" htmlFor="inv-customer-email">
                {"Email address *"}
              </label>
              <input
                id="inv-customer-email" type="email" inputMode="email" className="dash-input"
                placeholder="dave@example.co.uk" autoComplete="email"
                value={form.customer_email}
                onChange={(e) => setField("customer_email", e.target.value)}
                aria-invalid={!!err("customer_email")}
                aria-describedby={
                  err("customer_email") ? "inv-customer-email-err" : "inv-customer-email-help"
                }
              />
              {err("customer_email") ? (
                <p id="inv-customer-email-err" className="field-err">{err("customer_email")}</p>
              ) : (
                <p id="inv-customer-email-help" className="field-help">
                  Used for email reminders.
                </p>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="section-legend">{"Invoice"}</p>
        <div className="space-y-3">

            <div>
              <label className="field-label" htmlFor="inv-reference">
                {requireReference ? "Invoice reference *" : <>Invoice reference <span className="opt">(optional)</span></>}
              </label>
              <input
                id="inv-reference" type="text" className="dash-input" placeholder="INV-1042"
                value={form.invoice_reference}
                onChange={(e) => setField("invoice_reference", e.target.value)}
                aria-invalid={!!err("invoice_reference")}
                aria-describedby={err("invoice_reference") ? "inv-reference-err" : undefined}
              />
              {err("invoice_reference") && (
                <p id="inv-reference-err" className="field-err">{err("invoice_reference")}</p>
              )}
            </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="inv-amount">
                Amount *
              </label>

                <input
                  id="inv-amount"
                  // TEXT, not number. A number input strips the comma in
                  // "1,500" inconsistently across browsers and offers a
                  // spinner nobody wants on a money field. inputMode gives
                  // mobile the decimal keypad without any of that.
                  type="text"
                  inputMode="decimal"
                  className="dash-input"
                  placeholder="1,500.00"
                  value={amountDisplay}
                  onChange={(e) => {
                    setAmountDisplay(e.target.value);
                    setField("amount", e.target.value);
                  }}
                  onBlur={() => {
                    // Formats on leaving, and leaves an unparseable value
                    // exactly as typed so the user can see and correct it.
                    const formatted = formatAmountOnBlur(amountDisplay);
                    setAmountDisplay(formatted);
                    setField("amount", formatted);
                  }}
                  aria-describedby={err("amount") ? "inv-amount-err" : "inv-amount-help"}
                  aria-invalid={!!err("amount")}
                />
              {err("amount") ? (
                <p id="inv-amount-err" className="field-err">{err("amount")}</p>
              ) : (
                <p id="inv-amount-help" className="field-help">In pounds (GBP).</p>
              )}
            </div>

            <div>
              <label className="field-label" htmlFor="inv-due-date">Due date *</label>
              {/* ONE field, not two.
                  A single text input owns dd/mm/yyyy. The calendar button sits
                  INSIDE it and opens the browser's own picker via showPicker()
                  on a visually-hidden date input — so there is no second
                  visible date control to confuse anyone, and no date-picker
                  dependency. Both paths write the same ISO string, so they
                  cannot drift.

                  BRACES ARE LOAD-BEARING. A bare block comment sitting among
                  JSX CHILDREN is not a comment — it is text, and React renders
                  it. This one shipped to a Preview and appeared as visible
                  copy above the date field. */}
                <div className="ss-date">
                  <input
                    id="inv-due-date" type="text" inputMode="numeric"
                    className="dash-input ss-date-text"
                    placeholder="dd/mm/yyyy" maxLength={10}
                    value={dateText}
                    onChange={(e) => {
                      setDateText(e.target.value);
                      const iso = ukDateToIso(e.target.value);
                      // Only commit a complete, real date. A half-typed value
                      // must not clear a previously chosen one.
                      if (iso) setField("due_date", iso);
                      else if (!e.target.value.trim()) setField("due_date", "");
                    }}
                    aria-invalid={!!err("due_date")}
                    aria-describedby={err("due_date") ? "inv-due-date-err" : "inv-due-date-help"}
                  />
                  <button
                    type="button"
                    className="ss-date-btn"
                    aria-label="Open calendar to choose the due date"
                    onClick={() => {
                      const el = pickerRef.current;
                      if (!el) return;
                      // showPicker() is the supported way to open the native
                      // calendar from a button. Older browsers fall back to
                      // focus+click, and if neither works the user can still
                      // type the date — the text field is never disabled.
                      if (typeof el.showPicker === "function") {
                        try { el.showPicker(); return; } catch { /* fall through */ }
                      }
                      el.focus();
                      el.click();
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M16 3v4M8 3v4M3 11h18" strokeLinecap="round" />
                    </svg>
                  </button>
                  {/* Visually hidden, never tabbable: the button above is the
                      keyboard-accessible control, so this must not be a second
                      tab stop announcing an empty date field. */}
                  <input
                    ref={pickerRef}
                    type="date"
                    tabIndex={-1}
                    aria-hidden="true"
                    className="ss-date-native"
                    value={form.due_date}
                    onChange={(e) => setField("due_date", e.target.value)}
                  />
                </div>
              {err("due_date") ? (
                <p id="inv-due-date-err" className="field-err">{err("due_date")}</p>
              ) : (
                <p id="inv-due-date-help" className="field-help">
                  {/* IDENTICAL ON BOTH SURFACES.
                      Onboarding used to append "Must already be overdue.",
                      mirroring a validator rule that has since been deleted.
                      Nothing about the real due date is a matter for the
                      surface collecting it: an invoice due next week is
                      ordinary data, and telling a customer otherwise invites
                      them to type a date that is not true. */}
                  Type dd/mm/yyyy or use the calendar.
                </p>
              )}
            </div>
          </div>


          <Collapsible label="Add a job description">
            <label className="field-label" htmlFor="inv-job">
              Job description <span className="opt">(optional)</span>
            </label>
            <input
              id="inv-job" type="text" className="dash-input"
              placeholder="Boiler repair at 18 King Street"
              value={form.job_description}
              onChange={(e) => setField("job_description", e.target.value)}
              aria-invalid={!!err("job_description")}
              aria-describedby={err("job_description") ? "inv-job-err" : "inv-job-help"}
            />
            {err("job_description") ? (
              <p id="inv-job-err" className="field-err">{err("job_description")}</p>
            ) : (
              <p id="inv-job-help" className="field-help">
                Gives the reminder something specific to refer to.
              </p>
            )}
          </Collapsible>


          <Collapsible
            label={savedPaymentLink ? "Payment link" : "Add a payment link"}
            defaultOpen={!!savedPaymentLink}
          >
            <label className="field-label" htmlFor="inv-payment-link">
              Payment link <span className="opt">(optional)</span>
            </label>
            <input
              id="inv-payment-link" type="url" inputMode="url" className="dash-input"
              placeholder="https://..."
              value={form.payment_link}
              onChange={(e) => setField("payment_link", e.target.value)}
              aria-invalid={!!err("payment_link")}
              aria-describedby={err("payment_link") ? "inv-payment-link-err" : "inv-payment-link-help"}
            />
            {err("payment_link") ? (
              <p id="inv-payment-link-err" className="field-err">{err("payment_link")}</p>
            ) : (
              <p id="inv-payment-link-help" className="field-help">
                {savedPaymentLink
                  ? "Prefilled from your saved default. Changing it here only affects this invoice."
                  : "Add the payment link you already use. Customers pay you directly — ServiceSignal never handles the money."}
              </p>
            )}

            {/* Only offered when there is something to save, and when it
                differs from what is already saved — otherwise the control
                promises an action with no effect. Ticking it is the ONLY way
                an invoice edit can change the account default. */}
            {onSaveAsDefaultChange &&
              form.payment_link.trim().startsWith("https://") &&
              form.payment_link.trim() !== (savedPaymentLink ?? "") && (
                <label className="flex items-start gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsDefault}
                    onChange={(e) => onSaveAsDefaultChange(e.target.checked)}
                    style={{ marginTop: "0.15rem", width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span className="text-sm" style={{ color: "#0f172a", lineHeight: 1.5 }}>
                    {savedPaymentLink
                      ? "Replace my saved default payment link"
                      : "Save as my default payment method"}
                    <span className="field-help" style={{ display: "block", marginTop: 0 }}>
                      Prefilled on future invoices. You can change it in Settings.
                    </span>
                  </span>
                </label>
              )}
          </Collapsible>
        </div>
      </div>

      <div>
        <p className="section-legend">{"Reminder plan"}</p>
        <div className="space-y-3">

          <SettingSummary
            label="Tone"
            value={toneLabel}
            open={toneOpen}
            onToggle={() => setToneOpen((v) => !v)}
            controls="inv-tone-panel"
          />
          {toneOpen && (
            <div id="inv-tone-panel" className="grid grid-cols-3 gap-2" role="group" aria-label="Reminder tone">
              {TONE_OPTIONS.map((opt) => {
                const active = form.reminder_tone === opt.value;
                return (
                  <button
                    key={opt.value} type="button" onClick={() => setField("reminder_tone", opt.value)}
                    aria-pressed={active}
                    className="p-2.5 rounded-lg border text-left transition-all"
                    style={{
                      background: active ? `${opt.color}10` : "#ffffff",
                      borderColor: active ? opt.color : "var(--dash-border)",
                    }}
                  >
                    <p className="text-sm" style={{ fontWeight: 650, color: active ? opt.color : "var(--dash-text)" }}>
                      {opt.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.3 }}>
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* ONBOARDING SHOWS A LIVE PLAN, NOT THE GENERIC PRESET SUMMARY.
              The shared summary ("On the due date, then 3 and 7 days overdue")
              describes a plan from the START of an invoice's life. That is fine
              on the dashboard, and wrong here whenever the invoice is ALREADY
              overdue: it describes checkpoints that have passed and promises
              more reminders than will ever arrive — an invoice entered 12 days
              overdue on Standard receives exactly one.

              Onboarding no longer requires an overdue invoice, so this now
              serves both cases: describeScheduleFromDueDate reads from today
              either way, naming what is ready now for a past-dated invoice and
              the full remaining plan for a future-dated one. See
              lib/onboarding-schedule.ts. Falls back to the shared summary until
              a due date has been entered. */}

          <SettingSummary
            label="Schedule"
            value={activePreset?.key === "custom" ? "Custom" : `${activePreset?.title ?? "Standard"}`}
            detail={
              describeScheduleFromDueDate(form.reminder_schedules, ukDateToIso(form.due_date) ?? "") ??
              activePreset?.summary ??
              "Choose your own reminder days"
            }
            open={scheduleOpen}
            onToggle={() => setScheduleOpen((v) => !v)}
            controls="inv-schedule-panel"
          />
          {scheduleOpen && (
            <div id="inv-schedule-panel">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Reminder schedule">
                {PRESETS.map((p) => {
                  const active = preset === p.key;
                  return (
                    <button
                      key={p.key} type="button" onClick={() => selectPreset(p.key)}
                      aria-pressed={active}
                      aria-label={`${p.title} reminder schedule — ${p.subtitle}`}
                      className="text-left p-3 rounded-xl border transition-all"
                      style={{
                        background: active ? "var(--dash-accent-soft)" : "#ffffff",
                        borderColor: active ? "var(--dash-accent)" : "var(--dash-border)",
                        boxShadow: active ? "0 0 0 1px var(--dash-accent)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm" style={{ fontWeight: 650, color: active ? "var(--dash-accent-strong)" : "#0f172a" }}>
                          {p.title}
                        </p>
                        {p.badge && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
                            style={{ background: "var(--dash-accent-soft)", color: "var(--dash-accent-strong)", fontWeight: 600, border: "1px solid #a5f0fa" }}
                          >
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>{p.subtitle}</p>
                      {p.summary && <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>{p.summary}</p>}
                    </button>
                  );
                })}
              </div>

              {preset === "custom" && (
                <div className="space-y-2 mt-3">
                  {SCHEDULE_ORDER.map((s) => {
                    const checked = form.reminder_schedules.includes(s);
                    return (
                      <label
                        key={s} className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all"
                        style={{ background: "#ffffff", border: "1px solid var(--dash-border)" }}
                      >
                        <div
                          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            background: checked ? "var(--dash-accent)" : "transparent",
                            border: `2px solid ${checked ? "var(--dash-accent)" : "var(--dash-border-strong)"}`,
                          }}
                        >
                          {checked && (
                            <svg width="9" height="9" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M5 13l4 4L19 7" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <span className="text-sm" style={{ color: "#0f172a" }}>{SCHEDULE_LABELS[s]}</span>
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleSchedule(s)} />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {err("reminder_schedules") && (
            <p className="field-err">{err("reminder_schedules")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
