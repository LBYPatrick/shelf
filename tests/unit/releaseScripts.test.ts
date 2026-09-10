import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scripts = resolve('scripts');
const directories: string[] = [];
function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'shelf-release-'));
  directories.push(cwd);
  return cwd;
}
afterEach(() => {
  for (const cwd of directories.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

function releaseFixture(): string {
  const cwd = fixture();
  writeFileSync(join(cwd, 'VERSION'), '1.4.2\n');
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({
      version: '1.4.2',
      devDependencies: { 'electron-builder': '^26.15.3' },
    })
  );
  git(cwd, 'init');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  commit(cwd);
  git(cwd, 'tag', 'v1.4.2');
  return cwd;
}
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}
function commit(cwd: string): void {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'fixture');
}
function check(cwd: string, ref = 'release/v1.4.2', type = 'branch') {
  return spawnSync(process.execPath, [join(scripts, 'check-release.mjs')], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: ref, GITHUB_REF_TYPE: type },
  });
}

describe('release validation', () => {
  it('accepts a matching version tag', () => {
    const result = check(releaseFixture(), 'v1.4.2', 'tag');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('version=1.4.2\ntag=v1.4.2\n');
  });
  it('accepts a packaging-only recovery', () => {
    const cwd = releaseFixture();
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({
        version: '1.4.2',
        devDependencies: { 'electron-builder': '^26.16.1' },
      })
    );
    commit(cwd);
    expect(check(cwd).status).toBe(0);
  });
  it('rejects application changes under an existing tag', () => {
    const cwd = releaseFixture();
    writeFileSync(join(cwd, 'app.ts'), 'export const changed = true;');
    commit(cwd);
    expect(check(cwd).stderr).toContain('Recovery changes application files: app.ts');
    expect(check(cwd).status).not.toBe(0);
  });
  it('rejects runtime dependency changes', () => {
    const cwd = releaseFixture();
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    manifest.dependencies = { unexpected: '1.0.0' };
    writeFileSync(join(cwd, 'package.json'), JSON.stringify(manifest));
    commit(cwd);
    expect(check(cwd).stderr).toContain('Recovery may only change electron-builder');
  });
  it('rejects mismatched versions and unrelated branches', () => {
    const cwd = releaseFixture();
    expect(check(cwd, 'v1.4.3', 'tag').status).not.toBe(0);
    expect(check(cwd, 'dev').status).not.toBe(0);
  });
});

describe('release notes', () => {
  it('extracts only the requested version and rejects a missing version', () => {
    const cwd = fixture();
    writeFileSync(
      join(cwd, 'CHANGELOG.md'),
      '# Changes\n\n## [Unreleased]\n\n## [1.4.2] - 2026-09-10\n\n### Fixed\n\n- A fix.\n\n## [1.4.1] - 2026-09-09\n\nOld notes.\n'
    );
    const run = (version: string) =>
      spawnSync(process.execPath, [join(scripts, 'release-notes.mjs'), version], {
        cwd,
        encoding: 'utf8',
      });
    expect(run('1.4.2').stdout).toBe('### Fixed\n\n- A fix.\n');
    expect(run('1.4.3').status).not.toBe(0);
  });
});

describe('Linux packaging dependencies', () => {
  function install(failures: number) {
    const cwd = fixture();
    // Never run privileged commands in tests. Count updates and simulate a mirror failure.
    writeFileSync(
      join(cwd, 'sudo'),
      `#!/bin/bash
if [[ "$*" == *update ]]; then
  count=$(cat "$TEST_COUNTER" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$TEST_COUNTER"
  if [[ "$count" -le "$TEST_FAILURES" ]]; then exit 1; fi
fi
`,
      { mode: 0o755 }
    );
    writeFileSync(join(cwd, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    const counter = join(cwd, 'counter');
    const result = spawnSync('bash', [join(scripts, 'install-linux-packaging.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${cwd}:${process.env.PATH}`,
        TEST_COUNTER: counter,
        TEST_FAILURES: String(failures),
      },
    });
    return { status: result.status, attempts: Number(readFileSync(counter, 'utf8')) };
  }
  it('succeeds immediately on a healthy mirror', () => {
    expect(install(0)).toEqual({ status: 0, attempts: 1 });
  });
  it('recovers from a transient failure', () => {
    expect(install(1)).toEqual({ status: 0, attempts: 2 });
  });
  it('stops after three failures', () => {
    expect(install(3)).toEqual({ status: 1, attempts: 3 });
  });
});

describe('artifact upload names', () => {
  it('matches the updater URL by replacing spaces with hyphens', () => {
    const cwd = fixture();
    writeFileSync(join(cwd, 'Shelf Setup 1.4.2.exe'), 'installer');
    writeFileSync(join(cwd, 'Shelf Setup 1.4.2.exe.blockmap'), 'blockmap');
    const result = spawnSync(process.execPath, [join(scripts, 'normalize-artifacts.mjs'), cwd]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(cwd, 'Shelf-Setup-1.4.2.exe'), 'utf8')).toBe('installer');
    expect(readFileSync(join(cwd, 'Shelf-Setup-1.4.2.exe.blockmap'), 'utf8')).toBe('blockmap');
  });
  it('rejects collisions before renaming any artifacts', () => {
    const cwd = fixture();
    writeFileSync(join(cwd, 'Shelf Setup.exe'), 'original');
    writeFileSync(join(cwd, 'Shelf-Setup.exe'), 'existing');
    const result = spawnSync(process.execPath, [join(scripts, 'normalize-artifacts.mjs'), cwd]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(cwd, 'Shelf Setup.exe'), 'utf8')).toBe('original');
    expect(readFileSync(join(cwd, 'Shelf-Setup.exe'), 'utf8')).toBe('existing');
  });
});
