# 002 — Keep streaming chats pinned

- **Status**: Implemented
- **Commit**: b8294a4
- **Severity**: HIGH
- **Category**: Continuity and function
- **Estimated scope**: ChatTab.vue and focused transcript test; roughly 2–3 files

## Problem

`src/renderer/components/assistant/ChatTab.vue:245` follows only item counts/running flags:

```ts
watch(
  () => chat.value.turns.map((turn) => turn.items.length + (turn.state === 'running' ? 1 : 0)),
  () => void follow(),
  { deep: true }
);
```

`src/renderer/stores/assistant.ts:517` streams into an existing item:

```ts
turn.items.splice(at, 1, { ...item, text: item.text + payload.text });
```

The watched count stays unchanged while text wraps and grows. ChatTab :702 disables browser scroll anchoring. The existing follow method checks pinned before nextTick but does not recheck after it.

## Target

Observe the natural `.chat__column` height, not a full deep transcript serialization. Coalesce height updates to at most one requestAnimationFrame. After Vue renders, recheck active tab and pinned state and assign `scrollTop = scrollHeight` instantly (0ms). Never smooth-scroll streaming text. A reader who scrolls away must retain position even if an already scheduled callback fires. Hidden tabs must not scroll or generate resize work; all observers/frame handles are disposed.

## Repo conventions to follow

`ChatTab.vue:231` already documents why follow is instant. `src/renderer/components/ui/Sheet.vue` observes the natural content wrapper rather than the constrained box; imitate the measurement ownership, not its sheet-height animation. `useDismiss`/Vue scope cleanup show the repository lifecycle style.

## Steps

1. Add a ref to the existing natural transcript column and one ResizeObserver owned by the mounted view; no extra visual wrapper is required.
2. Replace the count-only follow dependency with a single scheduled follow path invoked by observer growth, active-tab return, and initial rendering as needed. Cancel pending frames when hidden/unmounted.
3. Recheck active/pinned status inside the scheduled callback after nextTick. Do not change pinned during programmatic follow; user scroll remains its source of truth.
4. Keep send/stop/retry and store streaming updates unchanged. Do not observe every token via a deep watcher.
5. Add a focused renderer regression with one text item growing over several deltas, an off-bottom reader, late Markdown layout growth, switching tabs, and disposal. Assert bottom distance/retained scroll, not counts.

## Boundaries

- Do not change provider transport, assistant tool loops, transcript fold intent, SQL formatting or persisted chat shapes.
- Do not add token entrance animations, transcript fades, or smooth-scroll behavior.
- Do not add dependencies or hardcode colors. Preserve token surfaces and the 28px target floor.
- If the cited implementation has materially changed since the commit stamp, report the drift before choosing a different design.

## Verification

**Mechanical:** run `make format`, then `make`. Expect lint, type checking, build, unit, UI and e2e to pass. Run `make gate-full` if component props or story mock shapes change. Review visual diffs before accepting any snapshots. Use `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` for repository pnpm commands if its implicit dependency verification would reinstall packages. Run UI and e2e sequentially; both use test-results. Do not weaken existing assertions to hide a regression.

**Feel check:** Stream a long wrapped answer while pinned: the last line stays visible without easing behind the stream. Scroll upward during an in-flight frame: the viewport stays where the reader put it. Return to the tab, expand a result and resize the window; follow only while pinned. At 10% playback and under reduction the follow behavior remains the same instant assignment.

**Done when:** Text growth with unchanged item count follows correctly while pinned, never moves an unpinned/hidden reader, and observer/frame cleanup passes.
