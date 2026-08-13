import { onScopeDispose, ref, shallowRef, type Ref } from 'vue';
import { projectMomentum, rubberband } from '../styles/motion';

/**
 * A sample of pointer position over time. We keep a short history rather than
 * only the latest point because release velocity — the thing that makes a flick
 * feel like a throw — cannot be recovered from a single sample.
 */
interface Sample {
  readonly value: number;
  readonly time: number;
}

/** Samples older than this contribute nothing to the release velocity. */
const VELOCITY_WINDOW_MS = 100;

/** Movement required before a drag commits, so a click is never a tiny drag. */
const DEFAULT_THRESHOLD = 4;

export interface DragBounds {
  readonly min: number;
  readonly max: number;
}

export interface DragState {
  /** The current value, tracking the pointer one-to-one. */
  readonly value: number;
  /** Pointer velocity in px/s, signed. */
  readonly velocity: number;
  /** How far past a bound the pointer has travelled, before resistance. */
  readonly overshoot: number;
}

export interface UseDragOptions {
  /** Which axis the gesture reads. */
  axis?: 'x' | 'y';
  /** Read the value at gesture start; the delta is applied to this. */
  getValue: () => number;
  /** Called on every pointer move with the tracked value. */
  onDrag: (state: DragState) => void;
  /**
   * Called once on release. `projected` is where the momentum would carry the
   * value; hand it, and the velocity, to a spring.
   */
  onRelease?: (state: DragState & { projected: number }) => void;
  /** Clamp with progressive resistance rather than a hard stop. */
  bounds?: () => DragBounds;
  /** Size of the container along the drag axis; sets how quickly the edge resists. */
  extent?: () => number;
  threshold?: number;
  /** Inverts the delta, for handles that grow the opposite way to the pointer. */
  invert?: boolean;
}

/**
 * One-to-one pointer dragging with velocity, momentum projection and
 * rubber-banding.
 *
 * Three details make the difference between this and a naive mousemove handler,
 * and all three are the reason it exists:
 *
 *  - The grab offset is preserved. The value moves by the pointer's *delta*
 *    from where it was grabbed, so the element never jumps to centre itself
 *    under the finger on the first frame.
 *  - Pointer capture keeps tracking alive when the pointer leaves the element,
 *    so a fast drag does not silently detach.
 *  - Release velocity is measured over a short window and handed back, so the
 *    animation that follows continues at the speed of the hand instead of
 *    restarting from zero.
 */
export function useDrag(options: UseDragOptions) {
  const {
    axis = 'x',
    getValue,
    onDrag,
    onRelease,
    bounds,
    extent,
    threshold = DEFAULT_THRESHOLD,
    invert = false,
  } = options;

  const dragging = ref(false);
  const samples = shallowRef<Sample[]>([]);

  let pointerId: number | null = null;
  let target: HTMLElement | null = null;
  let origin = 0;
  let startValue = 0;
  let committed = false;

  const coordinate = (event: PointerEvent) => (axis === 'x' ? event.clientX : event.clientY);

  /** Velocity in px/s from the recent samples; zero if the pointer was resting. */
  function releaseVelocity(): number {
    const history = samples.value;
    const last = history[history.length - 1];
    if (!last) return 0;

    const cutoff = last.time - VELOCITY_WINDOW_MS;
    const first = history.find((sample) => sample.time >= cutoff);
    if (!first || first === last) return 0;

    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;

    return ((last.value - first.value) / elapsed) * 1000;
  }

  /** Apply bounds as resistance, not as a wall. */
  function resist(raw: number): { value: number; overshoot: number } {
    const limits = bounds?.();
    if (!limits) return { value: raw, overshoot: 0 };

    const span = extent?.() ?? Math.max(limits.max - limits.min, 1);

    if (raw < limits.min) {
      const overshoot = raw - limits.min;
      return { value: limits.min + rubberband(overshoot, span), overshoot };
    }
    if (raw > limits.max) {
      const overshoot = raw - limits.max;
      return { value: limits.max + rubberband(overshoot, span), overshoot };
    }
    return { value: raw, overshoot: 0 };
  }

  function handleMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;

    const position = coordinate(event);
    const rawDelta = position - origin;

    if (!committed) {
      if (Math.abs(rawDelta) < threshold) return;
      committed = true;
      dragging.value = true;
      // Re-anchor at the point the drag committed so the value does not jump by
      // the threshold distance on the first tracked frame.
      origin = position;
      return;
    }

    const delta = invert ? -rawDelta : rawDelta;
    const { value, overshoot } = resist(startValue + delta);

    samples.value = [...samples.value, { value: position, time: event.timeStamp }].slice(-12);

    onDrag({ value, velocity: releaseVelocity(), overshoot });
  }

  function handleUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;

    const wasDragging = committed;
    const velocityRaw = releaseVelocity();
    const velocity = invert ? -velocityRaw : velocityRaw;

    detach();

    if (!wasDragging || !onRelease) return;

    const { value, overshoot } = resist(
      startValue + (invert ? -1 : 1) * (coordinate(event) - origin)
    );
    onRelease({
      value,
      velocity,
      overshoot,
      projected: value + projectMomentum(velocity),
    });
  }

  function detach(): void {
    if (target && pointerId !== null) {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      target.removeEventListener('pointercancel', handleUp);
    }
    target = null;
    pointerId = null;
    committed = false;
    dragging.value = false;
    samples.value = [];
  }

  function start(event: PointerEvent): void {
    // Secondary buttons open menus; they are not drags.
    if (event.button !== 0 || pointerId !== null) return;

    target = event.currentTarget as HTMLElement;
    pointerId = event.pointerId;
    origin = coordinate(event);
    startValue = getValue();
    committed = false;
    samples.value = [{ value: origin, time: event.timeStamp }];

    target.setPointerCapture(pointerId);
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
    target.addEventListener('pointercancel', handleUp);
  }

  onScopeDispose(detach);

  return { start, dragging: dragging as Readonly<Ref<boolean>> };
}
