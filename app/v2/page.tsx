import type { Metadata } from "next";
import Nav from "@/components/v2/Nav";
import Hero from "@/components/v2/Hero";
import CustomerMessageSection from "@/components/v2/CustomerMessageSection";
import FoundingBetaSection from "@/components/v2/FoundingBetaSection";

export const metadata: Metadata = {
  title: "ServiceSignal — Unpaid invoices, followed up without you chasing",
  description:
    "ServiceSignal prepares professional SMS and email reminders for overdue invoices. You review them, send them and stay in control.",
};

/**
 * Landing Page 2.0 — preview route.
 *
 * Navigation and the hero product tour only. Later sections are not built.
 */
export default function LandingV2() {
  return (
    <main className="v2-root">
      <Nav />

      {/* Section 1 — Hero (frozen) */}
      <Hero />

      {/* Section 2 — What your customer actually gets */}
      <CustomerMessageSection />

      {/* Section 3 — Founding beta access */}
      <FoundingBetaSection />
    </main>
  );
}
