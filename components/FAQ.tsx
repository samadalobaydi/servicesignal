"use client";

import { useState } from "react";

const faqs = [
  {
    q: "Do I need to connect my accounting software?",
    a: "No. ServiceSignal works standalone. You add invoices manually (name, amount, due date). In a future version we'll offer Xero and QuickBooks integration, but for now there's nothing to connect — just type in your invoice and go.",
  },
  {
    q: "Will customers know the reminders are automated?",
    a: "No. Reminders go out from your business name and email/phone number. They look and feel like a reminder you sent yourself. Most customers won't know the difference — they'll just see a professional message from your business.",
  },
  {
    q: "What happens when a customer pays?",
    a: "You mark the invoice as paid in one click. The reminders stop immediately. Simple as that. You keep a full log of all messages sent so you have a record if you ever need it.",
  },
  {
    q: "How many reminders does it send?",
    a: "You decide. You set the schedule — for example: 3 days before due, on the due date, 7 days overdue, 14 days overdue. You control how many reminders go out and when. We recommend 3–4 reminders per invoice.",
  },
  {
    q: "Can I customise the reminder messages?",
    a: "Yes. You'll be able to edit the message templates to match your tone. Want to be firm? Polite? Add a payment link? You control it. We provide professional defaults that work out of the box.",
  },
  {
    q: "Does it work on mobile?",
    a: "The web dashboard is mobile-friendly so you can check your invoices on the go. A dedicated iOS/Android app is on the roadmap for after beta.",
  },
  {
    q: "What is the beta?",
    a: "We're building ServiceSignal and we want real tradesmen involved from day one. Beta users get free access, a say in what we build next, and their pricing locked in for life once we go public. In return, we ask for honest feedback.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. We use enterprise-grade cloud infrastructure (Supabase / Vercel). Your customer data is encrypted at rest and in transit. We never share or sell your data. Full privacy policy available before launch.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border-b border-[rgba(255,255,255,0.06)] last:border-b-0"
    >
      <button
        className="w-full flex items-center justify-between py-5 text-left gap-4"
        onClick={() => setOpen(!open)}
      >
        <span
          className="font-display text-white"
          style={{ fontSize: "1.05rem", fontWeight: 600 }}
        >
          {q}
        </span>
        <span
          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all"
          style={{
            background: open ? "rgba(0,200,255,0.15)" : "rgba(255,255,255,0.05)",
            border: open ? "1px solid rgba(0,200,255,0.3)" : "1px solid rgba(255,255,255,0.08)",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "all 0.2s ease",
          }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 5v14M5 12h14"
              stroke={open ? "#00c8ff" : "#94a3b8"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="pb-5">
          <p className="text-[#94a3b8] leading-relaxed text-sm">{a}</p>
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
      style={{ background: "#0a0e1a" }}
    >
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <p
            className="font-display font-600 text-[#00c8ff] mb-3 tracking-widest text-sm uppercase"
            style={{ fontWeight: 600, letterSpacing: "0.15em" }}
          >
            FAQ
          </p>
          <h2
            className="font-display text-white mb-4"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            COMMON QUESTIONS.{" "}
            <span className="text-[#00c8ff]">STRAIGHT ANSWERS.</span>
          </h2>
        </div>

        <div className="card p-2 sm:p-6">
          {faqs.map((faq, i) => (
            <FAQItem key={i} q={faq.q} a={faq.a} />
          ))}
        </div>

        <p className="text-center text-[#64748b] text-sm mt-8">
          Got a question not answered here?{" "}
          <a
            href="mailto:hello@servicesignal.co.uk"
            className="text-[#00c8ff] hover:underline"
          >
            hello@servicesignal.co.uk
          </a>
        </p>
      </div>
    </section>
  );
}
