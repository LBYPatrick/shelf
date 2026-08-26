import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * A popup list that follows the control it belongs to.
 *
 * Shared by every control that opens a list under a field — the select, and the
 * suggesting text input beside it — because the awkward half of that is not the
 * list, it is keeping the list attached to a control on a page that moves.
 *
 * The list has to be teleported to the body: an absolutely positioned child is
 * cut by every ancestor that clips, and in a settings row two of them do — the
 * card the rows sit in has `overflow: hidden` for its rounded corners, and the
 * sheet's body scrolls. The list came out truncated mid-option with the rest of
 * the choices unreachable. Out in the body nothing can clip it, and the only
 * cost is this: the two have to be kept in step by hand.
 */

export interface Placement {
  readonly left: number;
  readonly width: number;
  /** Opening upwards, because there is not enough room below. */
  readonly above: boolean;
  readonly top: number;
  readonly bottom: number;
}

/** Room the list needs below the control before it gives up on opening down. */
const MIN_ROOM = 180;

export interface AnchoredList {
  readonly placement: Ref<Placement>;
  /** Re-reads the trigger's box. Call before opening. */
  readonly reposition: () => void;
}

export function useAnchoredList(
  open: Ref<boolean>,
  anchor: () => HTMLElement | null | undefined,
  onOutside: (event: PointerEvent) => void
): AnchoredList {
  const placement = ref<Placement>({ left: 0, width: 0, above: false, top: 0, bottom: 0 });

  function reposition(): void {
    const trigger = anchor();
    if (!trigger) return;

    const box = trigger.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;

    // Measured against the room available rather than against the list's own
    // height, which is not known until after it has been placed somewhere.
    const above = below < MIN_ROOM && box.top > below;

    placement.value = {
      left: box.left,
      width: box.width,
      above,
      top: box.bottom,
      bottom: window.innerHeight - box.top,
    };
  }

  // Bound at the window rather than the panel: a click that lands on a sheet
  // behind this one still has to dismiss it.
  watch(open, (isOpen) => {
    if (isOpen) {
      window.addEventListener('pointerdown', onOutside, true);
      /*
       * In the capture phase, because the thing that scrolls is a pane
       * somewhere above the control and a scroll event does not bubble out of
       * it. Following rather than closing: the list is attached to a control
       * the reader can still see, and having it vanish because a stray wheel
       * event reached the sheet reads as the app losing it.
       */
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    } else {
      detach();
    }
  });

  function detach(): void {
    window.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  }

  onBeforeUnmount(detach);

  return { placement, reposition };
}

/** The inline style that puts a list where `placement` says. */
export function listStyle(placement: Placement): Record<string, string> {
  return {
    left: `${placement.left}px`,
    width: `${placement.width}px`,
    ...(placement.above ? { bottom: `${placement.bottom}px` } : { top: `${placement.top}px` }),
  };
}
