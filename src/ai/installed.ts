import type { AiDriverKind } from '@shared/ai';
import { findExecutable } from './cli';
import * as claudeCode from './drivers/claudeCode';
import * as codex from './drivers/codex';

/**
 * Which command-line assistants this machine has.
 *
 * Asked on every launch and again whenever the picker is opened, because the
 * answer changes without the app: somebody installs Codex over lunch, or
 * uninstalls Claude Code, and a list built once at first run would go on
 * offering what is no longer there. It is a handful of `access` calls against
 * paths that are almost always in the page cache, so asking again is cheaper
 * than remembering.
 */
const CLI_DRIVERS: readonly {
  kind: AiDriverKind;
  command: string;
  where: readonly string[];
}[] = [
  { kind: 'claudeCode', command: claudeCode.COMMAND, where: claudeCode.CANDIDATES },
  { kind: 'codex', command: codex.COMMAND, where: codex.CANDIDATES },
];

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
