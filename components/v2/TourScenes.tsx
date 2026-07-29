"use client";

import { DEMO } from "./demo";
import { initialsOf } from "./parts";

/* ══════════════════════════════════════════════════════════════════
   Product-tour scenes.

   Rebuilt as lightweight React + CSS — no screenshots, no personal
   data. Every value is fictional and comes from the canonical
   demonstration dataset.

   Product truth: nothing sends without the owner's approval. No
   delivery, open, read, reply or payment tracking is depicted.
   ══════════════════════════════════════════════════════════════════ */

type RowSpec = {
  name: string;
  reference: string;
  amount: string;
  due: string;
  overdue: string;
  state: string;
  focus?: boolean;
};

const ROWS: RowSpec[] = [
  {
    name: DEMO.customerName,
    reference: DEMO.reference,
    amount: DEMO.amount,
    due: DEMO.dueDate,
    overdue: DEMO.overdueBy,
    state: "Ready to send",
    focus: true,
  },
  { name: "Sarah & Paul Clarke", reference: "INV-1043", amount: "£680", due: "17 June 2026", overdue: "7 days overdue", state: "Reminder sent" },
  { name: "J. Whitfield", reference: "INV-1044", amount: "£480", due: "21 June 2026", overdue: "3 days overdue", state: "Ready to send" },
];

/** Persistent application shell. Stays mounted across every step. */
export function TourShell({ children }: { children: React.ReactNode }) {
  const nav = ["Overview", "Active Chasing", "Needs Action", "Paid Invoices", "Settings"];
  return (
    <div className="v2-tour-app">
      <aside className="v2-tour-side" aria-hidden="true">
        <div className="v2-tour-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/servicesignal-mark.png" alt="" style={{ height: 22, width: "auto" }} />
          <span>
            Service<span style={{ color: "#5b8def" }}>Signal</span>
          </span>
        </div>
        <nav className="v2-tour-nav">
          {nav.map((item) => (
            <span key={item} className={`v2-tour-navitem${item === "Active Chasing" ? " is-active" : ""}`}>
              {/* Marker keeps the compact sidebar legible once labels are
                  hidden at narrow widths — no zero-size text. */}
              <span className="v2-tour-navdot" aria-hidden="true" />
              <span className="v2-tour-navlabel">{item}</span>
            </span>
          ))}
        </nav>
      </aside>
      <div className="v2-tour-main">{children}</div>
    </div>
  );
}

