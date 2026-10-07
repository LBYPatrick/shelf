import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, watch } from 'vue';
import {
  motionEaseOut,
  pointerMotion,
  useReducedMotion,
  usePointerActivation,
  zoomDestination,
} from '../../src/renderer/composables/useMotion';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('imperative motion policy', () => {
  it('tracks a live preference and removes its listener with the component scope', () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: true,
      addEventListener: vi.fn((_name: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media)
    );
    const scope = effectScope();
    const reduced = scope.run(() => useReducedMotion())!;
    expect(reduced.value).toBe(true);
    media.matches = false;
    listener!();
    expect(reduced.value).toBe(false);
    media.matches = true;
    listener!();
    expect(reduced.value).toBe(true);
    scope.stop();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('allows motion only for a real pointer click, never restored state or synthetic keyboard click', () => {
    class Click {
      constructor(public detail: number) {}
    }
    vi.stubGlobal('MouseEvent', Click);
    expect(pointerMotion(new Click(1) as unknown as Event)).toBe(true);
    expect(pointerMotion(new Click(0) as unknown as Event)).toBe(false);
    expect(pointerMotion(undefined)).toBe(false);
    expect(pointerMotion({ type: 'keydown' } as Event)).toBe(false);
  });

  it('matches the declared strong ease-out and stays bounded and monotonic', () => {
    expect(motionEaseOut(0)).toBe(0);
    expect(motionEaseOut(1)).toBe(1);
    expect(motionEaseOut(0.5)).toBeCloseTo(0.966, 2);
    const samples = Array.from({ length: 101 }, (_, i) => motionEaseOut(i / 100));
    expect(
      samples.every((value, i) => value >= 0 && value <= 1 && (!i || value >= samples[i - 1]!))
    ).toBe(true);
  });

  it('clamps scale without shifting the world point under the zoom center', () => {
    const current = { x: 31, y: -72, k: 1.7 };
    const center = [400, 300] as const;
    for (const by of [0.0001, 1.4, 100]) {
      const next = zoomDestination(current, by, center, [0.05, 4]);
      expect(next.k).toBeGreaterThanOrEqual(0.05);
      expect(next.k).toBeLessThanOrEqual(4);
      expect((center[0] - next.x) / next.k).toBeCloseTo((center[0] - current.x) / current.k);
      expect((center[1] - next.y) / next.k).toBeCloseTo((center[1] - current.y) / current.k);
    }
  });
});

describe('overlay event origin', () => {
  it('survives the owner reactive flush, clears at the next task and cleans up', async () => {
    vi.useFakeTimers();
    class Click extends Event {
      constructor(
        type: string,
        public detail: number,
        public button = 0
      ) {
        super(type);
      }
    }
    vi.stubGlobal('MouseEvent', Click);
    const target = new EventTarget();
    const add = vi.fn(target.addEventListener.bind(target));
    const remove = vi.fn(target.removeEventListener.bind(target));
    vi.stubGlobal('addEventListener', add);
    vi.stubGlobal('removeEventListener', remove);
    const scope = effectScope();
    const origin = scope.run(() => usePointerActivation())!;
    const observed: boolean[] = [];
    const ownerOpen = ref(false);
    let childOrigin: boolean | undefined;
    scope.run(() =>
      watch(ownerOpen, () => {
        childOrigin = origin();
      })
    );
    target.addEventListener('click', () => {
      observed.push(origin());
      ownerOpen.value = !ownerOpen.value;
    });
    target.dispatchEvent(new Click('click', 1));
    expect(observed).toEqual([true]);
    await nextTick();
    expect(childOrigin).toBe(true);
    expect(origin()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(origin()).toBe(false);
    target.dispatchEvent(new Click('click', 0));
    expect(observed).toEqual([true, false]);
    target.dispatchEvent(new Click('contextmenu', 0, 2));
    expect(origin()).toBe(true);
    target.dispatchEvent(new Event('keydown'));
    expect(origin()).toBe(false);
    scope.stop();
    expect(remove).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
