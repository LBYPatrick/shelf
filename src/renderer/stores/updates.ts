import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UpdateState } from '@shared/updates';

/**
 * The update flow, as the interface sees it.
 *
 * The state itself is main's — it is one flow for the whole app, and a second
 * window must not be able to think a download is happening when it is not — so
 * this holds a copy and subscribes to the changes rather than deriving
 * anything. What it *owns* is the one question main has no business answering:
 * whether the sheet is on screen.
 *
 * That split is what makes the two ways in behave the same. A check asked for
 * by a button opens the panel immediately and lets the reader watch it happen;
 * the one that runs at launch opens nothing until it has something to say. Same
 * check, two entry points — `check` and `checkQuietly` below.
 */
export const useUpdates = defineStore('updates', () => {
  const state = ref<UpdateState>({
    phase: 'idle',
    current: '',
    delivery: 'download-page',
  });

  const open = ref(false);

  /**
   * Whether the app can fetch and apply the update itself.
   *
   * Read straight from the delivery main declared, never guessed at from the
   * platform: the same operating system installs this app in ways that can and
   * cannot be replaced in place, and only main knows which one this is.
   */
  const canInstall = computed(() => state.value.delivery === 'in-app');

  const busy = computed(
    () => state.value.phase === 'checking' || state.value.phase === 'downloading'
  );

  window.shelf.updates.onChanged((next) => {
    state.value = next;

    /*
     * Two states open the panel by themselves, and only two.
     *
     * A new build, because that is the whole point of checking at launch. And a
     * finished download, because the reader who started it may have closed the
     * panel while it ran — the app is now holding a hundred megabytes and one
     * button away from using them, and saying nothing about that would be the
     * download going nowhere.
     *
     * Everything else — checking, up to date, failed — is only ever shown in a
     * panel somebody already opened. "You are up to date" is worth saying to
     * whoever pressed the button and is an interruption to whoever did not.
     */
    if (next.phase === 'available' || next.phase === 'ready') open.value = true;
  });

  const ready = window.shelf.updates
    .state()
    .then((initial) => {
      state.value = initial;
    })
    .catch(() => undefined);

  /**
   * Looks for a newer build, on somebody's say-so.
   *
   * The panel opens first, before the answer: the check takes a moment, and a
   * button that does nothing visible until the network replies is a button
   * people press twice.
   */
  async function check(): Promise<void> {
    open.value = true;
    state.value = await window.shelf.updates.check();
  }

  /**
   * The same check, at launch, with nobody waiting for it.
   *
   * Nothing opens until there is something to open it for — the subscription
   * above decides that. Two named functions rather than one taking a flag,
   * because the difference is the whole behaviour and `check({ silent: false })`
   * at three call sites says it worst.
   */
  async function checkQuietly(): Promise<void> {
    state.value = await window.shelf.updates.check();
  }

  async function download(): Promise<void> {
    state.value = await window.shelf.updates.download();
  }

  function install(): void {
    window.shelf.updates.install();
  }

  async function openPage(): Promise<void> {
    await window.shelf.updates.openPage();
  }

  /**
   * Closes the prompt, and tells main it was closed.
   *
   * Without the second half, a silent check that found something would reopen
   * the sheet the next time any window subscribed — the state would still say
   * `available`, and the interface would be right to draw it.
   */
  function dismiss(): void {
    open.value = false;
    window.shelf.updates.dismiss();
  }

  return {
    state,
    open,
    ready,
    canInstall,
    busy,
    check,
    checkQuietly,
    download,
    install,
    openPage,
    dismiss,
  };
});
