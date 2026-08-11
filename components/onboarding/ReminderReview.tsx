"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialReviewUi,
  patchChannel,
  startEdit as uiStartEdit,
  cancelEdit as uiCancelEdit,
  openRestoreConfirm,
  closeRestoreConfirm,
  switchTab as uiSwitchTab,
  showRestoreConfirm,
  isDirty,
  type ReviewUiState,
} from "@/lib/reminder-review-ui";
import styles from "./onboarding.module.css";

/**
 * Step 2: the prepared SMS and email, both reviewable and both editable.
 *
 * ONE APPROVAL, TWO CHANNELS. The two tabs are equal — neither is labelled
 * primary, supporting or richer, and neither is shown first by default for any
 * reason other than tab order. Editing is completely independent per channel;
 * approval, when it happens in Active Chasing, is a single action over the pair,
 * and the content hash spans both so editing either one invalidates a stale
 * approval.
 *
 * NOTHING HERE SENDS. There is no approve control on this screen. The forward
 * action records completion and moves to the queue where approval lives.
 */

export interface ChannelPreview {
  email: {
    to: string;
    from: string;
    deliveredBy?: string;
    repliesTo?: string | null;
    subject: string;
    body: string;
    edited: boolean;
    canRestore: boolean;
  };
  sms: {
    to: string | null;
    body: string;
    edited: boolean;
    canRestore: boolean;
    maxLength: number;
  };
  /** Prepared before migration 010 — composed live, so editing is unavailable. */
  legacy: boolean;
}

export interface ReminderPreview extends ChannelPreview {
  reminderId: string;
  invoiceId: string;
}

type Channel = "sms" | "email";

