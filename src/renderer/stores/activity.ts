import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * Whether the app is working, and how the last piece of work ended.
 *
 * There was no global sign of either. A query that takes eight seconds looked
 * the same as one that had not started, and one that failed announced itself
 * only inside the tab that ran it — so a failure in a background tab was
 * silent. The status bar is the one piece of chrome always on screen and never
 * competing for attention, which makes it the right place to say both.
 */

/** How long a finished-state wash stays up before fading out. */
const FLASH_MS = 1400;

export type Outcome = 'ok' | 'error';

export const useActivity = defineStore('activity', () => {
  /*
   * A count, not a boolean. Two tabs can be loading at once, and the first of
   * them to finish must not switch the indicator off under the second.
   */
  const inFlight = ref(0);
  const outcome = ref<Outcome | null>(null);

  let clearFlash: ReturnType<typeof setTimeout> | undefined;

  const busy = computed(() => inFlight.value > 0);

  function begin(): void {
    inFlight.value += 1;
    // A new piece of work supersedes the last one's result; leaving a green
    // wash up while something else is running says the wrong thing.
    outcome.value = null;
    clearTimeout(clearFlash);
  }

  function end(result: Outcome): void {
    inFlight.value = Math.max(0, inFlight.value - 1);
    outcome.value = result;

    clearTimeout(clearFlash);
    clearFlash = setTimeout(() => {
      outcome.value = null;
    }, FLASH_MS);
  }

  /**
   * Runs a promise with the indicator on, and reports how it ended.
   *
   * Rejections are re-thrown: this reports on work, it does not handle it. A
   * caller that swallowed its own error because the tracker had already
   * "dealt with" it would be the worse bug.
   */
  async function track<T>(work: Promise<T>): Promise<T> {
    begin();
    try {
      const value = await work;
      end('ok');
      return value;
    } catch (caught) {
      end('error');
      throw caught;
    }
  }

  return { busy, outcome, begin, end, track };
});
