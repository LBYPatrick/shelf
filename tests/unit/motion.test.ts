import { describe, expect, it } from 'vitest';
import { projectMomentum, rubberband } from '@renderer/styles/motion';
import { elapsedLabel } from '@renderer/composables/useElapsed';

describe('momentum projection', () => {
  it('does not move when there is no velocity', () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it('carries direction', () => {
    expect(projectMomentum(500)).toBeGreaterThan(0);
    expect(projectMomentum(-500)).toBeLessThan(0);
  });

  it('scales linearly with release velocity', () => {
    expect(projectMomentum(1000)).toBeCloseTo(2 * projectMomentum(500), 6);
  });

  it('throws far enough for a flick to feel like a throw', () => {
    // A brisk flick is around 1500 px/s; it should travel most of a screen.
    expect(projectMomentum(1500)).toBeGreaterThan(600);
  });

  it('travels less as deceleration increases', () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000, 0.998));
  });
});

describe('rubber-banding', () => {
  it('does not resist before the boundary is crossed', () => {
    expect(rubberband(0, 800)).toBe(0);
  });

  it('always yields less than the raw overshoot, so the edge feels heavier', () => {
    for (const overshoot of [10, 50, 200, 800]) {
      expect(Math.abs(rubberband(overshoot, 800))).toBeLessThan(overshoot);
    }
  });

  it('resists progressively harder the further past the edge you pull', () => {
    const dimension = 800;
    const ratioAt = (overshoot: number) => rubberband(overshoot, dimension) / overshoot;
    expect(ratioAt(400)).toBeLessThan(ratioAt(50));
  });

  it('tracks nearly one-to-one at the very start, so the edge is not sticky', () => {
    expect(rubberband(2, 800) / 2).toBeGreaterThan(0.5);
  });

  it('is symmetric about the boundary', () => {
    expect(rubberband(-120, 800)).toBeCloseTo(-rubberband(120, 800), 10);
  });

  it('degrades safely when the container has no size', () => {
    expect(rubberband(100, 0)).toBe(0);
  });
});

describe('the stopwatch on a running query', () => {
  it('carries hundredths, so the digit you are watching keeps moving', () => {
    expect(elapsedLabel(0)).toBe('0.00 s');
    expect(elapsedLabel(432)).toBe('0.43 s');
    expect(elapsedLabel(9_949)).toBe('9.95 s');
  });

  it('keeps the same precision as it grows, rather than changing shape', () => {
    expect(elapsedLabel(10_000)).toBe('10.00 s');
    expect(elapsedLabel(59_900)).toBe('59.90 s');
  });

  it('writes minutes as minutes, so nobody divides by sixty', () => {
    expect(elapsedLabel(60_000)).toBe('1:00.00');
    expect(elapsedLabel(83_400)).toBe('1:23.40');
    expect(elapsedLabel(3_723_000)).toBe('62:03.00');
  });

  it('pads the seconds, so the colon never moves', () => {
    expect(elapsedLabel(64_050)).toBe('1:04.05');
  });

  it('never counts backwards from a clock that stepped', () => {
    expect(elapsedLabel(-500)).toBe('0.00 s');
  });
});
