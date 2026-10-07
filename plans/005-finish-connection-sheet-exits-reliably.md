# 005 — Finish connection sheet exits reliably

- **Status**: Implemented
- **Commit**: b8294a4
- **Severity**: MEDIUM
- **Category**: Lifecycle and consistency
- **Estimated scope**: Sheet.vue, ConnectionEditor.vue, ConnectionManager.vue, Workspace.vue, stories/tests; roughly 5–7 files

## Problem

`src/renderer/components/connection/ConnectionEditor.vue:48`:

```ts
open.value = false;
closeTimer = setTimeout(() => emit('close'), 260);
```

But `ui/Sheet.vue:837` transforms over `var(--t-sheet)` (300ms). Saving at ConnectionEditor :102:

```ts
open.value = false;
emit('saved', stored, connect);
```

`views/ConnectionManager.vue:426` immediately clears editing; Workspace :163 clears editingConnection too. The owning v-if removes the component before Sheet's leave completes.

## Target

Sheet emits one typed after-leave event from the Vue Transition after-leave hook. ConnectionEditor emits close once after that event; remove fixed closeTimer. Save emits its successful saved business event immediately, so persistence and optional connection are not animation-delayed. Parents retain the mounted editor until close, then clear editing state. Vue's actual transition lifecycle determines teardown in both normal and reduced mode; no guessed timeout.

Keep established Sheet motion: transform300ms `--ease-sheet`, opacity220ms `--ease-out`; reduced mode has no transform and existing ≤150ms opacity. Do not alter content-height measurement. A requested close is idempotent; discard cancellation leaves the editor open, and failed save stays visible with the error.

## Repo conventions to follow

`src/renderer/components/ui/Sheet.vue:487` owns the Transition, so its lifecycle owns after-leave. The repository rule is that a sheet is owned by its view; parents must preserve that ownership. Keep host persistence separate from visual teardown as in toast dismissal's explicit operation/state separation.

## Steps

1. Add typed after-leave emit to Sheet and wire its existing Transition hook; do not replace the animation or measurement observer.
2. Have ConnectionEditor use the event to emit close exactly once for cancel, scrim, Escape, confirmed discard and successful save. Remove its timer and timeout cleanup.
3. Continue emitting saved immediately on successful persistence; use it for business work only. Preserve the saved connection and connect flag without waiting for the exit.
4. In ConnectionManager and Workspace, stop clearing the editor in saved handlers. Clear it only on close; keep connect/save behavior immediate. Ensure switching the root view during connect has a coherent ownership path, rather than inventing a delayed connection.
5. Update stories/mocks for the lifecycle event where required. Add coverage for no-change cancel, discard decline/confirm, Escape, scrim, save, save-and-connect, failure and reduced mode. Assert business event timing plus exactly-once close and retained subtree until leave.

## Boundaries

- Do not modify connection secrets, SSH, credential persistence, testing or authentication behavior.
- Do not delay database connection to make an animation finish.
- Do not change sheet curves, add blur, or fix teardown with another hardcoded timeout.
- Do not add dependencies or hardcode colors. Preserve token surfaces and the 28px target floor.
- If the cited implementation has materially changed since the commit stamp, report the drift before choosing a different design.

## Verification

**Mechanical:** run `make format`, then `make`. Expect lint, type checking, build, unit, UI and e2e to pass. Run `make gate-full` if component props or story mock shapes change. Review visual diffs before accepting any snapshots. Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` for repository pnpm commands if its implicit dependency verification would reinstall packages. Run UI and e2e sequentially; both use test-results. Do not weaken existing assertions to hide a regression.

**Feel check:** At 10% playback save and cancel leave through the same sheet exit, rather than disappearing midway. Save-and-connect begins immediately; transitioning to a connected workspace should remain coherent. Failed save stays open; declined discard stays open. Enable reduction and repeat: no stale invisible editor or duplicate close event. Escape only closes the top overlay.

**Done when:** All close paths use the actual shared after-leave lifecycle, save/connect events are immediate, no fixed260ms timeout remains, and parent editor ownership is correct in both views.
