import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AiDriverKind, AiSignInState } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { findExecutable } from './cli';
import * as claudeCode from './drivers/claudeCode';
import * as codex from './drivers/codex';
import { AiSignInError } from './types';

/**
 * The command-line assistants: which ones this machine has, and whether anybody
 * is signed in to them.
 *
 * Both questions come off one table, because they are asked of the same
 * programs and the answers only mean anything together. A CLI that is installed
 * and signed out is offered in the picker, chosen, and then hangs — which is
 * exactly what it did: the turn sat on "Reading the schema…" for as long as
 * anyone was willing to watch it, because the subprocess was waiting for a
 * login it had no terminal to ask for.
 */

/** How a CLI answers "is anybody signed in", and how to read what it says. */
interface Status {
  readonly args: readonly string[];
  /** `in`, `out`, or — for anything we do not recognise — `unknown`. */
  readonly read: (code: number | null, stdout: string, stderr: string) => AiSignInState;
}

/**
 * Everything the CLI's own error output can be, other than "signed out".
 *
 * A status subcommand is a thing a program can rename, and a version that has
 * renamed it fails with a usage error rather than a login one. Reading that as
 * "not signed in" would send somebody to a terminal to fix a working setup, so
 * it is read as nothing at all and the turn is allowed to run.
 */
const USAGE_ERROR = /\b(?:unrecognized|unknown|unexpected|invalid) (?:sub)?command|^usage:/im;

const CLI_DRIVERS: readonly {
  kind: AiDriverKind;
  command: string;
  where: readonly string[];
  status: Status;
}[] = [
  {
    kind: 'claudeCode',
    command: claudeCode.COMMAND,
    where: claudeCode.CANDIDATES,
    status: {
      // `--json` is already the default; asking for it explicitly means a
      // version that changes the default cannot change the answer here.
      args: ['auth', 'status', '--json'],
      read: (_code, stdout) => {
        const parsed = readJson(stdout);
        return typeof parsed?.['loggedIn'] === 'boolean'
          ? parsed['loggedIn']
            ? 'in'
            : 'out'
          : 'unknown';
      },
    },
  },
  {
    kind: 'codex',
    command: codex.COMMAND,
    where: codex.CANDIDATES,
    status: {
      args: ['login', 'status'],
      read: (code, stdout, stderr) => {
        if (code === 0) return 'in';
        return USAGE_ERROR.test(`${stdout}\n${stderr}`) ? 'unknown' : 'out';
      },
    },
  },
];

/**
 * The JSON in a CLI's output, if there is any.
 *
 * Sliced between the outer braces rather than parsed whole, because a CLI is
 * entitled to print an update notice above its answer and one that does is not
 * a CLI that has stopped working.
 */
function readJson(text: string): Record<string, unknown> | null {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;

  try {
    const parsed: unknown = JSON.parse(text.slice(from, to + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function installedDrivers(): readonly AiDriverKind[] {
  /*
   * Nothing is detected under test.
   *
   * The suite runs against the built app on whatever machine is running it, so
   * a real lookup makes the assistant's whole starting state a function of
   * whether the developer happens to have Claude Code installed — the empty
   * state exists on one laptop and not the next, and the test that reads
   * "before it has been set up" passes or fails for a reason that has nothing
   * to do with the change under it.
   *
   * `SHELF_SHOW` is the exception, and the only one: that is the screenshot
   * run, which is photographing this machine on purpose.
   */
  if (process.env['SHELF_E2E'] && !process.env['SHELF_SHOW']) return [];

  return CLI_DRIVERS.filter(
    (driver) => findExecutable(driver.command, driver.where) !== null
  ).map((driver) => driver.kind);
}

/** Long enough for a cold start and a keychain read, short enough to be a check. */
const STATUS_TIMEOUT_MS = 10_000;

/**
 * How long a "yes, signed in" stands.
 *
 * Asking costs the better part of a second — the CLI starts a runtime and reads
 * a keychain — and it is asked before every turn. A conversation is a dozen
 * turns seconds apart, so remembering the answer makes eleven of them free.
 *
 * Only the *yes* is remembered. A no must never be, because the whole point of
 * the sheet it raises is that somebody goes and fixes it and comes straight
 * back — a cached refusal would tell them they are still signed out for five
 * minutes after they signed in. A session that expires inside the window is
 * caught the other way, by the CLI's own failure text; see `cliFailure`.
 */
const SIGNED_IN_TTL_MS = 5 * 60 * 1000;

const affirmed = new Map<AiDriverKind, number>();

/**
 * Whether this provider has somebody signed in to it.
 *
 * Answers `unknown` for everything that is not a detected CLI, and for a CLI
 * that answered in a shape this version does not recognise. `unknown` is
 * permissive on purpose — see `AiSignInState`.
 */
export async function signInState(kind: AiDriverKind): Promise<AiSignInState> {
  const driver = CLI_DRIVERS.find((entry) => entry.kind === kind);
  if (!driver) return 'unknown';

  const since = affirmed.get(kind);
  if (since !== undefined && Date.now() - since < SIGNED_IN_TTL_MS) return 'in';

  const path = findExecutable(driver.command, driver.where);
  if (!path) return 'unknown';

  return await new Promise<AiSignInState>((resolve) => {
    execFile(
      path,
      [...driver.status.args],
      {
        // The same empty directory the turn itself runs in: a status command
        // that reads project settings must not read a stranger's.
        cwd: tmpdir(),
        timeout: STATUS_TIMEOUT_MS,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        /*
         * Only an exit code is an answer.
         *
         * A timeout comes back `killed` with no code, and a failed spawn comes
         * back with a string one — neither is the program saying anything about
         * an account, and reading either as "signed out" would send somebody to
         * a terminal because their machine was busy.
         */
        const failure = error as (Error & { code?: unknown; killed?: boolean }) | null;
        if (failure && (failure.killed === true || typeof failure.code !== 'number')) {
          return resolve('unknown');
        }
        const state = driver.status.read(
          failure ? (failure.code as number) : 0,
          stdout,
          stderr
        );
        if (state === 'in') affirmed.set(kind, Date.now());
        resolve(state);
      }
    );
  });
}

/**
 * Stops a turn before it starts, when the provider it would use is signed out.
 *
 * Before the schema is gathered rather than after, because the reads are the
 * slow part and every one of them would be work thrown away — and because the
 * interface says what it is doing, so a failure that arrives during the reads
 * reads as the database's fault rather than the CLI's.
 */
export async function requireSignIn(kind: AiDriverKind): Promise<void> {
  if ((await signInState(kind)) !== 'out') return;

  const info = driverInfo(kind);
  const how = info.signInCommand ? ` Run \`${info.signInCommand}\` in a terminal.` : '';
  throw new AiSignInError(
    kind,
    `${info.label} is installed but nobody is signed in to it.${how}`
  );
}
