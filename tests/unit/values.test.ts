import { describe, expect, it } from 'vitest';
import { displayValue, formatInstant, isDateOnly, valueKind } from '@shared/values';

describe('instants', () => {
  it('drops the T and the Z, which carry no information the column does not', () => {
    expect(formatInstant('2012-04-24T14:30:05.000Z')).toBe('2012-04-24 14:30:05');
  });

  it('keeps a fractional second that is actually there', () => {
    expect(formatInstant('2012-04-24T14:30:05.250Z')).toBe('2012-04-24 14:30:05.250');
  });

  it('shows only the day for a column that holds no time of day', () => {
    expect(formatInstant('2012-04-24T00:00:00.000Z', true)).toBe('2012-04-24');
  });

  /*
   * The width of a column must not depend on its values. A timestamp column
   * that happens to hold midnight still renders its time, or the column would
   * be narrow on one page and wide on the next.
   */
  it('does not narrow a timestamp just because it landed on midnight', () => {
    expect(formatInstant('2012-04-24T00:00:00.000Z')).toBe('2012-04-24 00:00:00');
  });

  it('leaves anything it cannot parse exactly as it found it', () => {
    expect(formatInstant('0000-00-00 not a date')).toBe('0000-00-00 not a date');
    expect(formatInstant('2012-04-24')).toBe('2012-04-24');
  });
});

describe('date-only column types', () => {
  it('is date, and not the types whose names merely contain it', () => {
    expect(isDateOnly('date')).toBe(true);
    expect(isDateOnly('DATE')).toBe(true);
    expect(isDateOnly(' date ')).toBe(true);

    expect(isDateOnly('datetime')).toBe(false);
    expect(isDateOnly('timestamp')).toBe(false);
    expect(isDateOnly(undefined)).toBe(false);
  });
});

describe('displaying a value', () => {
  it('shows an absent value as empty', () => {
    expect(displayValue(null)).toBe('');
    expect(displayValue(undefined as never)).toBe('');
  });

  it('passes a plain scalar through', () => {
    expect(displayValue(42)).toBe('42');
    expect(displayValue(false)).toBe('false');
    expect(displayValue('')).toBe('');
  });

  it('renders binary as hex by default and base64 when asked', () => {
    const value = { $: 'binary', data: 'AAEC' } as const;
    expect(displayValue(value)).toBe('0x000102');
    expect(displayValue(value, { encoding: 'base64' })).toBe('AAEC');
  });

  it('lets the column type decide how much of an instant to show', () => {
    const value = { $: 'date', data: '2012-04-24T00:00:00.000Z' } as const;
    expect(displayValue(value, { dataType: 'date' })).toBe('2012-04-24');
    expect(displayValue(value, { dataType: 'timestamptz' })).toBe('2012-04-24 00:00:00');
  });

  it('never leaks the transport envelope', () => {
    for (const value of [
      { $: 'bigint', data: '9007199254740993' },
      { $: 'objectid', data: 'deadbeef' },
      { $: 'json', data: '{"a":1}' },
      { $: 'date', data: '2012-04-24T00:00:00.000Z' },
    ] as const) {
      expect(displayValue(value)).not.toContain('"$"');
    }
  });
});

describe('the kind of a value', () => {
  it('names a tag by its tag and anything else by its primitive type', () => {
    expect(valueKind(null)).toBe('null');
    expect(valueKind(7)).toBe('number');
    expect(valueKind({ $: 'json', data: '{}' })).toBe('json');
  });
});
