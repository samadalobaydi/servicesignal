"use client";

import { useState } from "react";
import type { Profile } from "@/types";
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

  return (
    <div className="dash-card overflow-hidden">
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--dash-border)" }}>
        <h2 style={{ fontWeight: 650, fontSize: "1.05rem", color: "var(--dash-text)" }}>
          Reminder Settings
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)" }}>
          Controls how reminder emails identify your business.
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

        {/* Sending behaviour — approval-only during the founding beta.
            The Auto Mode chooser is not offered: it is disabled server-side,
            so presenting it (even greyed out) would advertise something no
            user can turn on. */}
        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            Sending mode
          </label>
          <div
            className="p-4 rounded-xl border"
            style={{
              background: "var(--dash-accent-soft)",
              borderColor: "var(--dash-accent)",
              boxShadow: "0 0 0 1px var(--dash-accent)",
            }}
          >
            <p className="text-sm" style={{ fontWeight: 650, color: "var(--dash-accent-strong)" }}>
              Approval Mode
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)", lineHeight: 1.45 }}>
              Reminders are detected and prepared for you automatically, then wait
              in your queue. Nothing is sent to a customer until you approve it.
            </p>
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
