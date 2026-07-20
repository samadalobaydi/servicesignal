import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Problem from "@/components/Problem";
import HowItWorks from "@/components/HowItWorks";
import Features from "@/components/Features";
import WhoItsFor from "@/components/WhoItsFor";
import Pricing from "@/components/Pricing";
import FAQ from "@/components/FAQ";
import BetaSignup from "@/components/BetaSignup";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="lp-root">
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <WhoItsFor />
      <Pricing />
      <FAQ />
      <BetaSignup />
      <Footer />
    </main>
  );
}
