/**
 * Updates: what a new build is, and how this copy of the app can get one.
 *
 * The moving parts live in main — `electron-updater` needs the filesystem, the
 * signature and the process it is going to replace. What is here is the part
 * that is decidable without any of that: which version is newer, what a GitHub
 * release page says, and *how* this particular install can be updated at all.
 * All three are pure, and all three are unit tested, because each of them is a
 * place where being wrong produces a plausible answer rather than an error.
 *
 * The last one is the rule that makes this work everywhere. An app that can
 * replace itself in place and one that cannot are not the same feature with an
 * error in the middle — they are two deliveries, declared here and chosen once,
 * the same way an engine's capabilities are declared rather than discovered by
 * calling a method and catching "not supported":
 *
 *   in-app         the update is downloaded and installed by the app, and the
 *                  app restarts into it. macOS, the Windows installer, and a
 *                  Linux AppImage.
 *   download-page  the app can only say a new version exists and open the page
 *                  it is on. A .deb or .rpm belongs to the package manager, the
 *                  Windows portable build is a file somebody put where they
 *                  wanted it, and a development build is not a release at all.
 *
 * Both tell the reader the same thing at the same moment. What differs is the
 * one button at the end of it, and a reader on a .deb is never shown a Restart
 * that could not have worked.
 */

/** Channels for the update flow. Kept beside the other main-process channels. */
export const UPDATE_CHANNELS = {
  state: 'update:state',
  check: 'update:check',
  download: 'update:download',
  install: 'update:install',
  openPage: 'update:open-page',
  dismiss: 'update:dismiss',
  changed: 'update:changed',
} as const;

/** How this install can be brought to a newer build. See the note above. */
export type UpdateDelivery = 'in-app' | 'download-page';

/**
 * Where the flow has got to.
 *
 * `current` and `available` are both answers to a check; the difference is
 * whether there is anything to do next. `error` carries a message and is not a
 * dead end — checking again is always offered.
 */
export type UpdatePhase =
  'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateRelease {
  /** Three numbers, without the tag's leading `v`. */
  readonly version: string;
  /** The release page's body, as the markdown it was written in. */
  readonly notes: string;
  /** The page a reader is sent to when the app cannot install it itself. */
  readonly url: string;
  /** ISO 8601, when the release said so. */
  readonly publishedAt?: string;
}

export interface UpdateProgress {
  readonly transferred: number;
  readonly total: number;
  /** 0–100, as the updater reports it. */
  readonly percent: number;
  readonly bytesPerSecond: number;
}

export interface UpdateState {
  readonly phase: UpdatePhase;
  /** The running build, so the sheet can say what it is moving away from. */
  readonly current: string;
  readonly delivery: UpdateDelivery;
  readonly release?: UpdateRelease;
  readonly progress?: UpdateProgress;
  /** Why the last check or download failed, in the words the failure used. */
  readonly message?: string;
}

/*
 * There is deliberately no "was this check asked for" flag on the state.
 *
 * It was the obvious place to put one — a check nobody asked for must not open
 * a panel to say "you are up to date" — but the flow never needed to know. What
 * differs between the two is only whether the interface opens the panel *before*
 * the answer arrives, which is a decision made where the check is started and
 * never read again. A field that crosses the boundary and is never asked a
 * question is a field somebody will later make a decision from.
 */

export interface UpdateApi {
  /** What the flow currently knows, without starting anything. */
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  /** Quits and comes back on the new build. Never returns. */
  install(): void;
  /** Opens the release page in the browser. */
  openPage(): Promise<void>;
  /** Puts the flow back to idle, so a dismissed prompt does not reappear. */
  dismiss(): void;
  onChanged(listener: (state: UpdateState) => void): () => void;
}

/* ------------------------------------------------------------------ versions */

interface Parsed {
  readonly numbers: readonly number[];
  readonly pre: readonly string[];
}

/**
 * `1.4.0-beta.2` as parts, and anything unparseable as nothing.
 *
 * Tolerant of a leading `v` because that is how the tag is spelled and how half
 * the places that quote a version spell it too.
 */
