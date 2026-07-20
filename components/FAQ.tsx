"use client";

import { useState } from "react";

const faqs = [
  {
    q: "Do I need to connect my accounting software?",
    a: "No. ServiceSignal works standalone. You add invoices manually (name, amount, due date). In a future version we'll offer Xero and QuickBooks integration, but for now there's nothing to connect — just type in your invoice and go.",
  },
  {
    q: "Will customers know the reminders are automated?",
    a: "No. Reminders are branded with your business name, so they look and feel like a message you sent yourself. Approval Mode is the default: ServiceSignal prepares each reminder and nothing sends until you review and approve it. Auto Mode is also available as an optional setting for users who want reminders to send automatically, but you stay in control.",
  },
  {
    q: "What happens when a customer pays?",
    a: "You mark the invoice as paid in one click. The reminders stop immediately. Simple as that. You keep a full log of all messages sent so you have a record if you ever need it.",
  },
  {
    q: "How many reminders does it send?",
    a: "You decide. You set the schedule — for example: 3 days before due, on the due date, 7 days overdue, 14 days overdue. ServiceSignal prepares each email reminder for you to review and approve before it sends, so you control how many go out and when. SMS reminders are coming soon.",
  },
  {
    q: "Can I customise the reminder messages?",
    a: "ServiceSignal comes with professional reminder templates in a few tones (friendly, firm, final) that work out of the box. You choose the tone per invoice, and you review each reminder before it sends. Deeper template editing is on the roadmap.",
  },
  {
    q: "Do you send SMS reminders?",
    a: "Not yet — email reminders are live now, and SMS reminders are coming soon. If you add your phone number when you join the beta, we'll keep you posted when SMS is ready to try.",
  },
  {
    q: "Does it work on mobile?",
    a: "The web dashboard is mobile-friendly so you can check your invoices on the go from your phone's browser. A dedicated iOS/Android app is on the roadmap for after beta.",
  },
  {
    q: "What is the beta?",
    a: "We're building ServiceSignal and we want real tradesmen involved from day one. Beta users get free access, a say in what we build next, and their pricing locked in for life once we go public. In return, we ask for honest feedback.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. We use established cloud infrastructure (Supabase and Vercel), and your data is encrypted in transit and at rest. We never share or sell your customer data. A full privacy policy will be published before public launch.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border-b border-[#e5e7eb] last:border-b-0"
    >
      <button
        className="w-full flex items-center justify-between py-5 text-left gap-4"
        onClick={() => setOpen(!open)}
      >
        <span
          className="font-display text-[#0f172a]"
          style={{ fontSize: "1.05rem", fontWeight: 600 }}
        >
          {q}
        </span>
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all"
          style={{
            background: open ? "#a5f0fa" : "#f8fafc",
            border: open ? "1px solid #0ea5c4" : "1px solid #e5e7eb",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "all 0.2s ease",
          }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 5v14M5 12h14"
              stroke={open ? "#0ea5c4" : "#94a3b8"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="pb-5">
          <p className="text-[#64748b] leading-relaxed text-sm">{a}</p>
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  return (
    <section
      id="faq"
      className="section bg-grid"
      style={{ background: "#ffffff" }}
    >
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <p
            className="font-display font-600 text-[#0ea5c4] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            FAQ
          </p>
          <h2
            className="font-display text-[#0f172a] mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            Common questions,{" "}
            <span className="text-[#0ea5c4]">straight answers</span>
          </h2>
        </div>

        <div className="lp-card p-2 sm:p-6">
          {faqs.map((faq, i) => (
            <FAQItem key={i} q={faq.q} a={faq.a} />
          ))}
        </div>

        <p className="text-center text-[#94a3b8] text-sm mt-8">
          Got a question not answered here?{" "}
          <a
            href="mailto:hello@servicesignal.co.uk"
            className="text-[#0ea5c4] hover:underline"
          >
            hello@servicesignal.co.uk
          </a>
        </p>
      </div>
    </section>
  );
}
