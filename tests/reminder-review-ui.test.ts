import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  initialReviewUi,
  patchChannel,
  startEdit,
  cancelEdit,
  openRestoreConfirm,
  closeRestoreConfirm,
  switchTab,
  showRestoreConfirm,
  isDirty,
  anyDirty,
} from "@/lib/reminder-review-ui";

/**
 * CHANNEL INDEPENDENCE.
 *
 * The bug these cover: the review screen held ONE restore-confirmation flag and
 * rendered it against whichever tab was active, so opening the confirmation on
 * SMS and switching to Email showed Email a "your saved edits will be replaced"
 * prompt for edits Email never had.
 *
 * Each test therefore asserts on BOTH channels, not just the one being acted
 * on. A test that only checked the channel it touched would have passed against
 * the broken shared-state version.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Server-derived content flags. The UI never infers these. */
const EDITED = { canRestore: true };
const UNTOUCHED = { canRestore: false };

// ── Tests 1 & 2: saving one channel leaves the other alone ─────────────────

test("1. editing and saving SMS leaves Email's UI state untouched", () => {
  let ui = initialReviewUi();
  const emailBefore = ui.email;

  ui = startEdit(ui, "sms", { body: "My own SMS text." });
  assert.equal(ui.sms.mode, "editing");
  assert.equal(ui.sms.draftBody, "My own SMS text.");

  // The save completes and the draft is cleared for SMS only.
  ui = patchChannel(ui, "sms", { saving: false });
  ui = cancelEdit(ui, "sms");

  assert.equal(ui.email.mode, "view");
  assert.equal(ui.email.draftBody, "");
  assert.equal(ui.email.confirmRestore, false);
  assert.equal(ui.email.saving, false);
  assert.equal(ui.email.error, null);
  assert.deepEqual(ui.email, emailBefore, "Email's slice is byte-identical");

  // And Email is only "edited" if the SERVER says so.
  assert.equal(showRestoreConfirm(ui, "email", UNTOUCHED.canRestore), false);
});

test("2. editing and saving Email leaves SMS's UI state untouched", () => {
  let ui = initialReviewUi();
  const smsBefore = ui.sms;

  ui = startEdit(ui, "email", { body: "My own email body.", subject: "My subject" });
  assert.equal(ui.email.draftSubject, "My subject");

  ui = cancelEdit(ui, "email");

  assert.deepEqual(ui.sms, smsBefore, "SMS's slice is byte-identical");
  assert.equal(showRestoreConfirm(ui, "sms", UNTOUCHED.canRestore), false);
});

// ── Tests 3 & 4: the reported bug, both directions ─────────────────────────

test("3. an SMS restore confirmation does not follow the user to Email", () => {
  let ui = initialReviewUi();
  ui = openRestoreConfirm(ui, "sms");
  assert.equal(showRestoreConfirm(ui, "sms", EDITED.canRestore), true);

  const result = switchTab(ui, "sms", "email");
  assert.equal(result.blocked, false);
  assert.equal(result.tab, "email");
  ui = result.state;

  // THE REGRESSION: Email must show no restore UI at all.
  assert.equal(ui.email.confirmRestore, false, "Email never opened a confirmation");
  assert.equal(showRestoreConfirm(ui, "email", UNTOUCHED.canRestore), false);
  // Preferred behaviour: the confirmation is closed rather than carried.
  assert.equal(ui.sms.confirmRestore, false, "closed on tab switch, not preserved");
});

test("4. an Email restore confirmation does not follow the user to SMS", () => {
  let ui = initialReviewUi();
  ui = openRestoreConfirm(ui, "email");
  assert.equal(showRestoreConfirm(ui, "email", EDITED.canRestore), true);

  ui = switchTab(ui, "email", "sms").state;

  assert.equal(ui.sms.confirmRestore, false);
  assert.equal(showRestoreConfirm(ui, "sms", UNTOUCHED.canRestore), false);
  assert.equal(ui.email.confirmRestore, false);
});

test("3b. an untouched channel can never show a confirmation, however the flag got set", () => {
  // Belt and braces: even if the local flag were somehow true, the server's
  // answer wins. This is what stops a UI bug becoming a destructive prompt.
  let ui = initialReviewUi();
  ui = patchChannel(ui, "email", { confirmRestore: true });
  assert.equal(
    showRestoreConfirm(ui, "email", UNTOUCHED.canRestore),
    false,
    "canRestore=false must veto the confirmation"
  );
});

test("3c. a confirmation never renders while that channel is being edited", () => {
  let ui = initialReviewUi();
  ui = openRestoreConfirm(ui, "sms");
  ui = startEdit(ui, "sms", { body: "typing" });
  assert.equal(ui.sms.confirmRestore, false, "starting an edit closes the confirmation");
  assert.equal(showRestoreConfirm(ui, "sms", EDITED.canRestore), false);
});

