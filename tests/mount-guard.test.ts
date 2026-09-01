import { test } from "node:test";
import assert from "node:assert/strict";
import { createMountGuard } from "@/lib/mount-guard";

/**
 * Proves the exact incident that made the Founding Beta allowance header
 * disappear: a mount guard implemented as a ref that is set to "gone" on
 * cleanup and never reset would stay "gone" forever once React Strict
 * Mode's mount → cleanup → mount-again sequence ran once, silently
 * discarding every later async result.
 */

test("a fresh guard starts unmounted", () => {
  const guard = createMountGuard();
  assert.equal(guard.isMounted(), false);
});

test("onMount / onCleanup toggle isMounted", () => {
  const guard = createMountGuard();
  guard.onMount();
  assert.equal(guard.isMounted(), true);
  guard.onCleanup();
  assert.equal(guard.isMounted(), false);
});

test("survives React Strict Mode's mount -> cleanup -> mount-again on the SAME guard instance", () => {
  // Strict Mode creates the ref/guard ONCE per component instance (useRef
  // does not reinitialise on the simulated remount), then runs the effect
  // body twice. This is exactly that sequence, against one guard object.
  const guard = createMountGuard();

  // First (discarded) mount.
  guard.onMount();
  assert.equal(guard.isMounted(), true);
  // ...an async call is started here in the real component, but nothing
  // has resolved yet when Strict Mode immediately cleans up...
  guard.onCleanup();
  assert.equal(guard.isMounted(), false, "discarded after the first cleanup, correctly");

  // Second (real) mount — THIS is the step a plain `useRef(false)` set only
  // to `true` on cleanup gets wrong: nothing re-arms it, so it stays "gone"
  // forever and every later result is silently dropped.
  guard.onMount();
  assert.equal(guard.isMounted(), true, "must be re-armed by the second mount");

  // Now the FIRST call's async work resolves late. Because the guard was
  // re-armed by the real mount, applying its result is (correctly) allowed —
  // this is the exact check that was permanently false before the fix.
  assert.equal(guard.isMounted(), true, "a late-resolving result from before Strict Mode's discard must still be applicable");
});

test("a genuine unmount after Strict Mode's dance still blocks late results", () => {
  const guard = createMountGuard();
  guard.onMount();
  guard.onCleanup();
  guard.onMount();
  // The component is now really going away — the final, real cleanup.
  guard.onCleanup();
  assert.equal(guard.isMounted(), false, "a real unmount must still block a result that resolves after it");
});
