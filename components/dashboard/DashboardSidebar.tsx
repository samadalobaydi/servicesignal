"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useDashboard } from "./DashboardProvider";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badgeKey?: "needs_action";
}

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        icon: (
          <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    heading: "Invoices",
    items: [
      {
        href: "/dashboard/chasing",
        label: "Active Chasing",
        icon: (
          <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: "/dashboard/needs-action",
        label: "Needs Action",
        badgeKey: "needs_action",
        icon: (
          <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
            <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: "/dashboard/paid",
        label: "Paid Invoices",
        icon: (
          <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    heading: "Account",
    items: [
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: (
          <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex items-center justify-center rounded-full text-xs flex-shrink-0"
      style={{ background: "#f59e0b", color: "#1a1206", minWidth: 20, height: 20, fontWeight: 700, padding: "0 6px" }}
    >
      {count}
    </span>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { needsActionCount } = useDashboard();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  const handleLogout = async () => {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      {/* ── Desktop: left sidebar ── */}
      <aside
        className="hidden md:flex md:flex-col md:w-[248px] md:flex-shrink-0 md:fixed md:inset-y-0 md:left-0 z-30"
        style={{ background: "var(--dash-sidebar-desktop)" }}
      >
        {/* Logo — approved transparent PNG (v8.5.4). Fills the sidebar width
            with ~18px side padding, aspect preserved, vertically centred;
            transparency lets the sidebar colour show through. */}
        <div className="flex items-center justify-center px-[18px] py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Image
            src="/branding/servicesignal.png"
            alt="ServiceSignal"
            width={7500}
            height={3025}
            priority
            style={{ width: "100%", height: "auto" }}
          />
        </div>

        {/* Nav groups */}
        <nav className="flex-1 px-3.5 py-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="mb-6">
              <p className="px-2.5 mb-2 text-xs uppercase" style={{ color: "rgba(148,163,184,0.7)", fontWeight: 600, letterSpacing: "0.08em" }}>
                {group.heading}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg transition-colors"
                      style={{
                        background: active ? "var(--dash-sidebar-active)" : "transparent",
                        color: active ? "#ffffff" : "#cbd5e1",
                      }}
                    >
                      <span style={{ color: active ? "#38bdf8" : "#94a3b8" }}>{item.icon}</span>
                      <span className="text-sm" style={{ fontWeight: active ? 600 : 500 }}>
                        {item.label}
                      </span>
                      {item.badgeKey === "needs_action" && <NavBadge count={needsActionCount} />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3.5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg transition-colors"
            style={{ color: "#94a3b8" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
          >
            <svg width="19" height="19" fill="none" viewBox="0 0 24 24">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm" style={{ fontWeight: 500 }}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile: top bar + tabs ── */}
      <div className="md:hidden sticky top-0 z-30" style={{ background: "var(--dash-sidebar)" }}>
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--dash-accent)" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L14 13H2L8 1Z" fill="#0f172a" />
                <circle cx="8" cy="10" r="1.5" fill="#0f172a" />
              </svg>
            </div>
            <span className="text-white" style={{ fontWeight: 700, fontSize: "1rem" }}>
              Service<span style={{ color: "#38bdf8" }}>Signal</span>
            </span>
          </div>
          <button onClick={handleLogout} className="text-sm" style={{ color: "#94a3b8", fontWeight: 500 }}>
            Sign out
          </button>
        </div>
        <nav className="flex gap-1.5 px-3 pb-2.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {ALL_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap flex-shrink-0 transition-colors"
                style={{
                  background: active ? "var(--dash-sidebar-active)" : "rgba(255,255,255,0.04)",
                  color: active ? "#ffffff" : "#cbd5e1",
                }}
              >
                <span className="text-sm" style={{ fontWeight: active ? 600 : 500 }}>{item.label}</span>
                {item.badgeKey === "needs_action" && <NavBadge count={needsActionCount} />}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
