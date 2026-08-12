"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Component 1 — Navigation.
 * Calm entry point. One primary action. Restrained sticky behaviour.
 */
export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Deliberately not a table of contents — two waypoints only. Everything
     else is found by scrolling. "Access" is not a text link because it would
     duplicate the Join the founding beta button beside it.
     Every founding-beta CTA on this page — header, mobile menu, hero and the
     form's own submit — uses the same label and the same #access target. */
  const links = [
    { href: "#tour", label: "How it works" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(255,255,255,0.88)" : "rgba(251,252,254,0.6)",
        backdropFilter: "blur(14px)",
        borderBottom: scrolled ? "1px solid var(--v2-line)" : "1px solid transparent",
      }}
    >
      <div className="v2-section flex items-center justify-between" style={{ height: 64 }}>
        <Link href="/" className="flex items-center gap-2.5" style={{ textDecoration: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/servicesignal-mark.png" alt="ServiceSignal" className="v2-nav-mark" />
          <span className="v2-nav-word" style={{ fontWeight: 700, color: "var(--v2-ink)", letterSpacing: "-0.01em" }}>
            Service<span style={{ color: "var(--v2-blue)" }}>Signal</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8" style={{ fontSize: "0.9rem", color: "var(--v2-muted)" }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="v2-navlink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login" className="v2-navlink v2-navlink-signin hidden sm:inline">
            Sign in
          </Link>
          <a href="#access" className="lp-btn hidden md:inline-flex" style={{ background: "var(--v2-blue)", padding: "0.5rem 1.15rem", fontSize: "0.9rem" }}>
            Join the founding beta
          </a>
          <button
            className="md:hidden"
            style={{ color: "var(--v2-muted)" }}
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              {open ? (
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden px-6 py-4 flex flex-col gap-4" style={{ background: "#fff", borderTop: "1px solid var(--v2-line)" }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="v2-navlink-m" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <Link href="/login" className="v2-navlink-m" onClick={() => setOpen(false)}>
            Sign in
          </Link>
          <a href="#access" className="lp-btn" style={{ background: "var(--v2-blue)" }} onClick={() => setOpen(false)}>
            Join the founding beta
          </a>
        </div>
      )}
    </header>
  );
}
