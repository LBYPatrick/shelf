import { BrowserWindow, app, net, shell } from 'electron';
import type { AppUpdater, UpdateInfo } from 'electron-updater';
import {
  UPDATE_CHANNELS,
  isNewerVersion,
  latestReleaseUrl,
  readRelease,
  releasePageUrl,
  updateDelivery,
  type UpdateDelivery,
  type UpdateRelease,
  type UpdateState,
} from '@shared/updates';

/**
 * Finding, fetching and applying a newer build.
 *
 * One object holds the whole flow, because the flow is one state machine and
 * every window is looking at the same copy of the app: a check started from the
 * settings sheet and a check started at launch are the same check, and the
 * answer goes to every window rather than to whichever one asked. That is why
 * the state lives here and is *broadcast*, rather than being returned and then
 * remembered separately by each renderer.
 */

/** How long a check may take before it is called a failure. */
const CHECK_TIMEOUT_MS = 15_000;

/**
 * The repository this app releases from, compiled in from `package.json` — see
 * `electron.vite.config.ts`. The same field is what electron-builder resolves
 * its GitHub publish target from, so the feed and the page cannot disagree.
 */
const REPOSITORY = __APP_REPOSITORY__;

export class Updater {
  private readonly delivery: UpdateDelivery = updateDelivery({
    platform: process.platform,
    packaged: app.isPackaged,
    appImage: Boolean(process.env['APPIMAGE']),
    portable: Boolean(process.env['PORTABLE_EXECUTABLE_DIR']),
  });

  private state: UpdateState = {
    phase: 'idle',
    current: __APP_VERSION__,
    delivery: this.delivery,
  };

  /** One check at a time; a second caller joins the one already running. */
  private running: Promise<UpdateState> | undefined;

  /** `electron-updater`, once something needs it. See `updater()`. */
  private loading: Promise<AppUpdater> | undefined;

  /**
   * Loads and configures `electron-updater`, at the point of first use.
   *
   * Imported lazily, and that is not a micro-optimisation. It is a CommonJS
   * package that drags in a YAML parser, a semver implementation and a logging
   * stack, and it was costing every launch of the app several hundred
   * milliseconds before the window appeared — for a check that runs four
   * seconds later, if it runs at all. On a `download-page` install it is never
   * loaded, because nothing on that path can use it.
   *
   * The interop dance is the price of a CJS default export inside an ESM
   * bundle: `import()` hands back the module object, and the package's exports
   * are on `default`.
   */
  private async updater(): Promise<AppUpdater> {
    this.loading ??= (async () => {
      const module = await import('electron-updater');
      const { autoUpdater } = module.default ?? module;

      /*
       * Never on its own. `autoDownload` defaults to true, which turns a check
       * into tens of megabytes over somebody's tethered connection before they
       * have been asked anything.
       */
      autoUpdater.autoDownload = false;

      // Its console noise stays off; what matters is reported through the
      // state instead — a failed check is a sentence in the sheet, not a line
      // in a log nobody has open.
      autoUpdater.logger = null;

      autoUpdater.on('download-progress', (progress) => {
        this.set({
          phase: 'downloading',
          progress: {
            transferred: progress.transferred,
            total: progress.total,
            percent: progress.percent,
            bytesPerSecond: progress.bytesPerSecond,
          },
        });
      });

      return autoUpdater;
    })();

    return this.loading;
  }

  current(): UpdateState {
    return this.state;
  }

  /**
   * Looks for a newer release.
   *
   * Two paths, chosen from the declared delivery rather than by trying one and
   * catching the other. An installable build asks the updater, because the
   * updater is what will have to download it and it needs to have seen the
   * feed itself; anything else asks GitHub for the release page, which works on
   * a .deb, on a portable .exe, and while developing.
   */
  async check(): Promise<UpdateState> {
    if (this.running) return this.running;

    /*
     * An update already on disk is not a question.
     *
     * Checking again from `ready` would find the same release, call it
     * `available`, and offer to download what has already been downloaded —
     * so the panel would take a reader who is one press from a new version and
     * put them back at the start of the flow. The answer to "is there an
     * update" here is "yes, and it is waiting for you".
     */
    if (this.state.phase === 'ready') return this.state;

    /*
     * Never under test. The suite runs a real build of the app, and a launch
     * that reaches out to GitHub is a test whose result depends on somebody
     * else's uptime — and, on a rate-limited runner, on how many times it has
     * been run in the last hour.
     */
    if (process.env['SHELF_E2E']) {
      return this.set({ phase: 'current', release: undefined, message: undefined });
    }

    this.set({ phase: 'checking', message: undefined });

    this.running = (async () => {
      try {
        const release =
          this.delivery === 'in-app' ? await this.askUpdater() : await this.askGitHub();

        if (!release || !isNewerVersion(release.version, this.state.current)) {
          return this.set({ phase: 'current', release: undefined });
        }
        return this.set({ phase: 'available', release });
      } catch (caught) {
        return this.set({ phase: 'error', message: messageOf(caught) });
      } finally {
        this.running = undefined;
      }
    })();

    return this.running;
  }

