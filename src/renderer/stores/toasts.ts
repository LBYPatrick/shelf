import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Things worth saying that have nowhere to be said.
 *
 * A tab can report its own failures inline, next to the thing that failed. What
 * has no home is anything that happens *between* tabs or underneath them — the
 * connection host dying, a background import finishing — and until this existed
 * those went to `console.error`, which is to say nowhere.
 *
 * Deliberately not a general notification centre. A toast is a sentence that
 * expires; anything that needs to be kept belongs in the interface proper.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly title?: string;
  readonly tone: ToastTone;
  readonly action?: ToastAction;
  /** Milliseconds before it leaves on its own; absent means it waits. */
  readonly expire?: number;
}

/** How long an ordinary toast stays up when it does not say otherwise. */
const DEFAULT_EXPIRE = 5000;

export const useToasts = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([]);
  let counter = 0;

  /**
   * Raises a toast, replacing any earlier one with the same id.
   *
   * Replacing rather than stacking is what makes an id worth passing: a setting
   * flipped four times should leave one toast saying what it is now, not four
   * saying what it was.
   */
  function show(toast: Omit<Toast, 'id'> & { id?: string }): string {
    counter += 1;
    const id = toast.id ?? `toast-${counter}`;

    const next: Toast = {
      expire: DEFAULT_EXPIRE,
      ...toast,
      id,
    };

    toasts.value = [...toasts.value.filter((existing) => existing.id !== id), next];
    return id;
  }

  function dismiss(id: string): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function clear(): void {
    toasts.value = [];
  }

  return { toasts, show, dismiss, clear };
});
