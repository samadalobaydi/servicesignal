/**
 * Canonical demonstration invoice for Landing Page 2.0.
 *
 * Source of truth: Landing Page Component Inventory → "Demonstration Dataset".
 * Every component on the page must read from here. Never hard-code a second
 * invoice, amount, name or reference anywhere in the v2 landing page.
 *
 * Product-truth notes carried from the documentation and verified against the
 * running product:
 *  - Email is the only reminder channel. SMS is not implemented anywhere in
 *    the codebase and must never be shown as live or available.
 *  - Reminders are approval-only. The owner reviews and approves every send;
 *    Auto Mode is disabled at the UI, API and cron layers.
 *  - ServiceSignal provides the route to pay. It does not process, hold,
 *    confirm or reconcile payment.
 *  - Paid is reached by the owner marking the invoice paid, not by automatic
 *    detection. No delivery/open/read/click tracking is claimed.
 *
 * The email fields below mirror the real output of lib/email-templates.ts
 * (buildReminderEmail) for this invoice at the "firm" tone with an overdue
 * due-status. They are not marketing copy — if the template changes, these
 * must change with it.
 */
export const DEMO = {
  businessName: "Oakfield Plumbing",
  customerName: "Alex Turner",
  customerFirstName: "Alex",
  reference: "INV-1042",
  service: "Bathroom leak repair and pipework replacement",
  amount: "£1,240",
  amountPrecise: "£1,240.00",
  issueDate: "31 May 2026",
  dueDate: "14 June 2026",
  overdueBy: "12 days overdue",

  /**
   * Current reminder state — approval-only.
   * The reminder has been prepared and is waiting for the owner's decision.
   * It has NOT been sent. `reminderSentDate` stays empty until the owner
   * activates "Approve and send" in step 4 of the tour.
   */
  reminderStage: "Ready for review — awaiting your approval",
  reminderPrepared: "26 June 2026",
  reminderSentDate: "",

  paidDate: "27 June 2026",

  /* ── The reminder email, exactly as the product composes it ─────────────
     Sender identity is fixed in lib/resend.ts as
     `ServiceSignal <reminders@servicesignal.app>`. The business name appears
     in the subject, the body and the sign-off — it is not the sender.       */
  emailFromName: "ServiceSignal",
  emailFromAddress: "reminders@servicesignal.app",
  emailSubject: "Overdue invoice reminder from Oakfield Plumbing",
  emailOpening: "Hi Alex,",
  emailFromLine: "This is a reminder from Oakfield Plumbing.",
  emailBody:
    "Your invoice for £1,240.00 is now 12 days overdue. It was due on 14 June 2026 and remains unpaid. Please arrange payment as soon as possible.",
  emailClosingLine: "Thank you,",
  emailSignOff: "Oakfield Plumbing",
  emailFooter: "Sent via ServiceSignal on behalf of Oakfield Plumbing",

  /**
   * No payment link is set on this demonstration invoice, so the reminder
   * shows no Pay Now button — which is exactly what the real product does
   * when `invoice.payment_link` is empty. No payment URL or domain is
   * invented anywhere on this page.
   */
  hasPaymentLink: false,
} as const;