/** Base workspace — always rendered; modals layer above it. */
export function ActiveChasingScene({ dimmed = false, sentState = false }: { dimmed?: boolean; sentState?: boolean }) {
  const stats = [
    { label: "Active invoices", value: "3", sub: "being chased" },
    { label: "Outstanding", value: "£2,400", sub: "across active invoices" },
    { label: "Overdue", value: "3", sub: "past due date", tone: "amber" },
    {
      label: "Reminders ready",
      value: sentState ? "2" : "3",
      sub: "awaiting your approval",
      tone: "blue",
    },
  ];

  return (
    <div className={`v2-tour-scene${dimmed ? " is-dimmed" : ""}`}>
      <h3 className="v2-tour-h">Active Chasing</h3>
      <p className="v2-tour-p">Unpaid invoices in the normal reminder loop. Prepare reminders to chase payment.</p>

      <div className="v2-tour-stats">
        {stats.map((s) => (
          <div key={s.label} className="v2-tour-stat">
            <span className="v2-tour-stat-l">{s.label}</span>
            <span className={`v2-tour-stat-v${s.tone ? ` t-${s.tone}` : ""}`}>{s.value}</span>
            <span className="v2-tour-stat-s">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="v2-tour-table">
        {ROWS.map((r) => {
          const isHero = r.focus;
          const heroSent = isHero && sentState;
          return (
            <div key={r.reference} className={`v2-tour-row${isHero ? " is-focus" : ""}`}>
              <span className="v2-tour-av" aria-hidden="true">{initialsOf(r.name)}</span>
              <span className="v2-tour-id">
                <span className="v2-tour-name">{r.name}</span>
                <span className="v2-tour-meta">{r.reference} · {r.overdue}</span>
              </span>
              <span className="v2-tour-amt">{r.amount}</span>
              <span className="v2-tour-badges">
                <span className="v2-chip c-overdue">Overdue</span>
                <span className={`v2-chip ${heroSent ? "c-sent" : r.state === "Reminder sent" ? "c-sent" : "c-ready"}`}>
                  {heroSent ? "Reminder sent" : r.state}
                </span>
              </span>
              <span className="v2-tour-acts">
                {isHero && !heroSent ? <span className="v2-act-primary">Send now</span> : null}
                {isHero && heroSent ? <span className="v2-act-quiet">Awaiting payment</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Modal frame shared by steps 2–4. */
function Modal({ title, sub, children, footer }: { title: string; sub?: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="v2-tour-overlay">
      <div className="v2-tour-modal">
        <div className="v2-tour-modal-head">
          <span className="v2-tour-modal-title">{title}</span>
          {sub ? <span className="v2-tour-modal-sub">{sub}</span> : null}
        </div>
        <div className="v2-tour-modal-body">{children}</div>
        <div className="v2-tour-modal-foot">{footer}</div>
      </div>
    </div>
  );
}

/** Step 2 — channel selection. SMS primary, email supporting. */
export function ChannelScene() {
  return (
    <Modal title="Choose reminder channels" sub={`${DEMO.customerName} · ${DEMO.reference} · ${DEMO.amount}`}
      footer={<><span className="v2-mbtn ghost">Cancel</span><span className="v2-mbtn primary">Preview reminder</span></>}>
      <div className="v2-chan is-primary">
        <span className="v2-check is-on" aria-hidden="true">✓</span>
        <span>
          <span className="v2-chan-t">SMS <span className="v2-chan-tag">Primary</span></span>
          <span className="v2-chan-d">Short, direct reminder straight to their phone.</span>
        </span>
      </div>
      <div className="v2-chan">
        <span className="v2-check is-on" aria-hidden="true">✓</span>
        <span>
          <span className="v2-chan-t">Email <span className="v2-chan-tag quiet">Supporting</span></span>
          <span className="v2-chan-d">The fuller reminder, with the invoice detail.</span>
        </span>
      </div>
      <p className="v2-tour-note">Nothing sends yet — you&rsquo;ll review the message next.</p>
    </Modal>
  );
}

/** Step 3 — message preview. SMS given priority, email secondary. */
export function PreviewScene() {
  return (
    <Modal title="Review the message" sub={`${DEMO.customerName} · ${DEMO.reference} · ${DEMO.amount}`}
      footer={<><span className="v2-mbtn ghost">Back</span><span className="v2-mbtn primary">Approve and send</span></>}>
      <div className="v2-prev-tabs" aria-hidden="true">
        <span className="v2-prev-tab is-on">SMS</span>
        <span className="v2-prev-tab">Email</span>
      </div>
      <div className="v2-prev-sms">
        <span className="v2-prev-from">From {DEMO.businessName}</span>
        <p className="v2-prev-body">{DEMO.sms}</p>
      </div>
      <div className="v2-prev-email">
        <span className="v2-prev-label">Email · supporting</span>
        <span className="v2-prev-subj">{DEMO.emailSubject}</span>
      </div>
      <p className="v2-tour-note">Still nothing sent. You decide what happens next.</p>
    </Modal>
  );
}

/**
 * Step 4 — the owner approves. Only after that action does anything send.
 *
 * `Approve and send` is a real button so it works with mouse, keyboard and
 * touch. Until it is activated, the invoice stays Ready to send and the
 * dashboard behind is unchanged.
 */
export function ApprovalScene({
  done,
  onApprove,
  onReset,
  interactive,
}: {
  done: boolean;
  onApprove: () => void;
  onReset: () => void;
  interactive: boolean;
}) {
  if (done) {
    return (
      <Modal title="Reminder sent" sub={`${DEMO.customerName} · ${DEMO.reference}`}
        footer={
          <button type="button" className="v2-mbtn primary" onClick={onReset} tabIndex={interactive ? 0 : -1}>
            Done
          </button>
        }>
        <div className="v2-done">
          <span className="v2-done-ico" aria-hidden="true">✓</span>
          <p className="v2-done-t">Sent by SMS and email</p>
          <p className="v2-done-s">You approved it — {DEMO.businessName} stays in control of every message.</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Approve and send" sub="Your decision — nothing has been sent"
      footer={
        <>
          <span className="v2-mbtn ghost" aria-hidden="true">Back</span>
          <button type="button" className="v2-mbtn primary" onClick={onApprove} tabIndex={interactive ? 0 : -1}>
            Approve and send
          </button>
        </>
      }>
      <div className="v2-sum">
        <div className="v2-sum-row"><span>Customer</span><strong>{DEMO.customerName}</strong></div>
        <div className="v2-sum-row"><span>Invoice</span><strong>{DEMO.reference}</strong></div>
        <div className="v2-sum-row"><span>Amount</span><strong>{DEMO.amount}</strong></div>
        <div className="v2-sum-row"><span>Channels</span><strong>SMS + email</strong></div>
        <div className="v2-sum-row"><span>Status</span><strong className="t-amber">Awaiting your approval</strong></div>
      </div>
    </Modal>
  );
}
