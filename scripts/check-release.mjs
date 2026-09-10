import { deepStrictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const ref = process.env.GITHUB_REF_NAME ?? '';
const recovery = process.env.GITHUB_REF_TYPE === 'branch';
const tag = recovery ? ref.replace(/^release\//, '') : ref;
if (!/^v\d+\.\d+\.\d+$/.test(tag) || (recovery && ref !== `release/${tag}`)) {
  throw new Error(`Not a release tag or recovery branch: ${ref}`);
}
const version = tag.slice(1);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== version || readFileSync('VERSION', 'utf8').trim() !== version) {
  throw new Error('The release ref, VERSION and package.json must agree.');
}

if (recovery) {
  // A recovery may fix packaging and documentation, but ships the same app.
  // Keep this list narrow so a source change cannot hide under an existing tag.
  const allowed = new Set([
    '.github/workflows/release.yaml',
    '.agents/skills/publish-release/SKILL.md',
    'README.md',
    'CONTRIBUTING.md',
    'package.json',
    'pnpm-lock.yaml',
    'scripts/check-release.mjs',
    'scripts/install-linux-packaging.sh',
    'scripts/release-notes.mjs',
    'tests/unit/releaseScripts.test.ts',
  ]);
  const changed = git('diff', '--name-only', `refs/tags/${tag}`, 'HEAD')
    .split('\n')
    .filter(Boolean);
  const unexpected = changed.filter((file) => !allowed.has(file));
  if (unexpected.length)
    throw new Error(`Recovery changes application files: ${unexpected.join(', ')}`);

  const original = JSON.parse(git('show', `refs/tags/${tag}:package.json`));
  delete original.devDependencies['electron-builder'];
  delete manifest.devDependencies['electron-builder'];
  deepStrictEqual(
    manifest,
    original,
    'Recovery may only change electron-builder in package.json.'
  );
}

console.log(`version=${version}`);
console.log(`tag=${tag}`);
