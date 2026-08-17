import { describe, expect, it } from 'vitest';
import { exportName, slugify, suffix, timestamp } from '@shared/fileNames';

const AT = new Date(2026, 7, 17, 9, 5, 3);

describe('naming an export', () => {
  it('stamps the fallback with a sortable local timestamp', () => {
    expect(exportName(undefined, 'query', AT, 0.123456)).toBe('query-20260817-090503-123456');
  });

  it('keeps a name the user chose', () => {
    expect(exportName('orders by month', 'query', AT, 0.5)).toBe('orders-by-month');
  });

  /*
   * The reason the fallback is stamped at all: a fixed name collides with
   * itself, so the second export either overwrites the first or has to be
   * renamed by hand.
   */
  it('gives two exports in the same second different names', () => {
    const first = exportName(undefined, 'query', AT, 0.111111);
    const second = exportName(undefined, 'query', AT, 0.222222);
    expect(first).not.toBe(second);
  });

  it('sorts by name in the order the exports were taken', () => {
    const earlier = exportName(undefined, 'query', new Date(2026, 7, 17, 9, 5, 3), 0.5);
    const later = exportName(undefined, 'query', new Date(2026, 7, 17, 9, 5, 4), 0.1);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('pads every field so the string never changes width', () => {
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
    expect(suffix(0.000001)).toBe('000001');
    expect(suffix(0)).toBe('000000');
  });
});

describe('making a name safe for a filesystem', () => {
  it('takes the separators out', () => {
    // A saved query called "orders / last 30 days" must not produce a path
    // with a directory in it.
    expect(slugify('orders / last 30 days')).toBe('orders-last-30-days');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('leaves an ordinary table name alone', () => {
    expect(slugify('daily_metrics')).toBe('daily_metrics');
    expect(slugify('order.items')).toBe('order.items');
  });

  it('keeps letters that are not ASCII', () => {
    expect(slugify('操作员')).toBe('操作员');
  });

  it('falls back rather than producing an empty name', () => {
    expect(exportName('///', 'query', AT, 0.5)).toBe('query-20260817-090503-500000');
  });
});
