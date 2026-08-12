import type { Metadata } from "next";
import Nav from "@/components/v2/Nav";
import Hero from "@/components/v2/Hero";
import CustomerMessageSection from "@/components/v2/CustomerMessageSection";
import FitsProcessSection from "@/components/v2/FitsProcessSection";
import OutcomesBand from "@/components/v2/OutcomesBand";
import FaqSection from "@/components/v2/FaqSection";
import FoundingBetaSection from "@/components/v2/FoundingBetaSection";
import SiteFooter from "@/components/v2/SiteFooter";

export const metadata: Metadata = {
  title: "ServiceSignal — Unpaid invoices, followed up without you chasing",
  description:
    "ServiceSignal prepares professional reminders for your overdue invoices. You review and approve every message before anything is sent.",
};

/**
 * The ServiceSignal landing page.
 *
 * Navigation, hero product tour, customer view and founding beta access.
 *
 * ── PROMOTED FROM /v2, UNCHANGED ──────────────────────────────────────────
 *
 * This is the approved Landing Page 2.0 implementation, moved here verbatim
 * from app/v2/page.tsx. Nothing about what it renders was edited during the
 * move: same components, same order, same `v2-root` class, same metadata.
 *
 * `/v2` is now a redirect to `/` (see next.config.js). It is a redirect rather
 * than a second page on purpose — two independently rendered public URLs for
 * one landing page is exactly how the old and new versions drifted apart, and
 * how every Preview kept opening the superseded design.
 *
 * The previous landing page's components (components/Nav, Hero, Problem,
 * HowItWorks, Features, WhoItsFor, Pricing, FAQ, BetaSignup, Footer) were
 * imported ONLY by this file. They are now unreferenced. They have been left
 * in place rather than deleted, because removing them is a separate cleanup
 * with its own review — but nothing renders them any more.
 */
export default function Home() {
  return (
    <main className="v2-root">
      <Nav />

      {/* Section 1 — Hero (frozen) */}
      <Hero />

      {/* Section 2 — Professional follow-up */}
      <CustomerMessageSection />

      {/* Section 3 — Fits your process */}
      <FitsProcessSection />

      {/* Section 4 — Outcomes */}
      <OutcomesBand />

      {/* Section 5 — FAQ */}
      <FaqSection />

      {/* Section 6 — Founding beta access */}
      <FoundingBetaSection />

      {/* Footer */}
      <SiteFooter />
    </main>
  );
}
