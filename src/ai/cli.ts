import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

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
