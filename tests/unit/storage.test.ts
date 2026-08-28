import { describe, expect, it } from 'vitest';
import { STORAGE_CATEGORIES, formatBytes } from '@shared/storage';
import en from '@renderer/i18n/locales/en-US.json';

describe('a size, as somebody reads it', () => {
  it('stays in bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('carries one decimal below ten and none above', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(148 * 1024 * 1024)).toBe('148 MB');
  });

  it('climbs no further than the units it has', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5.0 TB');
    expect(formatBytes(9000 * 1024 ** 4)).toBe('9000 TB');
  });
});

/**
 * Every category has to be drawable, and the sheet builds its keys from the id.
 * A category added without its two strings renders as `storage.whatever`, which
 * the key checker cannot see because the key is composed rather than literal.
 */
describe('every storage category', () => {
  it('is named and explained in the bundle', () => {
    const bundle = (en as Record<string, Record<string, string>>)['storage']!;

    for (const category of STORAGE_CATEGORIES) {
      expect(bundle[category.id], category.id).toBeTruthy();
      expect(bundle[`${category.id}Note`], `${category.id}Note`).toBeTruthy();
    }
  });
});
