import { onScopeDispose, ref } from 'vue';

/** A scoped, live bridge for imperative animations that CSS cannot stop. */
export function useReducedMotion() {
  const media = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = ref(media.matches);
  const update = () => (reduced.value = media.matches);
  media.addEventListener('change', update);
  onScopeDispose(() => media.removeEventListener('change', update));
  return reduced;
}

/** Synthetic keyboard clicks have detail=0. Restored state has no event. */
export function pointerMotion(event?: Event): boolean {
  return event instanceof MouseEvent && event.detail > 0;
}

/** The app's cubic-bezier(.23,1,.32,1), evaluated for D3's easing API. */
export function motionEaseOut(progress: number): number {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.23 + 3 * (1 - t) * t ** 2 * 0.32 + t ** 3;
    if (x < progress) lo = t;
    else hi = t;
  }
  return 1 - (1 - (lo + hi) / 2) ** 3;
}

/** Clamp zoom while keeping the world point under the viewport center fixed. */
export function zoomDestination(
  current: { x: number; y: number; k: number },
  by: number,
  center: readonly [number, number],
  extent: readonly [number, number]
) {
  const k = Math.max(extent[0], Math.min(extent[1], current.k * by));
  return {
    x: center[0] - ((center[0] - current.x) * k) / current.k,
    y: center[1] - ((center[1] - current.y) * k) / current.k,
    k,
  };
}

/**
 * For overlays opened by their owner: keep origin through the native event task
 * and its reactive flush, then clear it. A microtask in capture can run before
 * the target handler or Vue's parent-to-child prop update. This is an activation
 * window, never a persistent last-input preference.
 */
export function usePointerActivation() {
  let pointer = false;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const record = (event: Event) => {
    clearTimeout(reset);
    pointer =
      event.type === 'contextmenu'
        ? event instanceof MouseEvent && event.button === 2
        : pointerMotion(event);
    reset = setTimeout(() => {
      pointer = false;
      reset = undefined;
    }, 0);
  };
  const events = ['click', 'contextmenu', 'keydown'] as const;
  for (const name of events) globalThis.addEventListener(name, record, true);
  onScopeDispose(() => {
    clearTimeout(reset);
    pointer = false;
    for (const name of events) globalThis.removeEventListener(name, record, true);
  });
  return () => pointer;
}
