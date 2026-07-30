import type { Metadata } from "next";
import Nav from "@/components/v2/Nav";
import Hero from "@/components/v2/Hero";
import CustomerMessageSection from "@/components/v2/CustomerMessageSection";
import FoundingBetaSection from "@/components/v2/FoundingBetaSection";

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

      {/* Section 2 — What your customer actually gets */}
      <CustomerMessageSection />

      {/* Section 3 — Founding beta access */}
      <FoundingBetaSection />
    </main>
  );
}
