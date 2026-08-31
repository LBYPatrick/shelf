import { describe, expect, it } from 'vitest';
import { formatDuration } from '@shared/duration';

describe('how long something took', () => {
  it('keeps a sub-millisecond measurement rather than rounding it to nothing', () => {
    // The old summary rounded to whole milliseconds, so a SQLite query that
    // took four tenths of one reported "0 ms" — which reads as "did not run".
    expect(formatDuration(0.42)).toBe('0.42 ms');
    expect(formatDuration(0)).toBe('0.00 ms');
  });

  it('changes unit as the number outgrows it', () => {
    expect(formatDuration(4.2)).toBe('4.2 ms');
    expect(formatDuration(342)).toBe('342.0 ms');
    expect(formatDuration(4200)).toBe('4.20 s');
    expect(formatDuration(180_000)).toBe('3.0 min');
    expect(formatDuration(7_200_000)).toBe('2.0 h');
  });

  it('changes unit at the boundary, not one step past it', () => {
    expect(formatDuration(999.9)).toBe('999.9 ms');
    expect(formatDuration(1000)).toBe('1.00 s');
    expect(formatDuration(59_999)).toBe('60.00 s');
    expect(formatDuration(60_000)).toBe('1.0 min');
    expect(formatDuration(3_599_999)).toBe('60.0 min');
    expect(formatDuration(3_600_000)).toBe('1.0 h');
  });

  it('never shows a negative duration', () => {
    // A clock that steps backwards mid-measurement produces one, and "-3 ms"
    // beside a query that plainly ran makes the whole column suspect.
    expect(formatDuration(-5)).toBe('0.00 ms');
  });
});
