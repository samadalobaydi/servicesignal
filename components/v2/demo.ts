/**
 * Canonical demonstration invoice for Landing Page 2.0.
 *
 * Source of truth: Landing Page Component Inventory → "Demonstration Dataset".
 * Every component on the page must read from here. Never hard-code a second
 * invoice, amount, name or reference anywhere in the v2 landing page.
 *
 * Product-truth notes carried from the documentation:
 *  - Reminders are approval-first. The owner reviews and approves each send.
 *  - ServiceSignal provides the route to pay. It does not process, hold,
 *    confirm or reconcile payment.
 *  - Paid is reached by the owner marking the invoice paid, not by automatic
 *    detection. No delivery/open/read/click tracking is claimed.
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
   * Current reminder state — approval-first.
   * The reminder has been prepared and is waiting for the owner's decision.
   * It has NOT been sent. `reminderSentDate` stays empty until the approval
   * stage (Section 3), where the owner approves and the send event occurs.
   */
  reminderStage: "Ready to send — awaiting owner approval",
  reminderPrepared: "26 June 2026",
  reminderSentDate: "",

  paidDate: "27 June 2026",

  /** SMS — the primary channel. Concise, professional, one clear action. */
  sms: `Hi Alex, this is a reminder from Oakfield Plumbing regarding invoice INV-1042 for £1,240, which is now overdue. You can pay securely using the link below. Please disregard this message if payment has already been made.`,
  /**
   * Display label only. There is no approved destination URL, and no
   * business-owned payment domain has been confirmed — so the demonstration
   * never shows a URL-shaped value and never renders a live link.
   */
  paymentLinkLabel: "Open payment link",

  /** Email — the richer supporting channel. Same invoice, same route. */
  emailSubject: "Payment reminder for invoice INV-1042",
  emailFrom: "Oakfield Plumbing",
  emailVia: "reminders@servicesignal.app",
  emailGreeting: "Hi Alex,",
  emailBody:
    "This is a reminder that invoice INV-1042 for £1,240 is now overdue. You can pay securely using the button below.",
  emailClosing: "If you've already paid, please disregard this message.",
} as const;
