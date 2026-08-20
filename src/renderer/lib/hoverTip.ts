import { reactive } from 'vue';
import type { Directive } from 'vue';

/**
 * The label an icon does not carry.
 *
 * A rail of icons is only legible to someone who already knows what they mean,
 * and `title` is not the answer: the OS tooltip arrives after a second and a
 * half, in a corner of its own choosing, styled by the platform rather than by
 * the app. This is the same affordance, drawn.
 *
 * One bubble for the whole window rather than one per trigger. There is only
 * ever one showing, and a component per button would be several hundred
 * elements standing by to be a label.
 */

export interface TipState {
  label: string;
  /** Where the trigger is, in viewport coordinates. */
  anchor: { top: number; bottom: number; left: number; right: number };
  visible: boolean;
  /** Opened while another was already up, so it should not animate in again. */
  instant: boolean;
}

export const tip = reactive<TipState>({
  label: '',
  anchor: { top: 0, bottom: 0, left: 0, right: 0 },
  visible: false,
  instant: false,
});

/**
 * Long enough that crossing the rail on the way somewhere else does not light
 * up four labels behind you.
 */
const DELAY = 420;
/**
 * ...and skipped entirely while one is already up. Moving along a row of icons
 * is one gesture, and making the reader wait again at every stop is what makes
 * a toolbar feel slow. The grace period is what keeps that true across the gap
 * between leaving one target and entering the next.
 */
const GRACE = 260;

let timer: ReturnType<typeof setTimeout> | undefined;
let closedAt = 0;

function clear(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function show(element: HTMLElement, label: string): void {
  clear();
  if (!label) return;

  const open = () => {
    const box = element.getBoundingClientRect();
    tip.label = label;
    tip.anchor = { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    tip.instant = tip.visible || Date.now() - closedAt < GRACE;
    tip.visible = true;
  };

  if (tip.visible || Date.now() - closedAt < GRACE) open();
  else timer = setTimeout(open, DELAY);
}

export function hideTip(): void {
  clear();
  if (!tip.visible) return;
  tip.visible = false;
  closedAt = Date.now();
}

/**
 * `v-tip="'Settings'"` on any element.
 *
 * A directive rather than a wrapper component because the trigger already
 * exists and already has its own layout — wrapping it would put a box around
 * something the flexbox above it is positioning.
 *
 * Keyboard focus counts. An icon whose meaning is only available to a pointer
 * is an icon half the people using the app cannot read.
 */
export const vTip: Directive<HTMLElement, string | undefined> = {
  mounted(element, binding) {
    const label = () => binding.value ?? '';

    element.addEventListener('pointerenter', () => show(element, label()));
    element.addEventListener('pointerleave', hideTip);
    // A label describing what you just did is noise, and it would otherwise sit
    // there over the thing that changed.
    element.addEventListener('pointerdown', hideTip);
    element.addEventListener('focus', () => {
      if (element.matches(':focus-visible')) show(element, label());
    });
    element.addEventListener('blur', hideTip);
  },
  unmounted: hideTip,
};
