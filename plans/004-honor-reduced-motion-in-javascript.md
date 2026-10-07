# 004 — Honor reduced motion in JavaScript

- **Status**: Implemented
- **Commit**: b8294a4
- **Severity**: MEDIUM
- **Category**: Accessibility and imperative animation
- **Estimated scope**: Shared preference helper, ErdCanvas.vue, ExplainTree.vue, SqlEditor.vue and tests; roughly 5–7 files

## Problem

`src/renderer/components/viz/ErdCanvas.vue:343` and :350:

```ts
if (animate) target.transition().duration(400).call(zoomBehavior.transform, next);
select(svg.value).transition().duration(180).call(zoomBehavior.scaleBy, by);
```

`viz/ExplainTree.vue:310,315` similarly schedules 180/300ms transitions. `editor/SqlEditor.vue:380` sets:

```ts
smoothScrolling: true,
cursorBlinking: 'smooth',
```

Global CSS reduction cannot control either JavaScript engine.

## Target

Use a live `matchMedia('(prefers-reduced-motion: reduce)')` preference with listener cleanup. On preference change, interrupt active D3 transitions. Reduced-motion and keyboard zoom/fit set transforms directly in 0ms. Normal pointer zoom uses 180ms, fit 260ms; D3 easing must match `cubic-bezier(0.23,1,0.32,1)` numerically, not its default ease. Derive/evaluate that curve once in a shared helper if no existing evaluator exists; no dependency is needed.

Reduced Monaco options: smoothScrolling:false and cursorBlinking:'solid', updated on the existing instance. Normal preference may retain the current smooth caret/scroll setting; do not recreate the editor or lose models, selection or undo history. Check initial ERD force ticks under reduction: if visibly moving, settle initial geometry before publishing it, without breaking node dragging or restoring saved positions.

## Repo conventions to follow

`styles/base.css:202` expresses the live reduced-motion contract for CSS; bridge that same preference into JS. `composables/useDrag.ts` already scopes cleanup. `SqlEditor.vue` updates theme/font/wrap options on the existing instance; use updateOptions, not remount.

## Steps

1. Add/reuse a scoped live preference helper; initialize before initial fit/editor construction and remove media listeners on disposal.
2. Centralize D3 zoom/fit scheduling in each graph. Interrupt before a new target, and branch to direct calls for reduction/keyboard. Explicitly pass origin from zoom-button events; synthetic key clicks are instant.
3. Apply pointer zoom180/fit260 ease-out; preserve current fit target, padding and touched-state semantics. On live reduction cancel the running transition and resolve the intended target directly.
4. Feed preference into SqlEditor creation and watch updateOptions. Keep model/undo/cursor continuity.
5. Inspect initial force layout in reduced mode. If visible movement exists, resolve initial layout without an animated sequence; avoid unbounded synchronous ticks or a new UI freeze.
6. Cover reduce-before-mount, live change mid-fit, repeated fit/zoom, keyboard zoom and existing Monaco instance identity. Test transform outcomes and editor options rather than only CSS classes.

## Boundaries

- Do not change graph data, query plans, saved node positions or diagram drag precision.
- Do not add spring inertia, a new graph library, or a global prohibition on bounded progress indicators.
- Do not claim a force-layout defect or performance gain without reproducing it.
- Do not add dependencies or hardcode colors. Preserve token surfaces and the 28px target floor.
- If the cited implementation has materially changed since the commit stamp, report the drift before choosing a different design.

## Verification

**Mechanical:** run `make format`, then `make`. Expect lint, type checking, build, unit, UI and e2e to pass. Run `make gate-full` if component props or story mock shapes change. Review visual diffs before accepting any snapshots. Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` for repository pnpm commands if its implicit dependency verification would reinstall packages. Run UI and e2e sequentially; both use test-results. Do not weaken existing assertions to hide a regression.

**Feel check:** With reduction on before launch, fit and zoom settle instantly and the editor does not smooth-scroll. Toggle reduction halfway through a pointer fit: motion stops and the intended final fit remains correct. Repeated pointer zoom reverses without queued transitions; keyboard activation remains instant. At 10% playback, normal fit decelerates to its final target over260ms and does not start from the wrong scale.

**Done when:** Both D3 canvases and the existing Monaco instance honor preference on mount and live changes, with correct final transforms, no listeners leaked, and no model recreation.
