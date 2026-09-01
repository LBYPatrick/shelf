import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isNewerVersion,
  latestReleaseUrl,
  readRelease,
  releasePageUrl,
  updateDelivery,
  type InstallFacts,
} from '@shared/updates';

/*
 * The three decidable parts of the update flow, and every one of them fails
 * quietly when it is wrong: a comparison that gets the direction backwards
 * offers a downgrade, a delivery that guesses shows a Restart button on a .deb,
 * and a release parsed loosely renders a panel about a version that does not
 * exist. None of the three produces an error to notice.
 */

describe('comparing versions', () => {
  it('orders by each part in turn', () => {
    expect(compareVersions('1.4.0', '1.3.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.1', '1.3.2')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.3.1', '1.3.1')).toBe(0);
  });

  it('compares numbers as numbers, not as text', () => {
    // The bug this exists for: "1.10.0" sorts before "1.9.0" as a string.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
  });

  it('reads a tag with or without its leading v', () => {
    expect(compareVersions('v1.4.0', '1.4.0')).toBe(0);
  });

  it('ranks a release above its own prereleases', () => {
    expect(compareVersions('1.4.0', '1.4.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0-beta.2', '1.4.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.4.0-alpha', '1.4.0-beta')).toBeLessThan(0);
  });

  it('treats a version it cannot read as the older one', () => {
    // Safe in both directions: a running build nobody can parse makes every
    // release look newer, and a release nobody can parse is never offered.
    expect(isNewerVersion('not a version', '1.3.1')).toBe(false);
    expect(isNewerVersion('1.4.0', 'not a version')).toBe(true);
  });

  it('is only newer when it is strictly newer', () => {
    expect(isNewerVersion('1.3.1', '1.3.1')).toBe(false);
    expect(isNewerVersion('1.3.0', '1.3.1')).toBe(false);
  });
});

describe('how an install can be updated', () => {
  const facts = (over: Partial<InstallFacts> = {}): InstallFacts => ({
    platform: 'darwin',
    packaged: true,
    appImage: false,
    portable: false,
    ...over,
  });

  it('installs in place on macOS and the Windows installer', () => {
    expect(updateDelivery(facts({ platform: 'darwin' }))).toBe('in-app');
    expect(updateDelivery(facts({ platform: 'win32' }))).toBe('in-app');
  });

  it('installs in place on an AppImage and nowhere else on Linux', () => {
    expect(updateDelivery(facts({ platform: 'linux', appImage: true }))).toBe('in-app');
    // A .deb or .rpm belongs to the package manager that put it there.
    expect(updateDelivery(facts({ platform: 'linux' }))).toBe('download-page');
  });

  it('sends the Windows portable build to its page', () => {
    expect(updateDelivery(facts({ platform: 'win32', portable: true }))).toBe('download-page');
  });

  it('sends an unpackaged build to its page, whatever the platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(updateDelivery(facts({ platform, packaged: false }))).toBe('download-page');
    }
  });

  it('sends a platform it has never heard of to its page', () => {
    expect(updateDelivery(facts({ platform: 'freebsd' }))).toBe('download-page');
  });
});

describe('reading a release', () => {
  const REPO = 'LBYPatrick/shelf';

  it('takes the version out of the tag', () => {
    const release = readRelease(
      {
        tag_name: 'v1.4.0',
        body: '## Fixed\n\n- A thing.',
        html_url: 'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0',
      },
      REPO
    );

    expect(release).toEqual({
      version: '1.4.0',
      notes: '## Fixed\n\n- A thing.',
      url: 'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0',
      // No `published_at` in the payload, so no key — not an undefined one.
    });
  });

  /*
   * This URL is handed to `shell.openExternal`, which is not a browser: it is
   * "open this with whatever handles it". A `file:` or a custom scheme there is
   * a program launched because a server said so, and the body of an HTTP
   * response is not a thing this app trusts that far.
   */
  it('refuses a url that is not a GitHub page over https', () => {
    const tagPage = 'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0';

    for (const html_url of [
      'javascript:alert(1)',
      'file:///Applications/Calculator.app',
      'http://github.com/LBYPatrick/shelf/releases/tag/v1.4.0',
      'https://github.com.example.invalid/anything',
      'not a url at all',
      42,
    ]) {
      expect(readRelease({ tag_name: 'v1.4.0', html_url }, REPO)?.url).toBe(tagPage);
    }
  });

  it('keeps the published date when the payload carries one', () => {
    const release = readRelease(
      { tag_name: 'v1.4.0', published_at: '2026-09-01T09:00:00Z' },
      REPO
    );
    expect(release?.publishedAt).toBe('2026-09-01T09:00:00Z');
  });

  it('falls back to the tag page when there is no url', () => {
    expect(readRelease({ tag_name: '1.4.0' }, REPO)?.url).toBe(
      'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0'
    );
  });

  it('is a release with no notes rather than a page that throws', () => {
    expect(readRelease({ tag_name: 'v1.4.0', body: null }, REPO)?.notes).toBe('');
  });

  it('refuses anything without a version in it', () => {
    expect(readRelease({ tag_name: 'nightly' }, REPO)).toBeUndefined();
    expect(readRelease({}, REPO)).toBeUndefined();
    expect(readRelease(null, REPO)).toBeUndefined();
    expect(readRelease('not json at all', REPO)).toBeUndefined();
  });
});

describe('where the app looks', () => {
  it('asks for the latest release, which excludes drafts and prereleases', () => {
    expect(latestReleaseUrl('LBYPatrick/shelf')).toBe(
      'https://api.github.com/repos/LBYPatrick/shelf/releases/latest'
    );
  });

  it('spells the page with the tag it was released under', () => {
    expect(releasePageUrl('LBYPatrick/shelf', '1.4.0')).toBe(
      'https://github.com/LBYPatrick/shelf/releases/tag/v1.4.0'
    );
  });
});
