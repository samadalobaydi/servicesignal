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
    "ServiceSignal prepares professional email reminders for overdue invoices. You review each one before it sends and stay in control.",
};

/**
 * Landing Page 2.0 — preview route.
 *
 * Navigation, hero product tour, customer view and founding beta access.
 */
export default function LandingV2() {
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