  /**
   * Fetches the update the last check found.
   *
   * Only ever reached on an `in-app` delivery: the sheet offers the page
   * instead where the app cannot install anything, so there is no state in
   * which this is the button and could not work.
   */
  async download(): Promise<UpdateState> {
    if (this.state.phase !== 'available') return this.state;

    this.set({ phase: 'downloading', progress: undefined, message: undefined });
    try {
      await (await this.updater()).downloadUpdate();
      return this.set({ phase: 'ready' });
    } catch (caught) {
      return this.set({ phase: 'error', message: messageOf(caught) });
    }
  }

  /**
   * Quits into the new build.
   *
   * `isSilent` is false so the platform's installer shows what it is doing —
   * on Windows that is a progress window rather than a minute of nothing —
   * and `isForceRunAfter` is what brings the app back rather than leaving the
   * reader at their desktop wondering whether it worked.
   */
  install(): void {
    if (this.state.phase !== 'ready') return;
    // Off the IPC callback, so the message is acknowledged before the process
    // starts tearing itself down. The module is already loaded — nothing can be
    // `ready` without having gone through the download.
    setImmediate(
      () => void this.updater().then((updater) => updater.quitAndInstall(false, true))
    );
  }

  async openPage(): Promise<void> {
    const url = this.state.release?.url ?? `https://github.com/${REPOSITORY}/releases/latest`;
    await shell.openExternal(url);
  }

  /**
   * A prompt the reader closed is a prompt that does not come back by itself.
   *
   * Except where closing it would throw work away. A download in flight keeps
   * running, and one that has finished stays finished — Later means later, and
   * a hundred megabytes already on the disk must not be forgotten because a
   * panel was shut.
   */
  dismiss(): void {
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') return;
    this.set({ phase: 'idle' });
  }

  private async askUpdater(): Promise<UpdateRelease | undefined> {
    const updater = await this.updater();
    const result = await withTimeout(updater.checkForUpdates(), CHECK_TIMEOUT_MS);
    if (!result) return undefined;

    const { updateInfo } = result;
    return {
      version: updateInfo.version,
      notes: releaseNotes(updateInfo.releaseNotes),
      url: releasePageUrl(REPOSITORY, updateInfo.version),
      ...(updateInfo.releaseDate ? { publishedAt: updateInfo.releaseDate } : {}),
    };
  }

  /**
   * `net.fetch` rather than the global one: it goes through Chromium's stack,
   * so it uses the proxy the machine is configured with. A reader behind a
   * corporate proxy is exactly the reader for whom "check for updates" quietly
   * doing nothing is most confusing.
   */
  private async askGitHub(): Promise<UpdateRelease | undefined> {
    const response = await withTimeout(
      net.fetch(latestReleaseUrl(REPOSITORY), {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `Shelf/${this.state.current}`,
        },
      }),
      CHECK_TIMEOUT_MS
    );

    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} ${response.statusText}`.trim());
    }
    return readRelease(await response.json(), REPOSITORY);
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(UPDATE_CHANNELS.changed, this.state);
    }
    return this.state;
  }
}

/**
 * A request that never answers is a spinner that never stops.
 *
 * Both paths reach a server, and both can be left hanging by a network that
 * accepted the connection and then said nothing — which is the failure mode of
 * a captive portal, and the one a reader is most likely to be sitting behind
 * when they wonder why nothing is happening.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The check timed out.')), ms);
    timer.unref?.();
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * The notes, whichever shape the feed carried them in.
 *
 * A GitHub release hands back its body as one string; a feed that has
 * accumulated several versions since this one hands back a list of them, and
 * the reader is entitled to all of it — they are skipping more than one
 * release, which is exactly when the notes matter most.
 */
function releaseNotes(notes: UpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string') return notes.trim();
  if (!Array.isArray(notes)) return '';

  return notes
    .map((entry) => (entry.note ? `## ${entry.version}\n\n${entry.note.trim()}` : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
