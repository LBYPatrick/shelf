import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `VERSION` is what the project is called this week, and `package.json` is what
 * the built app answers when it is asked.
 *
 * Two files holding one number is a fact that can be half-changed, and the half
 * that gets forgotten is the one nobody looks at until a release is out: the
 * Makefile prints the file, `app.getVersion()` reads the manifest, and a bump
 * applied to one of them ships a build that disagrees with its own tag.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
};

describe('the version', () => {
  it('is a plain three-part number, and nothing else', () => {
    // No `v`, no build metadata, no trailing prose: the file is read by `cat`
    // and printed as-is, and anything else in it is printed too.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('says the same thing in the file and in the manifest', () => {
    expect(manifest.version, 'package.json disagrees with VERSION').toBe(version);
  });
});
