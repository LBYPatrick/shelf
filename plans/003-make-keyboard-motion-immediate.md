# 003 — Make keyboard motion immediate

- **Status**: Implemented
- **Commit**: b8294a4
- **Severity**: HIGH
- **Category**: Frequency and input modality
- **Estimated scope**: Shared motion helper plus Workspace, TableTab, shared list controls, selection controls, EnginePicker, TabStrip and hover tips; roughly 12–16 files

## Problem

`src/renderer/views/Workspace.vue:72` marks every new tab opening, regardless of source. At :1501:

```css
.content__pane--opening > * > * {
  animation: pane-region-in var(--t-sheet) var(--ease-out) backwards;
}
.content__pane--opening > * > :nth-child(n + 5) {
  animation-delay: 175ms;
}
```

300ms plus 175ms delay makes repeated keyboard work wait. Reduced-motion override :1539 changes the keyframe but retains delays. `styles/controls.css:530` opens `.menulist` with `menulist-in var(--t-hover) var(--ease-sheet)` even for typing/arrow keys. `ui/SegmentedControl.vue:73` keyboard steps use the same traveling indicator. `tabs/TableTab.vue:347` keyboard filter opening uses its 220ms fold. `lib/hoverTip.ts:101` focus calls the same `show` function that waits DELAY=420.

## Target

Explicit origin at each interaction: keyboard/programmatic restore is instant (0ms) for position, visibility and focus; normal pointer paths keep bounded existing motion. Do not hold keyboard content at opacity 0 or animate both the departing and arriving selection. Clear all animation-delay for reduced entrances. Pointer new-tab entrance may be one 180ms opacity fade without editor/result regional stagger or scaling; never delay focus. Preserve tab-strip geometry calculations and shared column synchronization.

Pointer list entrance remains 180ms `--ease-sheet`, scale .97→1 and opacity 0→1 from its anchored origin. Keyboard lists render with animation:none. Pointer selection-indicator movement remains 260ms `--ease-sheet`; keyboard sets it immediately. Pointer filter fold remains 220ms `--ease-out`; keyboard geometry is immediate. Focus-visible tooltip bypasses the 420ms dwell and all entrance transforms; pointer dwell/grace remains unchanged. Reduced paths have no travel or delay.

## Repo conventions to follow

`src/renderer/components/ui/ContextMenu.vue` already accepts a trigger to distinguish its owning control. `styles/base.css:225–270` owns timing curves; `styles/controls.css:530` owns the one shared menu list. Extend these patterns rather than copying menu CSS per caller. `lib/hoverTip.ts` keeps pointer grace; preserve it.

## Steps

1. Add a small, typed shared motion-origin utility only if needed; prefer local event origin where available. Treat KeyboardEvent and synthetic keyboard click detail=0 as keyboard; explicitly mark restore/programmatic paths. Do not keep a sticky global last-input flag as the sole source.
2. Carry origin through new-tab actions and Workspace opening state. Keyboard/restore omit the opening class. Replace pointer regional cascade with one 180ms opacity entrance; no delayed children. Clear timer cleanup and reduced delays.
3. Update SelectMenu/SuggestInput shared list opening to disable key-triggered entrance, including typing that opens suggestions. Keep active-descendant/focus positioning and clipping-safe Teleport.
4. Update SegmentedControl/ToggleSwitch/EnginePicker keyboard selection and TabStrip keyboard activation to set the visible state immediately. Preserve pointer marker/indicator motion and active tab geometry. Disable both old/new selected transitions during the keyboard commit frame.
5. Give TableTab's keyboard filter opening an instant path; preserve the pointer fold and direct focus.
6. Separate focus-visible tooltip opening from pointer dwell. Render an instant focus label while retaining pointer grace, placement and dismissal. Include ContextMenu keyboard entrances in the same origin policy; avoid animating keyboard focus.
7. Add targeted keyboard-vs-pointer checks for new tab, suggestions, segmentation and tips, plus reduction with all delays zero. Update story coverage for newly exposed origin behavior if props change.

## Boundaries

- Do not alter database operations, keybindings, tab contents, layout width sources or hit-target sizes.
- Do not introduce animations into command palette search, SQL input, grid data or shortcut recording.
- Preserve intentional sheet-height/column-width synchronization; this is an input-origin correction, not a global ban on layout transitions.
- Do not add dependencies or hardcode colors. Preserve token surfaces and the 28px target floor.
- If the cited implementation has materially changed since the commit stamp, report the drift before choosing a different design.

## Verification

**Mechanical:** run `make format`, then `make`. Expect lint, type checking, build, unit, UI and e2e to pass. Run `make gate-full` if component props or story mock shapes change. Review visual diffs before accepting any snapshots. Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` for repository pnpm commands if its implicit dependency verification would reinstall packages. Run UI and e2e sequentially; both use test-results. Do not weaken existing assertions to hide a regression.

**Feel check:** Hold keyboard new-tab/navigation commands: editor and controls are visible/focused immediately. Open suggestions by typing and arrow through options with no scale/fade lag. Tab to icon buttons: labels appear immediately. Pointer openings still feel settled and anchored. At 10% playback, pointer tab entrance has no regional queue; keyboard paths have no animation to slow. Under reduction no delayed invisible children remain.

**Done when:** Keyboard and restored views have no entrance/travel delays, pointer motion remains bounded and interruption-safe, focus semantics and existing tab geometry tests pass.
