import { describe, expect, it } from 'vitest';
import { percentile, steadiness, summarize } from '@shared/latency';

describe('percentiles', () => {
  it('returns an observation that actually happened', () => {
    // Nearest-rank, not interpolated: a percentile of these four trips should
    // be one of the trips, not a number halfway between two of them.
    const samples = [10, 20, 30, 40];
    expect(percentile(samples, 0.5)).toBe(20);
    expect(percentile(samples, 0.75)).toBe(30);
  });

  it('reads the ends as the ends', () => {
    expect(percentile([5, 1, 9], 0)).toBe(1);
    expect(percentile([5, 1, 9], 1)).toBe(9);
  });

  it('does not disturb what it was given', () => {
    const samples = [3, 1, 2];
    percentile(samples, 0.5);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('answers for nothing rather than throwing', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('the summary', () => {
  it('is the shape of the question, not the mean', () => {
    /*
     * Nineteen fast trips and one terrible one. The mean says 22ms and hides
     * the whole story; the median and the tail are the story.
     */
    const samples = [...Array.from({ length: 19 }, () => 2), 400];
    const summary = summarize(samples);
    expect(summary.median).toBe(2);
    expect(summary.max).toBe(400);
    expect(summary.jitter).toBe(398);
    expect(steadiness(summary)).toBe('erratic');
  });

  it('does not lose the one bad trip in twenty to a percentile', () => {
    /*
     * The nearest-rank 95th of twenty samples is the nineteenth, so the single
     * terrible trip that is the whole reason to look at a tail falls just
     * outside it. At this sample size the honest tail is the worst trip.
     */
    const samples = [...Array.from({ length: 19 }, () => 2), 400];
    expect(percentile(samples, 0.95)).toBe(2);
    expect(summarize(samples).max).toBe(400);
  });

  it('never reports negative jitter', () => {
    expect(summarize([7, 7, 7]).jitter).toBe(0);
  });

  it('answers for nothing rather than throwing', () => {
    expect(summarize([])).toEqual({ count: 0, min: 0, median: 0, max: 0, jitter: 0 });
  });
});

describe('steadiness', () => {
  it('is relative to the median, not measured in milliseconds', () => {
    // 40ms of jitter on a 4ms socket is something wrong; the same 40ms on a
    // 300ms link across an ocean is the ocean.
    expect(steadiness(summarize([4, 4, 4, 44]))).toBe('erratic');
    expect(steadiness(summarize([300, 300, 300, 340]))).toBe('steady');
  });

  it('does not call a sub-millisecond socket erratic', () => {
    // 0.2ms and 0.6ms is a ratio of three, and it is a socket.
    expect(steadiness(summarize([0.2, 0.3, 0.2, 0.6]))).toBe('steady');
  });

  it('calls nothing at all erratic rather than steady', () => {
    // A connection that answered no pings is not a well-behaved connection.
    expect(steadiness(summarize([]))).toBe('erratic');
  });
});