function parse(version: string): Parsed | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return undefined;

  return {
    numbers: [match[1], match[2], match[3]].map((part) => Number(part ?? 0)),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compares two identifiers the way semver does: numbers below strings, numbers
 * numerically, everything else by code point.
 */
function comparePre(a: readonly string[], b: readonly string[]): number {
  // A release outranks a prerelease of the same numbers; two releases tie.
  if (a.length === 0 || b.length === 0) {
    return (a.length === 0 ? 1 : 0) - (b.length === 0 ? 1 : 0);
  }

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) return Number(left) - Number(right) > 0 ? 1 : -1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Negative if `a` is older, positive if newer, zero if they are the same build.
 *
 * A version this cannot read sorts *below* one it can, which is the safe
 * direction: an unreadable running version means "everything looks newer than
 * you", and an unreadable release means "this is not an upgrade". Both are
 * recoverable by a reader looking at the page; the opposite of either is an app
 * that offers to install nonsense.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);

  for (let index = 0; index < 3; index += 1) {
    const difference = left.numbers[index]! - right.numbers[index]!;
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return comparePre(left.pre, right.pre);
}

/** Whether `candidate` is a build worth telling somebody about. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/* ------------------------------------------------------------------ delivery */

export interface InstallFacts {
  /** `process.platform`. */
  readonly platform: string;
  /** `app.isPackaged`. A development build is not a release. */
  readonly packaged: boolean;
  /** `process.env.APPIMAGE`, set only when running from an AppImage. */
  readonly appImage: boolean;
  /** `process.env.PORTABLE_EXECUTABLE_DIR`, set by the Windows portable build. */
  readonly portable: boolean;
}

export function updateDelivery(facts: InstallFacts): UpdateDelivery {
  // An unpackaged build has no `app-update.yml` to check against and no
  // installer to hand itself to. It can still read the releases page, which is
  // what makes this flow exercisable while developing it.
  if (!facts.packaged) return 'download-page';

  switch (facts.platform) {
    case 'darwin':
      return 'in-app';
    // The portable build is a single file wherever its owner put it; there is
    // nothing installed for an installer to replace.
    case 'win32':
      return facts.portable ? 'download-page' : 'in-app';
    // A .deb or .rpm belongs to the package manager that put it there, and an
    // app that overwrote its own files behind apt's back would be a worse
    // citizen than one that says where the new version is.
    case 'linux':
      return facts.appImage ? 'in-app' : 'download-page';
    default:
      return 'download-page';
  }
}

/* -------------------------------------------------------------------- GitHub */

/** The page a release lives on, when nothing has told us its real URL yet. */
export function releasePageUrl(repository: string, version: string): string {
  return `https://github.com/${repository}/releases/tag/v${version}`;
}

/** Where the latest release is asked for. Excludes drafts and prereleases. */
export function latestReleaseUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

/**
 * A URL this app is willing to hand to the operating system.
 *
 * `html_url` arrives over the network and ends up at `shell.openExternal`,
 * which is not a browser — it is "open this with whatever handles it", and a
 * `file:` or a custom scheme there is a program being launched by a server's
 * say-so. The release page is a GitHub page over https or it is not opened;
 * anything else falls back to the address we assembled ourselves.
 */
function openableUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const github = host === 'github.com' || host.endsWith('.github.com');
    return url.protocol === 'https:' && github ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A release, out of whatever the API returned.
 *
 * Parsed defensively rather than cast: this is the one payload in the app that
 * comes from outside the machine, and a field that is missing should produce a
 * release with no notes rather than a page that throws while rendering them.
 */
export function readRelease(payload: unknown, repository: string): UpdateRelease | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;

  const tag = typeof record['tag_name'] === 'string' ? record['tag_name'] : '';
  const version = parse(tag) ? tag.trim().replace(/^v/, '') : '';
  if (!version) return undefined;

  return {
    version,
    notes: typeof record['body'] === 'string' ? record['body'].trim() : '',
    url: openableUrl(record['html_url']) ?? releasePageUrl(repository, version),
    ...(typeof record['published_at'] === 'string'
      ? { publishedAt: record['published_at'] }
      : {}),
  };
}
