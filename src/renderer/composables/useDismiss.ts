import { onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * Escape closes the top one.
 *
 * Every overlay used to listen for Escape itself, at the window and in the
 * capture phase — which each of them had a good reason for: an overlay that
 * waits for the key to bubble out of its own panel stops closing the moment
 * focus lands anywhere else, which is exactly when someone reaches for Escape.
 *
 * The reason is right and the consequence was wrong. Listeners on the same node
 * in the same phase all run, and `stopPropagation` does not stop the siblings
 * beside it, so a menu opened from a sheet took the sheet with it and a sheet
 * opened from a sheet took both. One press dismissed the whole stack.
 *
 * So there is one listener and one stack. Overlays push as they open and are
 * popped in the order they were pushed, which is the order they are piled up on
 * screen — the last one opened is the first one Escape reaches, and nothing
 * below it hears the key at all.
 */
const stack: Array<() => void> = [];

let listening = false;

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;

  const top = stack[stack.length - 1];
  if (!top) return;

  event.preventDefault();
  event.stopPropagation();
  top();
}

/**
 * Registers an overlay for as long as it is open.
 *
 * `dismiss` is for overlays that have to do more than flip the flag; without
 * it, the flag is what gets flipped.
 */
export function useDismiss(open: Ref<boolean>, dismiss?: () => void): void {
  const close = () => {
    if (dismiss) dismiss();
    else open.value = false;
  };

  function pop(): void {
    const at = stack.lastIndexOf(close);
    if (at !== -1) stack.splice(at, 1);
  }

  watch(
    open,
    (isOpen) => {
      pop();
      if (!isOpen) return;

      if (!listening) {
        window.addEventListener('keydown', onKeydown, true);
        listening = true;
      }
      stack.push(close);
    },
    { immediate: true }
  );

  onBeforeUnmount(pop);
}
