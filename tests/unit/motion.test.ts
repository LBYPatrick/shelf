import { describe, expect, it } from 'vitest';
import { projectMomentum, rubberband } from '@renderer/styles/motion';

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
