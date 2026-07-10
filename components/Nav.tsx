"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(255,255,255,0.9)" : "rgba(246,248,251,0.6)",
        backdropFilter: "blur(12px)",
        borderBottom: scrolled ? "1px solid #e5e7eb" : "1px solid transparent",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#0ea5c4" }}>
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 13H2L8 1Z" fill="#ffffff" />
              <circle cx="8" cy="10" r="1.5" fill="#0ea5c4" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: "1.25rem", color: "#0f172a", letterSpacing: "-0.01em" }}>
            Service<span style={{ color: "#0ea5c4" }}>Signal</span>
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm" style={{ color: "#64748b" }}>
          <a href="#how-it-works" className="transition-colors hover:text-[#0f172a]">How it works</a>
          <a href="#features" className="transition-colors hover:text-[#0f172a]">Features</a>
          <a href="#pricing" className="transition-colors hover:text-[#0f172a]">Pricing</a>
          <a href="#faq" className="transition-colors hover:text-[#0f172a]">FAQ</a>
          <Link href="/dashboard" className="flex items-center gap-1.5 transition-colors hover:text-[#0891b2]" style={{ color: "#64748b" }}>
            Dashboard
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#ecfeff", border: "1px solid #a5f0fa", color: "#0891b2", fontWeight: 600, fontSize: "0.6rem", letterSpacing: "0.04em" }}>
              PREVIEW
            </span>
          </Link>
        </nav>

        {/* CTA */}
        <a href="#signup" className="lp-btn hidden md:inline-flex" style={{ padding: "0.55rem 1.3rem", fontSize: "0.9rem" }}>
          Join the beta
        </a>

        {/* Mobile hamburger */}
        <button className="md:hidden" style={{ color: "#64748b" }} onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? (
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          ) : (
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden px-6 py-4 flex flex-col gap-4" style={{ background: "#ffffff", borderTop: "1px solid #e5e7eb" }}>
          <a href="#how-it-works" className="py-1" style={{ color: "#64748b" }} onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#features" className="py-1" style={{ color: "#64748b" }} onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#pricing" className="py-1" style={{ color: "#64748b" }} onClick={() => setMenuOpen(false)}>Pricing</a>
          <a href="#faq" className="py-1" style={{ color: "#64748b" }} onClick={() => setMenuOpen(false)}>FAQ</a>
          <Link href="/dashboard" className="py-1 flex items-center gap-2" style={{ color: "#0891b2" }} onClick={() => setMenuOpen(false)}>
            Dashboard
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#ecfeff", border: "1px solid #a5f0fa", color: "#0891b2", fontWeight: 600, fontSize: "0.6rem", letterSpacing: "0.04em" }}>
              PREVIEW
            </span>
          </Link>
          <a href="#signup" className="lp-btn" style={{ padding: "0.6rem 1.5rem" }} onClick={() => setMenuOpen(false)}>
            Join the beta
          </a>
        </div>
      )}
    </header>
  );
}
