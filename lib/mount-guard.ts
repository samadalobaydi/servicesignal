/**
 * Guards an async effect against setting state after the component has
 * genuinely gone away — while surviving React Strict Mode's mount → cleanup
 * → mount-again dance on the SAME component instance.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────────
 *
 * A naive version of this guard is a `useRef(false)` set to `true` in the
 * effect's cleanup and read as "still mounted" everywhere else. That is
 * correct for a real unmount, but Strict Mode (Next.js dev's default) runs
 * every effect twice on first mount: mount → cleanup → mount again, on the
 * SAME fiber, sharing the SAME ref. The first cleanup sets the ref to
 * "gone" — and if nothing ever resets it on the second mount, it stays
 * "gone" forever, so no async result can ever be applied again. The
 * component silently stops updating: not an error, no crash, just state
 * that never arrives. That is exactly what happened to the Founding Beta
 * allowance header — it read as permanently unverified and rendered
 * nothing.
 *
 * A per-effect-invocation `let cancelled = false` closure does not have
 * this problem, because Strict Mode's second invocation gets its OWN fresh
 * closure. The mistake was moving that state to something that persists
 * ACROSS invocations without re-arming it. This module makes the correct
 * contract — reset on every mount, set only on cleanup — a single tested
 * unit instead of an inline pattern that is easy to get subtly wrong again.
 */
export interface MountGuard {
  /** Call at the START of the effect body, before starting async work. */
  onMount(): void;
  /** Call as the effect's cleanup / return value. */
  onCleanup(): void;
  /** True only while genuinely mounted — false before onMount and after onCleanup. */
  isMounted(): boolean;
}

export function createMountGuard(): MountGuard {
  let mounted = false;
  return {
    onMount() {
      mounted = true;
    },
    onCleanup() {
      mounted = false;
    },
    isMounted() {
      return mounted;
    },
  };
}
