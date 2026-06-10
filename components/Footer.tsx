export default function Footer() {
  return (
    <footer
      style={{
        background: "#05080f",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded bg-[#00c8ff] flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1L14 13H2L8 1Z" fill="#0a0e1a" />
                  <circle cx="8" cy="10" r="1.5" fill="#00c8ff" />
                </svg>
              </div>
              <span
                className="font-display font-800 text-base text-white"
                style={{ fontWeight: 800, letterSpacing: "0.04em" }}
              >
                SERVICE<span className="text-[#00c8ff]">SIGNAL</span>
              </span>
            </div>
            <p className="text-[#64748b] text-sm leading-relaxed max-w-xs">
              Stop chasing late payments manually. ServiceSignal automatically
              follows up with customers who have unpaid invoices.
            </p>
          </div>

          {/* Links */}
          <div>
            <p
              className="font-display font-600 text-white text-sm mb-4 uppercase tracking-wider"
              style={{ fontWeight: 600, letterSpacing: "0.1em" }}
            >
              Product
            </p>
            <ul className="space-y-2">
              {[
                { label: "How It Works", href: "#how-it-works" },
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
                { label: "FAQ", href: "#faq" },
                { label: "Join the Beta", href: "#signup" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-[#64748b] hover:text-white text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p
              className="font-display font-600 text-white text-sm mb-4 uppercase tracking-wider"
              style={{ fontWeight: 600, letterSpacing: "0.1em" }}
            >
              Contact
            </p>
            <ul className="space-y-2">
              <li>
                <a
                  href="mailto:hello@servicesignal.co.uk"
                  className="text-[#64748b] hover:text-[#00c8ff] text-sm transition-colors"
                >
                  hello@servicesignal.co.uk
                </a>
              </li>
            </ul>
            <div className="mt-6">
              <a href="#signup" className="btn-primary" style={{ padding: "0.6rem 1.5rem", fontSize: "0.85rem" }}>
                Join Beta →
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#475569]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
        >
          <p>
            &copy; {new Date().getFullYear()} ServiceSignal. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-[#94a3b8] transition-colors">
              Privacy Policy
            </a>
            <a href="#" className="hover:text-[#94a3b8] transition-colors">
              Terms of Service
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
