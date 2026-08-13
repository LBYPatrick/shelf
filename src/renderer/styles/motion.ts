/**
 * Motion constants.
 *
 * Springs, not durations: a spring animates from wherever the value currently
 * is, which is what lets a user grab something mid-flight and reverse it. A
 * fixed-duration keyframe cannot do that, so gesture-driven motion never uses
 * one.
 *
 * Two parameters describe every spring here. `bounce` is overshoot — 0 settles
 * without oscillating, higher values spring past the target. `duration` is how
 * quickly it converges, not a hard stop.
 */

export const SPRING = {
  /**
   * The default for anything the user did not throw. Critically damped:
   * overshoot on a menu that simply appeared reads as a glitch.
   */
  default: { type: 'spring', bounce: 0, duration: 0.35 },

  /** Only after a drag or flick, where the momentum is already in the user's hand. */
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 },

  /** Sheets and drawers arrive with a little weight. */
  sheet: { type: 'spring', bounce: 0.2, duration: 0.3 },

  /** Layout reflow — tab reorder, list insertion. Fast and settled. */
  layout: { type: 'spring', bounce: 0, duration: 0.28 },
} as const;

/** Non-spring easings, for the few things that are not physical. */
export const EASE = {
  /** Sheet travel; Apple's sheet curve. */
  sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** Entrances. */
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Exits — the inverse of `out`, so a reversible transition retraces its path. */
  in: 'cubic-bezier(0.7, 0, 0.84, 0)',
} as const;

export const DURATION = {
  /** Press feedback. Anything slower stops feeling like a button. */
  press: 100,
  micro: 150,
  short: 220,
  medium: 350,
} as const;

/** Stagger between items in a list entrance, and the ceiling on the total. */
export const STAGGER = { step: 0.03, max: 0.4 } as const;

/**
 * Where a flick would come to rest, given its release velocity. This is the
 * exponential-decay model scrolling uses, not the textbook v²/2a — it is what
 * makes a thrown element land where the hand expected.
 *
 * @param velocity Release velocity in px/s.
 * @param decelerationRate 0.998 for a normal scroll feel, 0.99 for snappier.
 * @returns Distance the element would travel past the release point, in px.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary. A hard stop reads as frozen; this
 * reads as "still responding, but there is nothing more here".
 *
 * @param overshoot How far past the bound the pointer has travelled, in px.
 * @param dimension Size of the container along the same axis, in px.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** True when the user has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
