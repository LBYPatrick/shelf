# 001 — Preserve every tree collapse action

- **Status**: Implemented
- **Commit**: b8294a4
- **Severity**: HIGH
- **Category**: Function and interruption
- **Estimated scope**: EntityTree.vue plus focused UI/unit coverage; roughly 3 files

## Problem

`src/renderer/components/sidebar/EntityTree.vue:196` uses one timer for both animation and the store mutation:

```ts
clearTimeout(collapseTimer);
collapsing.value = { from: at + 1, to: at + count, key: row.key };
collapseTimer = setTimeout(() => {
  collapsing.value = null;
  toggleOf(row);
}, COLLAPSE_MS);
```

`COLLAPSE_MS` is 140 at :155. Left/right/Enter handlers at :530 also call activate. Collapsing B before A's timer fires cancels A's requested mutation. Reduced CSS duration does not cancel that JavaScript wait.

## Target

Every accepted toggle changes the intended node exactly once. Keyboard and reduced-motion collapse update state in the same event turn (0ms), without row stagger/travel. Normal pointer collapse may retain the existing 140ms opacity/transform exit, but an exit cannot discard an accepted action. Keep virtual row height constant and `overflow-anchor: none`; no animated row height.

Use a pending collapse record with the actual node identity and one idempotent commit function. Before replacing its timer, flush the prior pending mutation; recompute row indexes after the flush. Explicitly clear pending visual state/timer on flush. Repeat activation of the same pending node must first resolve the previous action and then toggle from current store state, rather than re-reading a stale row snapshot.

## Repo conventions to follow

`src/renderer/composables/useDrag.ts` separates pointer gesture state from release behavior and rejects secondary gestures. Follow this ownership discipline. `styles/base.css:225` defines `--ease-out` cubic-bezier(0.23,1,0.32,1); `--t-press` is 140ms. EntityTree already maintains constant virtual row geometry.

## Steps

1. Read `activate`, `toggleOf`, descendants and all pointer/key call sites. Add a single pending-collapse flush function that commits at most once and clears the timer.
2. Route keyboard calls through an explicit instant activation path. Read `prefers-reduced-motion` reactively or at each activation; do not infer input source from an old global event.
3. In pointer activation, flush pending work before computing the new row band; resolve node state by key after any prior mutation. Keep the current bounded visual exit only when motion is allowed.
4. Handle unmount deliberately: clear visual timers and do not leave an accepted store action uncommitted. Remove obsolete timers/state.
5. Add focused regression coverage: close two different expanded groups inside 140ms; rapid same-node close/open; keyboard navigation; reduction on; unmount while pending. Assert final expansion state and focus, not merely animation classes.

## Boundaries

- Do not rewrite the entity store, virtualization, database fetches, sidebar widths or row heights.
- Do not add new reveal staggering; the bug is action ownership, not insufficient decoration.
- Do not add dependencies or hardcode colors. Preserve token surfaces and the 28px target floor.
- If the cited implementation has materially changed since the commit stamp, report the drift before choosing a different design.

## Verification

**Mechanical:** run `make format`, then `make`. Expect lint, type checking, build, unit, UI and e2e to pass. Run `make gate-full` if component props or story mock shapes change. Review visual diffs before accepting any snapshots. Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` for repository pnpm commands if its implicit dependency verification would reinstall packages. Run UI and e2e sequentially; both use test-results. Do not weaken existing assertions to hide a regression.

**Feel check:** Expand adjacent groups, collapse both rapidly, and verify both close. Toggle one repeatedly while an exit is running; no click is lost and focus stays on the intended node. At 10% animation playback the exiting band can fade, but its geometry stays fixed. Enable reduced motion: Left/Right and pointer toggles are instant, with no delayed mutation.

**Done when:** All accepted toggles are committed exactly once across overlapping interactions, key/reduced paths have no 140ms delay, and existing virtualization checks pass.
