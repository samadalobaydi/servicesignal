"use client";

import { useState } from "react";
import type { Profile } from "@/types";
import { updateProfile } from "@/lib/profile";
import { resolveSenderIdentity } from "@/lib/sender-identity";

interface SettingsCardProps {
  profile: Profile;
  onUpdated: (profile: Profile) => void;
}

export default function SettingsCard({ profile, onUpdated }: SettingsCardProps) {
  const [businessName, setBusinessName] = useState(profile.business_name ?? "");
  const [personalName, setPersonalName] = useState(profile.personal_name ?? "");
  /**
   * The choice control. Seeded from the account's ALREADY-SAVED preference —
   * this is display of an existing fact, not a pre-selection of an unmade
   * choice: an unconfigured account (profile.sender_identity === null) seeds
   * this to null too, so nothing appears selected until the owner clicks one.
   */
  const [choice, setChoice] = useState<"business" | "personal" | null>(profile.sender_identity);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The genuinely resolved identity for the "how customers currently see
  // you" preview — reflects unsaved edits in the fields above, computed the
  // exact same way the send path resolves it, so what this line promises is
  // never different from what the reminder pipeline will actually use once
  // saved.
  const preview = resolveSenderIdentity({
    preference: choice,
    businessName,
    personalName,
  });

  const save = async () => {
    if (!choice) return; // Continue/Save is disabled without a choice — belt and braces.
    setSaving(true);
    setError(null);
    setSaved(false);

    const body =
      choice === "business"
        ? { sender_identity: "business" as const, business_name: businessName.trim() }
        : { sender_identity: "personal" as const, personal_name: personalName.trim() };

    const result = await updateProfile(body);

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
          Controls how you are identified to customers on SMS and email reminders.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* How customers see you */}
        <div>
          <label className="block text-sm mb-1.5" style={{ color: "var(--dash-text)", fontWeight: 600 }}>
            How customers see you
          </label>

          {preview ? (
            <p className="text-sm mb-2.5" style={{ color: "var(--dash-text-muted)" }}>
              Reminders will appear from{" "}
              <span style={{ color: "var(--dash-text)", fontWeight: 500 }}>{preview.senderName}</span>.
            </p>
          ) : (
            <p className="text-sm mb-2.5" style={{ color: "var(--dash-text-muted)" }}>
              You haven&rsquo;t chosen how customers see you in reminders yet.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3" role="group" aria-label="How customers see you">
            <button
              type="button"
              onClick={() => setChoice("business")}
              aria-pressed={choice === "business"}
              className="p-2.5 rounded-lg border text-left transition-all"
              style={{
                background: choice === "business" ? "var(--dash-accent-soft)" : "#ffffff",
                borderColor: choice === "business" ? "var(--dash-accent)" : "var(--dash-border)",
              }}
            >
              <p className="text-sm" style={{ fontWeight: 650, color: choice === "business" ? "var(--dash-accent-strong)" : "var(--dash-text)" }}>
                My business
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.3 }}>
                Use your business name on SMS and email reminders.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setChoice("personal")}
              aria-pressed={choice === "personal"}
              className="p-2.5 rounded-lg border text-left transition-all"
              style={{
                background: choice === "personal" ? "var(--dash-accent-soft)" : "#ffffff",
                borderColor: choice === "personal" ? "var(--dash-accent)" : "var(--dash-border)",
              }}
            >
              <p className="text-sm" style={{ fontWeight: 650, color: choice === "personal" ? "var(--dash-accent-strong)" : "var(--dash-text)" }}>
                My name
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--dash-text-muted)", lineHeight: 1.3 }}>
                Use your name on SMS and email reminders.
              </p>
            </button>
          </div>

          {/* Only the field matching the current choice — never both, never
              the account's login email as an option. */}
          {choice === "business" && (
            <div className="flex gap-2">
              <input
                type="text"
                className="dash-input flex-1"
                placeholder="e.g. Morrison Plumbing & Heating"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={100}
              />
              <button onClick={save} disabled={saving} className="dash-btn flex-shrink-0" style={{ opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : saved ? "Saved ✓" : "Save"}
              </button>
            </div>
          )}
          {choice === "personal" && (
            <div className="flex gap-2">
              <input
                type="text"
                className="dash-input flex-1"
                placeholder="e.g. Sam Alobaydi"
                value={personalName}
                onChange={(e) => setPersonalName(e.target.value)}
                maxLength={100}
              />
              <button onClick={save} disabled={saving} className="dash-btn flex-shrink-0" style={{ opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving..." : saved ? "Saved ✓" : "Save"}
              </button>
            </div>
          )}

          {/* Changes only affect reminders prepared from now on — never
              rewrites what a customer has already been sent. */}
          <p className="text-xs mt-2" style={{ color: "var(--dash-text-soft)" }}>
            Changes apply to reminders you prepare from now on. Reminders already sent or waiting for your review keep the wording they were prepared with.
          </p>
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
