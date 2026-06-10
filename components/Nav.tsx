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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0a0e1a]/95 backdrop-blur-md border-b border-[rgba(0,200,255,0.08)]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-[#00c8ff] flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1L14 13H2L8 1Z" fill="#0a0e1a" stroke="#0a0e1a" strokeWidth="0.5" />
              <circle cx="8" cy="10" r="1.5" fill="#00c8ff" />
            </svg>
          </div>
          <span
            className="font-display font-800 text-xl tracking-wide text-white"
            style={{ fontWeight: 800, letterSpacing: "0.04em" }}
          >
            SERVICE<span className="text-[#00c8ff]">SIGNAL</span>
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm text-[#94a3b8]">
          <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          {/* Dashboard labelled clearly as beta preview — not a finished product */}
          <Link
            href="/dashboard"
            className="hover:text-[#00c8ff] transition-colors text-[#94a3b8] flex items-center gap-1.5"
          >
            Dashboard
            <span
              className="text-xs font-display px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.2)",
                color: "#00c8ff",
                fontWeight: 600,
                letterSpacing: "0.06em",
                fontSize: "0.6rem",
              }}
            >
              PREVIEW
            </span>
          </Link>
        </nav>

        {/* CTA */}
        <a href="#signup" className="btn-primary hidden md:inline-block" style={{ padding: "0.6rem 1.5rem", fontSize: "0.9rem" }}>
          Join the Beta
        </a>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-[#94a3b8] hover:text-white"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-[#0f1628] border-t border-[rgba(0,200,255,0.08)] px-6 py-4 flex flex-col gap-4">
          <a href="#how-it-works" className="text-[#94a3b8] hover:text-white py-1" onClick={() => setMenuOpen(false)}>How It Works</a>
          <a href="#features" className="text-[#94a3b8] hover:text-white py-1" onClick={() => setMenuOpen(false)}>Features</a>
          <a href="#pricing" className="text-[#94a3b8] hover:text-white py-1" onClick={() => setMenuOpen(false)}>Pricing</a>
          <a href="#faq" className="text-[#94a3b8] hover:text-white py-1" onClick={() => setMenuOpen(false)}>FAQ</a>
          <Link
            href="/dashboard"
            className="text-[#00c8ff] hover:text-white py-1 flex items-center gap-2"
            onClick={() => setMenuOpen(false)}
          >
            Dashboard
            <span
              className="text-xs font-display px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.2)",
                color: "#00c8ff",
                fontWeight: 600,
                letterSpacing: "0.06em",
                fontSize: "0.6rem",
              }}
            >
              PREVIEW
            </span>
          </Link>
          <a href="#signup" className="btn-primary text-center" style={{ padding: "0.6rem 1.5rem" }} onClick={() => setMenuOpen(false)}>
            Join the Beta
          </a>
        </div>
      )}
    </header>
  );
}
