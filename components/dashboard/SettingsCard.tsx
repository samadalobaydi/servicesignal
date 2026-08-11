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
          Controls how your business is identified in reminders.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Business name */}
        <div>
          <label className="block text-sm mb-1.5" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            Business name
          </label>
          <p className="text-sm mb-2.5" style={{ color: "var(--dash-text-muted)" }}>
            Shown to customers as the sender name on your reminders. Falls back to{" "}
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

        {/* Sending behaviour.
            Both modes are shown so the direction is visible, but Auto Mode is
            genuinely inert: it is not an input, carries no name or value, and
            cannot be focused or activated. There is no toggle to "fail" and no
            state it can write — reminder_mode is never set to 'auto' from here,
            and BETA_APPROVAL_ONLY gates sending server-side regardless. */}
        <div>
          <p className="block text-sm mb-2" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            Sending mode
          </p>

          <div className="space-y-2.5">
            {/* Active mode. */}
            <div
              className="p-4 rounded-xl border"
              style={{
                background: "var(--dash-accent-soft)",
                borderColor: "var(--dash-accent)",
                boxShadow: "0 0 0 1px var(--dash-accent)",
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm" style={{ fontWeight: 650, color: "var(--dash-accent-strong)" }}>
                  Approval Mode
                </p>
                {/* Real text, not colour alone. */}
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: "#ffffff",
                    color: "var(--dash-accent-strong)",
                    border: "1px solid var(--dash-accent)",
                    fontWeight: 650,
                  }}
                >
                  Active
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)", lineHeight: 1.45 }}>
                ServiceSignal prepares each reminder for your review. Nothing is sent
                until you approve it.
              </p>
            </div>

            {/* Planned mode.
                A plain <div>, deliberately: not a radio, not a button, not
                disabled-but-focusable. Nothing here is in the tab order, so a
                keyboard user cannot select it, and aria-disabled would imply a
                control exists at all. The "Coming soon" text carries the state
                for screen readers — the muted styling is decoration on top of
                it, never the only signal. */}
            <div
              className="p-4 rounded-xl border"
              style={{
                background: "var(--dash-card-muted, #f8fafc)",
                borderColor: "var(--dash-border)",
                borderStyle: "dashed",
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm" style={{ fontWeight: 650, color: "var(--dash-text-muted)" }}>
                  Auto Mode
                </p>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: "#ffffff",
                    color: "#64748b",
                    border: "1px solid var(--dash-border-strong, #cbd5e1)",
                    fontWeight: 650,
                  }}
                >
                  Coming soon
                </span>
              </div>
              <p className="text-sm mt-1" style={{ color: "var(--dash-text-muted)", lineHeight: 1.45 }}>
                Reminders will send automatically according to your chosen schedule.
                This isn&rsquo;t available yet and can&rsquo;t be selected.
              </p>
            </div>
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
