import { onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * How long the thing has been running, counting up while it runs.
 *
 * A query has no progress to report — the server will not say how far through
 * it is — so the only honest signal of "still working" is a clock. It is also
 * the number people actually want: whether to wait or to cancel is decided by
 * how long it has already been, and a sweeping bar answers neither question.
 *
 * Measured with `performance.now`, which is monotonic: a system clock that
 * steps backwards mid-query would otherwise show a run getting shorter.
 */

/**
 * Twenty a second. The readout carries hundredths, so a slower tick would step
 * the last two digits in visible jumps; a faster one would spend frames on a
 * digit nobody can read at that rate.
 */
const TICK_MS = 50;

export function useElapsed(active: Ref<boolean>): Readonly<Ref<number>> {
  const elapsed = ref(0);
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stop(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  watch(active, (running) => {
    stop();
    if (!running) return;

    startedAt = performance.now();
    // Set before the first tick, so the readout starts at zero rather than
    // showing the previous run's total for a tenth of a second.
    elapsed.value = 0;
    timer = setInterval(() => (elapsed.value = performance.now() - startedAt), TICK_MS);
  });

  onScopeDispose(stop);

  return elapsed;
}

/**
 * The clock, written the way a stopwatch writes it.
 *
 * Hundredths throughout, at every length. A readout that changes its precision
 * as it grows — tenths, then whole seconds, then minutes — is three different
 * numbers in the same place, and the digit you were watching moves sideways
 * each time the format changes. Past a minute the seconds are carried in a
 * `m:ss.hh` field rather than counted past sixty, because "83.20 s" makes the
 * reader do the division.
 *
 * The unit is on the number below a minute and implied by the colon above it,
 * so the string is never wider than `mm:ss.hh` and the field it sits in can be
 * sized once and left alone.
 */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 60) return `${total.toFixed(2)} s`;

  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}
