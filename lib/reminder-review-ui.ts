import type { ReminderChannel } from "./reminder-content";

/**
 * The per-channel UI state machine for the Step 2 review screen.
 *
 * WHY THIS IS A MODULE RATHER THAN COMPONENT STATE
 *
 * The bug it fixes was a state-shape bug, not a rendering bug. The component
 * held ONE `confirmRestore` boolean, one `mode`, one draft and one error, and
 * rendered them against whichever tab happened to be active. Opening the
 * restore confirmation on SMS and switching to Email therefore showed Email an
 * "Your saved edits will be replaced" prompt for edits Email never had — the
 * same flag, reinterpreted by a different tab.
 *
 * Shared state between two things that are meant to be independent will always
 * find a way to leak. The fix is to make the shape itself incapable of it: one
 * record per channel, and no ambient value that can be read as belonging to
 * "the current channel".
 *
 * Pure and framework-free so every isolation guarantee below is a unit test
 * rather than a click-through.
 *
 * WHAT IS NOT HERE: whether a channel is edited. That is the SERVER's answer,
 * held in the fetched content, and it is never inferred from local UI state —
 * which is the other half of why Email could appear edited when it was not.
 */

export type EditMode = "view" | "editing";

export interface ChannelUiState {
  mode: EditMode;
  /** The in-progress body. Meaningless unless mode is "editing". */
  draftBody: string;
  /** Email only; always "" for SMS. */
  draftSubject: string;
  /** Whether THIS channel's restore confirmation is open. */
  confirmRestore: boolean;
  /** Save/restore in flight for THIS channel. */
  saving: boolean;
  /** The last failure for THIS channel. */
  error: string | null;
}

export type ReviewUiState = Record<ReminderChannel, ChannelUiState>;

export function blankChannelUi(): ChannelUiState {
  return {
    mode: "view",
    draftBody: "",
    draftSubject: "",
    confirmRestore: false,
    saving: false,
    error: null,
  };
}

export function initialReviewUi(): ReviewUiState {
  return { sms: blankChannelUi(), email: blankChannelUi() };
}

/** Replaces one channel's slice, leaving the other object identity untouched. */
export function patchChannel(
  state: ReviewUiState,
  channel: ReminderChannel,
  patch: Partial<ChannelUiState>
): ReviewUiState {
  return { ...state, [channel]: { ...state[channel], ...patch } };
}

export function isDirty(state: ReviewUiState, channel: ReminderChannel): boolean {
  return state[channel].mode === "editing";
}

/** True when ANY channel has unsaved work — what page-level exits must check. */
export function anyDirty(state: ReviewUiState): boolean {
  return isDirty(state, "sms") || isDirty(state, "email");
}

/**
 * Begins editing one channel, seeded from that channel's current content.
 *
 * Closes this channel's restore confirmation: offering "replace your edits"
 * and an open editor at the same time is two contradictory answers to the same
 * question.
 */
export function startEdit(
  state: ReviewUiState,
  channel: ReminderChannel,
  seed: { body: string; subject?: string }
): ReviewUiState {
  return patchChannel(state, channel, {
    mode: "editing",
    draftBody: seed.body,
    draftSubject: seed.subject ?? "",
    confirmRestore: false,
    error: null,
  });
}

/**
 * Cancel — discards THIS channel's unsaved draft and nothing else.
 *
 * Explicitly not a reset of the whole screen: the other channel may have its
 * own draft in progress, and cancelling one must never throw away the other.
 */
export function cancelEdit(state: ReviewUiState, channel: ReminderChannel): ReviewUiState {
  return patchChannel(state, channel, {
    mode: "view",
    draftBody: "",
    draftSubject: "",
    error: null,
  });
}

export function openRestoreConfirm(
  state: ReviewUiState,
  channel: ReminderChannel
): ReviewUiState {
  return patchChannel(state, channel, { confirmRestore: true, error: null });
}

export function closeRestoreConfirm(
  state: ReviewUiState,
  channel: ReminderChannel
): ReviewUiState {
  return patchChannel(state, channel, { confirmRestore: false });
}

/**
 * Switching tabs.
 *
 * Refused while the CURRENT channel has unsaved work — the owner is told to
 * save or cancel rather than silently losing it.
 *
 * When it does proceed, every channel's restore confirmation is closed. A
 * destructive confirmation is a decision about one message taken in one moment;
 * carrying it across a tab switch means the owner could return later and
 * confirm a prompt they no longer have in mind. Closing it costs one extra
 * click in a rare case and removes a whole class of wrong-channel mistake.
 */
export function switchTab(
  state: ReviewUiState,
  from: ReminderChannel,
  to: ReminderChannel
): { state: ReviewUiState; tab: ReminderChannel; blocked: boolean } {
  if (from !== to && isDirty(state, from)) {
    return { state, tab: from, blocked: true };
  }

  const cleared: ReviewUiState = {
    sms: { ...state.sms, confirmRestore: false },
    email: { ...state.email, confirmRestore: false },
  };
  return { state: cleared, tab: to, blocked: false };
}

/** Whether the restore confirmation should render for a channel right now. */
export function showRestoreConfirm(
  state: ReviewUiState,
  channel: ReminderChannel,
  canRestore: boolean
): boolean {
  // `canRestore` is the SERVER's answer about this channel. A confirmation can
  // never appear for a channel the server says has nothing to restore, however
  // the local flag got set.
  return canRestore && state[channel].confirmRestore && state[channel].mode === "view";
}
