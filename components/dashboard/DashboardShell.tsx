"use client";

import { useState } from "react";
import Link from "next/link";

interface DashboardShellProps {
  children: React.ReactNode;
  activeTab: "overview" | "invoices" | "add";
  onTabChange: (tab: "overview" | "invoices" | "add") => void;
}

export default function DashboardShell({
  children,
  activeTab,
  onTabChange,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    {
      id: "overview" as const,
      label: "Overview",
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
          <path
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      id: "invoices" as const,
      label: "Invoices",
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
          <path
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      id: "add" as const,
      label: "Add Invoice",
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 4v16m8-8H4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ),
      highlight: true,
    },
  ];

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <aside
      className={
        mobile
          ? "flex flex-col h-full"
          : "hidden lg:flex flex-col w-56 min-h-screen border-r border-[rgba(0,200,255,0.08)] bg-[#05080f]"
      }
      style={mobile ? {} : { position: "sticky", top: 0, height: "100vh" }}
    >
      {/* Logo */}
      <div className="p-5 border-b border-[rgba(0,200,255,0.08)]">
        {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
        <Link href="/v2" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#00c8ff] flex items-center justify-center flex-shrink-0">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L14 13H2L8 1Z" fill="#0a0e1a" />
              <circle cx="8" cy="10" r="1.5" fill="#00c8ff" />
            </svg>
          </div>
          <span
            className="font-display text-white text-base"
            style={{ fontWeight: 800, letterSpacing: "0.04em" }}
          >
            SERVICE<span className="text-[#00c8ff]">SIGNAL</span>
          </span>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onTabChange(item.id);
                setSidebarOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all"
              style={{
                background: active
                  ? item.highlight
                    ? "#00c8ff"
                    : "rgba(0,200,255,0.1)"
                  : item.highlight
                  ? "rgba(0,200,255,0.08)"
                  : "transparent",
                color: active
                  ? item.highlight
                    ? "#05080f"
                    : "#00c8ff"
                  : item.highlight
                  ? "#00c8ff"
                  : "#94a3b8",
                border: item.highlight && !active
                  ? "1px solid rgba(0,200,255,0.25)"
                  : "1px solid transparent",
                fontWeight: active || item.highlight ? 600 : 400,
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Back to site */}
      <div className="p-4 border-t border-[rgba(0,200,255,0.08)]">
        {/* REVIEW BRANCH: points at the /v2 preview. Change back to "/" when v2 becomes the root landing page. */}
        <Link
          href="/v2"
          className="flex items-center gap-2 text-xs text-[#475569] hover:text-[#94a3b8] transition-colors"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to landing page
        </Link>
        <p className="text-[10px] text-[#2d3748] mt-3">
          MVP · localStorage mode
        </p>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen" style={{ background: "#0a0e1a" }}>
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div
            className="relative w-64 h-full z-10"
            style={{ background: "#05080f", borderRight: "1px solid rgba(0,200,255,0.1)" }}
          >
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[rgba(0,200,255,0.08)] sticky top-0 z-40"
          style={{ background: "#05080f" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[#94a3b8] hover:text-white p-1"
            aria-label="Open menu"
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span
            className="font-display text-white text-sm"
            style={{ fontWeight: 800, letterSpacing: "0.04em" }}
          >
            SERVICE<span className="text-[#00c8ff]">SIGNAL</span>
          </span>
          <button
            onClick={() => onTabChange("add")}
            className="text-[#00c8ff] hover:text-white p-1"
            aria-label="Add invoice"
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
              <path
                d="M12 4v16m8-8H4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
