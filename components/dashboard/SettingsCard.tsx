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
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.10)", background: "#141a2b" }}
    >
      <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
        <h2 className="font-display text-white" style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "0.04em" }}>
          REMINDER SETTINGS
        </h2>
        <p className="text-sm mt-1" style={{ color: "#a3b0c4" }}>
          Controls how reminder emails identify your business and whether they send automatically.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Business name */}
        <div>
          <label
            className="block text-sm mb-2 font-display uppercase tracking-wide"
            style={{ color: "#a3b0c4", fontWeight: 600, letterSpacing: "0.08em" }}
          >
            Business Name
          </label>
          <p className="text-sm mb-2.5" style={{ color: "#9aa7bd" }}>
            Shown to customers in reminder emails. Falls back to{" "}
            <span style={{ color: "#c2ccdb" }}>{userEmail}</span> if left blank.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="form-input flex-1"
              placeholder="e.g. Morrison Plumbing & Heating"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              maxLength={100}
            />
            <button
              onClick={saveBusinessName}
              disabled={saving}
              className="btn-primary flex-shrink-0"
              style={{ padding: "0 1.25rem", fontSize: "0.85rem", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving..." : saved ? "Saved ✓" : "Save"}
            </button>
          </div>
        </div>

        {/* Reminder mode */}
        <div>
          <label
            className="block text-sm mb-2 font-display uppercase tracking-wide"
            style={{ color: "#a3b0c4", fontWeight: 600, letterSpacing: "0.08em" }}
          >
            Sending Mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => setReminderMode("approval")}
              className="p-3 rounded-lg border text-left transition-all"
              style={{
                background: profile.reminder_mode === "approval" ? "rgba(0,200,255,0.08)" : "rgba(255,255,255,0.02)",
                borderColor: profile.reminder_mode === "approval" ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.08)",
              }}
            >
              <p className="font-display text-sm" style={{ fontWeight: 700, color: profile.reminder_mode === "approval" ? "#00c8ff" : "#c2ccdb" }}>
                Approval Mode
              </p>
              <p className="text-sm mt-1" style={{ color: "#9aa7bd", lineHeight: 1.45 }}>
                Reminders are detected automatically but wait for you to click Send.
              </p>
            </button>

            <button
              onClick={() => setReminderMode("auto")}
              className="p-3 rounded-lg border text-left transition-all"
              style={{
                background: profile.reminder_mode === "auto" ? "rgba(0,230,118,0.08)" : "rgba(255,255,255,0.02)",
                borderColor: profile.reminder_mode === "auto" ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.08)",
              }}
            >
              <p className="font-display text-sm" style={{ fontWeight: 700, color: profile.reminder_mode === "auto" ? "#00e676" : "#c2ccdb" }}>
                Auto Mode
              </p>
              <p className="text-sm mt-1" style={{ color: "#9aa7bd", lineHeight: 1.45 }}>
                Reminders are detected and sent automatically — no manual step.
              </p>
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg px-4 py-2.5 text-sm"
            style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", color: "#ff6b6b" }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
