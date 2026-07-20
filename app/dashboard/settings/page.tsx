"use client";

import { useDashboard } from "@/components/dashboard/DashboardProvider";
import SettingsCard from "@/components/dashboard/SettingsCard";

export default function SettingsPage() {
  const { profile, userEmail, setProfile, stats, buckets } = useDashboard();

  const modeLabel = profile?.reminder_mode === "auto" ? "Auto Mode" : "Approval Mode";
  const modeColor = profile?.reminder_mode === "auto" ? "var(--dash-green)" : "var(--dash-accent-strong)";
  const businessName = profile?.business_name?.trim();

  return (
    <div className="space-y-6">
      <div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, color: "var(--dash-text)", letterSpacing: "-0.02em" }}>
          Settings
        </h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
          Manage your business details and how reminders are sent to your customers.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main settings card */}
        <div className="lg:col-span-2">
          {profile ? (
            <SettingsCard profile={profile} userEmail={userEmail} onUpdated={setProfile} />
          ) : (
            <div className="dash-card p-6">
              <p className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Loading your settings…</p>
            </div>
          )}
        </div>

        {/* Account summary side panel */}
        <div className="space-y-4">
          <div className="dash-card p-5">
            <p className="text-xs uppercase mb-3" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
              Account
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs" style={{ color: "var(--dash-text-soft)" }}>Signed in as</p>
                <p className="text-sm truncate" style={{ color: "var(--dash-text)", fontWeight: 500 }} title={userEmail}>{userEmail || "—"}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--dash-text-soft)" }}>Business name</p>
                <p className="text-sm" style={{ color: businessName ? "var(--dash-text)" : "var(--dash-text-soft)", fontWeight: 500 }}>
                  {businessName || "Not set — emails use your address"}
                </p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--dash-text-soft)" }}>Sending mode</p>
                <p className="text-sm" style={{ color: modeColor, fontWeight: 600 }}>{modeLabel}</p>
              </div>
            </div>
          </div>

          <div className="dash-card p-5">
            <p className="text-xs uppercase mb-3" style={{ color: "var(--dash-text-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>
              At a glance
            </p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Active invoices</span>
                <span className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>{buckets.chasing.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Needs action</span>
                <span className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>{buckets.needs_action.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Paid invoices</span>
                <span className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>{buckets.paid.length}</span>
              </div>
              <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid var(--dash-border)" }}>
                <span className="text-sm" style={{ color: "var(--dash-text-muted)" }}>Overdue</span>
                <span className="text-sm" style={{ color: stats.overdueCount > 0 ? "var(--dash-amber)" : "var(--dash-text)", fontWeight: 600 }}>{stats.overdueCount}</span>
              </div>
            </div>
          </div>

          <div className="dash-card p-5" style={{ background: "var(--dash-accent-soft)", border: "1px solid #bae6fd" }}>
            <p className="text-sm" style={{ color: "var(--dash-text)", fontWeight: 600 }}>How reminders work</p>
            <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.5 }}>
              In Approval Mode, ServiceSignal prepares reminders and waits for you to send them. In Auto Mode, they send on schedule automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