// ── Tests 5 & 6: restoring one channel does not disturb the other ──────────

test("5. restoring SMS leaves Email's draft and confirmation state alone", () => {
  let ui = initialReviewUi();
  // Email has an unsaved draft in progress.
  ui = startEdit(ui, "email", { body: "half-written email", subject: "draft subject" });
  ui = openRestoreConfirm(ui, "sms");

  // SMS restore completes.
  ui = closeRestoreConfirm(ui, "sms");

  assert.equal(ui.email.mode, "editing", "Email is still being edited");
  assert.equal(ui.email.draftBody, "half-written email");
  assert.equal(ui.email.draftSubject, "draft subject");
  assert.equal(ui.email.confirmRestore, false);
});

test("6. restoring Email leaves SMS's draft and confirmation state alone", () => {
  let ui = initialReviewUi();
  ui = startEdit(ui, "sms", { body: "half-written sms" });
  ui = openRestoreConfirm(ui, "email");
  ui = closeRestoreConfirm(ui, "email");

  assert.equal(ui.sms.mode, "editing");
  assert.equal(ui.sms.draftBody, "half-written sms");
  assert.equal(ui.sms.confirmRestore, false);
});

// ── Test 7: drafts are independent ────────────────────────────────────────

test("7. SMS and Email drafts are held separately and never overwrite each other", () => {
  let ui = initialReviewUi();
  ui = startEdit(ui, "sms", { body: "SMS DRAFT" });
  ui = startEdit(ui, "email", { body: "EMAIL DRAFT", subject: "EMAIL SUBJECT" });

  assert.equal(ui.sms.draftBody, "SMS DRAFT", "the email edit did not clobber the SMS draft");
  assert.equal(ui.email.draftBody, "EMAIL DRAFT");
  assert.equal(ui.email.draftSubject, "EMAIL SUBJECT");
  assert.equal(ui.sms.draftSubject, "", "SMS has no subject");

  // Typing in one is invisible to the other.
  ui = patchChannel(ui, "email", { draftBody: "EMAIL DRAFT edited more" });
  assert.equal(ui.sms.draftBody, "SMS DRAFT");

  // Cancelling one keeps the other.
  ui = cancelEdit(ui, "email");
  assert.equal(ui.email.draftBody, "");
  assert.equal(ui.sms.draftBody, "SMS DRAFT", "cancelling Email must not discard the SMS draft");
  assert.equal(isDirty(ui, "sms"), true);
  assert.equal(isDirty(ui, "email"), false);
  assert.equal(anyDirty(ui), true, "the page still has unsaved work somewhere");
});

// ── Saving/error state is also per channel ────────────────────────────────

test("a save failure on one channel does not surface on the other", () => {
  let ui = initialReviewUi();
  ui = patchChannel(ui, "sms", { saving: true });
  assert.equal(ui.email.saving, false, "Email must not show a spinner for an SMS save");

  ui = patchChannel(ui, "sms", { saving: false, error: "We couldn't save that change." });
  assert.equal(ui.email.error, null, "an SMS error must not appear on the Email tab");
  assert.equal(ui.sms.error, "We couldn't save that change.");
});

// ── Unsaved-change protection still holds ─────────────────────────────────

test("a dirty channel blocks the tab switch and loses nothing", () => {
  let ui = initialReviewUi();
  ui = startEdit(ui, "sms", { body: "unsaved work" });

  const result = switchTab(ui, "sms", "email");
  assert.equal(result.blocked, true);
  assert.equal(result.tab, "sms", "the user stays where the work is");
  assert.equal(result.state.sms.draftBody, "unsaved work", "nothing is discarded");

  // Once cancelled, the switch proceeds.
  const after = switchTab(cancelEdit(ui, "sms"), "sms", "email");
  assert.equal(after.blocked, false);
  assert.equal(after.tab, "email");
});

test("switching to the tab already open is never blocked", () => {
  let ui = initialReviewUi();
  ui = startEdit(ui, "sms", { body: "typing" });
  const result = switchTab(ui, "sms", "sms");
  assert.equal(result.blocked, false, "staying put is not a switch");
});

// ── The component must not reintroduce shared state ───────────────────────

test("[static] the review component holds no channel-agnostic editing state", () => {
  const code = readFileSync(join(ROOT, "components/onboarding/ReminderReview.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // The exact shapes that caused the bug.
  for (const shared of [
    "useState(false)",           // a bare confirmRestore / saving flag
    "setConfirmRestore",
    "setDraftBody",
    "setDraftSubject",
    "setSaving",
  ]) {
    assert.equal(
      code.includes(shared),
      false,
      `"${shared}" is channel-agnostic state and must live in the per-channel record`
    );
  }

  // And the state machine is actually the thing driving it.
  assert.match(code, /from "@\/lib\/reminder-review-ui"/);
  assert.match(code, /showRestoreConfirm\(ui, tab, active\.canRestore\)/);
});