export function ReminderReview({
  preview,
  busy,
  onContinue,
  onLater,
}: {
  preview: ReminderPreview;
  busy: boolean;
  onContinue: () => void;
  onLater: () => void;
}) {
  const [content, setContent] = useState<ChannelPreview>(preview);
  const [tab, setTab] = useState<Channel>("sms");
  /**
   * ONE SLICE PER CHANNEL. Every piece of editing state — mode, drafts, the
   * restore confirmation, saving and error — is held per channel rather than
   * once for "the current tab". A single shared flag rendered against the
   * active tab is what previously let an SMS restore confirmation reappear as
   * an Email one. See lib/reminder-review-ui.ts.
   */
  const [ui, setUi] = useState<ReviewUiState>(initialReviewUi);
  const [blocked, setBlocked] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const channel = ui[tab];
  const mode = channel.mode;
  const draftBody = channel.draftBody;
  const draftSubject = channel.draftSubject;
  const saving = channel.saving;
  const error = channel.error;
  const dirty = isDirty(ui, tab);

  useEffect(() => {
    if (mode === "editing") editorRef.current?.focus();
  }, [mode, tab]);

  /**
   * Every route out of the editing state runs through here. Unsaved work is
   * never discarded silently — the owner is told to save or cancel, and the
   * attempted action does not happen.
   */
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) {
        setBlocked("You have unsaved changes. Save or cancel them before continuing.");
        editorRef.current?.focus();
        return;
      }
      setBlocked(null);
      action();
    },
    [dirty]
  );

  /**
   * Tab switching goes through the state machine, which refuses while the
   * CURRENT channel is dirty and closes every restore confirmation when it
   * proceeds — so a confirmation opened on one channel can never be answered on
   * the other.
   */
  const goToTab = (next: Channel) => {
    const result = uiSwitchTab(ui, tab, next);
    if (result.blocked) {
      setBlocked("You have unsaved changes. Save or cancel them before continuing.");
      editorRef.current?.focus();
      return;
    }
    setBlocked(null);
    setUi(result.state);
    setTab(result.tab);
  };

  const startEdit = () => {
    setBlocked(null);
    setUi((s) =>
      uiStartEdit(
        s,
        tab,
        tab === "sms"
          ? { body: content.sms.body }
          : { body: content.email.body, subject: content.email.subject }
      )
    );
  };

  /**
   * Cancel discards THIS channel's unsaved draft only — never the saved
   * version, and never the other channel's draft.
   */
  const cancelEdit = () => {
    setBlocked(null);
    setUi((s) => uiCancelEdit(s, tab));
  };

  const patch = async (payload: Record<string, unknown>) => {
    const target = tab; // captured, so a tab switch mid-flight cannot misfile it
    setUi((s) => patchChannel(s, target, { saving: true, error: null }));
    try {
      const res = await fetch(`/api/reminders/${preview.reminderId}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        // The last SAVED version is untouched on failure — the server did not
        // write, and nothing local is cleared.
        setUi((s) =>
          patchChannel(s, target, {
            saving: false,
            error: data?.message ?? "We couldn't save that change. Please try again.",
          })
        );
        return false;
      }

      // BOTH channels are refreshed from the server response, because the
      // server is the only authority on which channel is edited. Nothing here
      // infers one channel's state from the other's.
      setContent({ email: data.email, sms: data.sms, legacy: data.legacy });
      setUi((s) => patchChannel(s, target, { saving: false, error: null }));
      return true;
    } catch {
      setUi((s) =>
        patchChannel(s, target, {
          saving: false,
          error: "We couldn't reach ServiceSignal. Please check your connection and try again.",
        })
      );
      return false;
    }
  };

  const save = async () => {
    if (saving) return; // duplicate-click guard
    const ok = await patch(
      tab === "sms"
        ? { channel: "sms", action: "save", body: draftBody }
        : { channel: "email", action: "save", subject: draftSubject, body: draftBody }
    );
    if (ok) cancelEdit();
  };

  const restore = async () => {
    if (saving) return;
    const target = tab;
    const ok = await patch({ channel: target, action: "restore" });
    if (ok) setUi((s) => closeRestoreConfirm(s, target));
  };

  const active = tab === "sms" ? content.sms : content.email;
  const smsCount = draftBody.trim().length;

  return (
    <div>
      <h1 className={styles.title}>Here are the reminders we&rsquo;ve prepared</h1>
      <p className={styles.sub}>
        Review the SMS and email reminders prepared for your customer. Nothing has
        been sent yet.
      </p>

      {/* ── Equal channel tabs ─────────────────────────────────────────── */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Reminder channels"
        className={styles.chTabs}
      >
        {(["sms", "email"] as const).map((c) => (
          <button
            key={c}
            role="tab"
            type="button"
            id={`ch-tab-${c}`}
            aria-selected={tab === c}
            aria-controls="ch-panel"
            tabIndex={tab === c ? 0 : -1}
            className={`${styles.chTab}${tab === c ? ` ${styles.chTabOn}` : ""}`}
            onClick={() => goToTab(c)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                goToTab(c === "sms" ? "email" : "sms");
              }
            }}
          >
            {c === "sms" ? "SMS" : "Email"}
            {(c === "sms" ? content.sms.edited : content.email.edited) && (
              <span className={styles.chDot} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {blocked && (
        <p className={styles.err} role="alert">{blocked}</p>
      )}
      {error && (
        <p className={styles.err} role="alert">{error}</p>
      )}

      <div id="ch-panel" role="tabpanel" aria-labelledby={`ch-tab-${tab}`}>
        <article className={styles.preview} aria-label={tab === "sms" ? "Prepared SMS reminder" : "Prepared email reminder"}>
          <dl className={styles.previewHead}>
            {tab === "sms" ? (
              <div className={styles.previewRow}>
                <dt className={styles.previewKey}>To</dt>
                <dd className={styles.previewVal}>
                  {content.sms.to || <span className={styles.previewNote2}>No mobile number on this invoice</span>}
                </dd>
              </div>
            ) : (
              <>
                <div className={styles.previewRow}>
                  <dt className={styles.previewKey}>To</dt>
                  <dd className={styles.previewVal}>{content.email.to}</dd>
                </div>
                <div className={styles.previewRow}>
                  <dt className={styles.previewKey}>From</dt>
                  <dd className={styles.previewVal}>
                    {content.email.from}
                    {content.email.deliveredBy && (
                      <span className={styles.previewNote2}> · delivered by {content.email.deliveredBy}</span>
                    )}
                  </dd>
                </div>
                {content.email.repliesTo && (
                  <div className={styles.previewRow}>
                    <dt className={styles.previewKey}>Replies</dt>
                    <dd className={styles.previewVal}>{content.email.repliesTo}</dd>
                  </div>
                )}
                <div className={styles.previewRow}>
                  <dt className={styles.previewKey}>Subject</dt>
                  <dd className={`${styles.previewVal} ${styles.previewSubject}`}>
                    {mode === "editing" ? (
                      <input
                        className={styles.input}
                        value={draftSubject}
                        onChange={(e) => setUi((s) => patchChannel(s, tab, { draftSubject: e.target.value }))}
                        aria-label="Email subject"
                      />
                    ) : (
                      content.email.subject
                    )}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {mode === "editing" ? (
            <div className={styles.editorWrap}>
              <label className={styles.srOnly} htmlFor="ch-editor">
                {tab === "sms" ? "SMS message" : "Email message"}
              </label>
              <textarea
                id="ch-editor"
                ref={editorRef}
                className={styles.editor}
                rows={tab === "sms" ? 5 : 10}
                value={draftBody}
                onChange={(e) => setUi((s) => patchChannel(s, tab, { draftBody: e.target.value }))}
              />
              {tab === "sms" && (
                /* A character count, NOT a segment count. ServiceSignal has no
                   GSM-7/UCS-2 calculator, so no segment or billing claim is
                   made here — only the stored maximum. */
                <p className={styles.editorMeta} aria-live="polite">
                  {smsCount} / {content.sms.maxLength} characters
                </p>
              )}
            </div>
          ) : (
            <div className={styles.previewBody}>{active.body}</div>
          )}
        </article>

        {/* ── Edit state controls ──────────────────────────────────────── */}
        <div className={styles.chActions}>
          {mode === "editing" ? (
            <>
              <button type="button" className={styles.chSave} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button type="button" className={styles.chGhost} onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </>
          ) : content.legacy ? (
            <p className={styles.previewNote}>
              This reminder was prepared before editing was available, so it can&rsquo;t
              be edited here.
            </p>
          ) : (
            <>
              {active.edited && (
                /* Word plus icon, never colour alone. */
                <span className={styles.chEdited}>
                  <span aria-hidden="true">✎</span> Edited
                </span>
              )}
              <button type="button" className={styles.chGhost} onClick={startEdit}>
                Edit
              </button>
              {active.canRestore && !channel.confirmRestore && (
                <button
                  type="button"
                  className={styles.chGhost}
                  onClick={() => setUi((s) => openRestoreConfirm(s, tab))}
                >
                  Restore original
                </button>
              )}
            </>
          )}
        </div>

        {/* Inline rather than a modal: the consequence is small and named, and
            a dialog here would be heavier than the decision deserves. */}
        {showRestoreConfirm(ui, tab, active.canRestore) && (
          <div className={styles.confirm} role="alertdialog" aria-labelledby="restore-q">
            <p id="restore-q" className={styles.confirmT}>
              Restore ServiceSignal&rsquo;s original version?
            </p>
            <p className={styles.confirmS}>
              Your saved edits to this {tab === "sms" ? "SMS" : "email"} will be replaced.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.chSave} onClick={restore} disabled={saving}>
                {saving ? "Restoring…" : "Restore original"}
              </button>
              <button
                type="button"
                className={styles.chGhost}
                onClick={() => setUi((s) => closeRestoreConfirm(s, tab))}
                disabled={saving}
              >
                Keep my edits
              </button>
            </div>
          </div>
        )}
      </div>

      <p className={styles.previewNote}>
        Nothing has been sent. You can approve or discard these reminders together
        from Active Chasing.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => guard(onContinue)}
          disabled={busy || saving}
        >
          {busy ? "One moment…" : "Go to Active Chasing"}
        </button>
        <button
          type="button"
          className={styles.skip}
          onClick={() => guard(onLater)}
          disabled={busy || saving}
        >
          Finish this later
        </button>
      </div>
    </div>
  );
}
