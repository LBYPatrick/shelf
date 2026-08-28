import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { AiDriverKind } from '@shared/ai';
import { AiError, AiSignInError } from './types';

/**
 * Finding a command-line assistant on this machine.
 *
 * Claude Code and Codex are not configured, they are *installed*: they sign
 * themselves in, hold their own credentials, and either exist on this computer
 * or do not. So they are found rather than added, and the same lookup answers
 * both questions — which executable to spawn, and whether to offer the provider
 * at all. Two lookups would drift, and the way they would drift is a row in the
 * picker that fails the moment it is chosen.
 *
 * An app launched from the Finder inherits a minimal environment rather than
 * the one the reader's shell builds, so `PATH` alone finds neither of them on a
 * great many machines where both are installed. The candidate lists are the
 * places the installers actually use, checked first.
 */
export function findExecutable(name: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (executable(candidate)) return candidate;
  }

  // Whatever path this process did inherit still gets the last word: someone
  // who installed it somewhere else entirely has it here and nowhere else.
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue;
    const path = join(directory, name);
    if (executable(path)) return path;
  }

  return null;
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a CLI's own failure text is it saying it is not signed in.
 *
 * A pre-flight check answers this before a turn starts — see `installed.ts` —
 * and this is the other half, for the session that expires between the check
 * and the answer, and for the CLI version whose status command we could not
 * read. Matching on prose is unpleasant and it is what there is: neither
 * program has an exit code that distinguishes "signed out" from "failed".
 *
 * It is deliberately narrow. A false positive sends somebody to a terminal to
 * sign in to something they are already signed in to, which wastes their time
 * and teaches them to ignore the sheet.
 */
const SIGNED_OUT =
  /\b(?:not logged in|log ?in required|not (?:yet )?authenticated|please run \/?login|invalid api key|unauthorized|oauth token (?:has )?expired|session (?:has )?expired|credentials (?:not found|are missing|have expired))\b/i;

export function readsAsSignedOut(text: string): boolean {
  return SIGNED_OUT.test(text);
}

/**
 * A CLI's failure, as the kind of error it actually is.
 *
 * One call rather than the same `if` in both drivers: the two programs fail in
 * the same shape — a message on standard error and a non-zero exit — and the
 * one distinction worth making about it is whether the fix is here or in a
 * terminal.
 */
export function cliFailure(kind: AiDriverKind, message: string): AiError {
  return readsAsSignedOut(message) ? new AiSignInError(kind, message) : new AiError(message);
}
