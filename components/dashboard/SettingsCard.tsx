"use client";

import { useState } from "react";
import type { Profile, ReminderMode } from "@/types";
import { updateProfile } from "@/lib/profile";

interface SettingsCardProps {
  profile: Profile;
  userEmail: string;
  onUpdated: (profile: Profile) => void;
}

export default function SettingsCard({ profile, userEmail, onUpdated }: SettingsCardProps) {
  const [businessName, setBusinessName] = useState(profile.business_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveBusinessName = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const result = await updateProfile({ business_name: businessName.trim() });

    if (result.success && result.profile) {
      onUpdated(result.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(result.message ?? "Failed to save.");
    }
    setSaving(false);
  };

  const setReminderMode = async (mode: ReminderMode) => {
    setError(null);
    const result = await updateProfile({ reminder_mode: mode });
    if (result.success && result.profile) {
      onUpdated(result.profile);
    } else {
      setError(result.message ?? "Failed to update mode.");
    }
  };

  return (
    <div className="dash-card overflow-hidden">
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--dash-border)" }}>
        <h2 style={{ fontWeight: 650, fontSize: "1.05rem", color: "var(--dash-text)" }}>
          Reminder Settings
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
          Controls how reminder emails identify your business and whether they send automatically.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Business name */}
        <div>
          <label className="block text-sm mb-1.5" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            Business name
          </label>
          <p className="text-sm mb-2.5" style={{ color: "var(--dash-text-muted)" }}>
            Shown to customers in reminder emails. Falls back to{" "}
            <span style={{ color: "var(--dash-text)", fontWeight: 500 }}>{userEmail}</span> if left blank.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="dash-input flex-1"
              placeholder="e.g. Morrison Plumbing & Heating"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              maxLength={100}
            />
            <button
              onClick={saveBusinessName}
              disabled={saving}
              className="dash-btn flex-shrink-0"
              style={{ opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving..." : saved ? "Saved ✓" : "Save"}
            </button>
          </div>
        </div>

        {/* Reminder mode */}
        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            Sending mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setReminderMode("approval")}
              className="p-4 rounded-xl border text-left transition-all"
              style={{
                background: profile.reminder_mode === "approval" ? "var(--dash-accent-soft)" : "var(--dash-card)",
                borderColor: profile.reminder_mode === "approval" ? "var(--dash-accent)" : "var(--dash-border)",
                boxShadow: profile.reminder_mode === "approval" ? "0 0 0 1px var(--dash-accent)" : "none",
              }}
            >
              <p className="text-sm" style={{ fontWeight: 650, color: profile.reminder_mode === "approval" ? "var(--dash-accent-strong)" : "var(--dash-text)" }}>
                Approval Mode
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)", lineHeight: 1.45 }}>
                Reminders are detected automatically but wait for you to click Send.
              </p>
            </button>

            <button
              onClick={() => setReminderMode("auto")}
              className="p-4 rounded-xl border text-left transition-all"
              style={{
                background: profile.reminder_mode === "auto" ? "var(--dash-green-soft)" : "var(--dash-card)",
                borderColor: profile.reminder_mode === "auto" ? "var(--dash-green)" : "var(--dash-border)",
                boxShadow: profile.reminder_mode === "auto" ? "0 0 0 1px var(--dash-green)" : "none",
              }}
            >
              <p className="text-sm" style={{ fontWeight: 650, color: profile.reminder_mode === "auto" ? "var(--dash-green)" : "var(--dash-text)" }}>
                Auto Mode
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)", lineHeight: 1.45 }}>
                Reminders are detected and sent automatically — no manual step.
              </p>
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-2.5 text-sm"
            style={{ background: "var(--dash-red-soft)", border: "1px solid #fecaca", color: "var(--dash-red)" }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
