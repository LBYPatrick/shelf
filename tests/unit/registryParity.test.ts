import { describe, expect, it } from 'vitest';
import { AI_DRIVERS } from '@shared/aiDrivers';
import { aiDriverKinds } from '@ai/registry';
import { ENGINES } from '@shared/engines';
import { supportedEngines } from '@drivers/registry';
import { registerEngines } from '@drivers/index';

/**
 * What the interface offers, and what the host can actually build.
 *
 * Two lists, in two processes, that must name the same set. A row in the
 * catalogue with no driver behind it is a menu item that fails the moment it is
 * chosen; a driver with no row is code nobody can reach. Neither is visible to
 * the compiler, because the two halves never refer to each other — that is the
 * whole reason they are separate, and the whole reason this has to be checked.
 *
 * `aiDriverKinds` and `supportedEngines` existed for this and nothing else.
 * They had no caller at all: the check they were written for was described in
 * the project's own notes and never actually written, so the two functions sat
 * exported and unused while the invariant they exist to prove went unenforced —
 * through five providers being added in one afternoon.
 */

describe('assistant providers', () => {
  it('offers exactly the drivers the host can build', () => {
    expect([...aiDriverKinds()].sort()).toEqual([...AI_DRIVERS.map((d) => d.kind)].sort());
  });

  it('is looking at more than a couple', () => {
    // A catalogue that quietly emptied would satisfy the equality above.
    expect(AI_DRIVERS.length).toBeGreaterThan(5);
  });
});

describe('database engines', () => {
  /*
   * The registry holds loader closures, not drivers: `registerEngines` records
   * how to import each one and imports none of them, which is what lets this
   * run under plain Node beside a native module it must never load.
   */
  registerEngines();

  /*
   * `mock` is the exception and says so: it backs the sample database, which is
   * a real driver with no row in the picker because there is nothing to
   * configure about it.
   */
  it('offers exactly the engines the host can build, plus the sample', () => {
    const offered = ENGINES.map((engine) => engine.id).sort();
    const buildable = supportedEngines()
      .filter((id) => id !== 'mock')
      .sort();
    expect(buildable).toEqual(offered);
  });

  it('is looking at more than a couple', () => {
    expect(ENGINES.length).toBeGreaterThan(5);
  });
});
