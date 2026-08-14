/**
 * The physics behind a gesture.
 *
 * Two functions, both of them about what happens when the hand lets go: where a
 * flick would come to rest, and how hard a boundary should push back. `useDrag`
 * is the only caller, and the CSS side of motion — curves and durations — lives
 * with the other tokens in `base.css` rather than being declared twice.
 *
 * There were four tables of spring constants here as well. Nothing read any of
 * them; the interface animates in CSS.
 */

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
