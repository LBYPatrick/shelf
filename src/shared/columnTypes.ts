/**
 * Reading a column's declared type.
 *
 * Every engine spells its types differently — `int4`, `INTEGER`, `NUMBER(10)`,
 * `numeric(2,1)`, `Int64` — and the interface only ever needs to know which
 * broad family a column belongs to. Matching on the family rather than on an
 * exhaustive list is what keeps this from needing an entry per engine.
 */

/*
 * The family has to *end* where the name does, or run into a width — `int4`,
 * `decimal(10,2)`. Without that boundary `int` is a prefix of `interval`, and a
 * duration column would have aligned itself right as though it were a count.
 */
const NUMERIC =
  /^(tiny|small|medium|big)?(int|integer|serial|float|double|real|decimal|numeric|number|money|dec)\d*(\s*\(|$)/i;

/**
 * Whether a column holds a quantity, and should therefore align on its last
 * digit. Deliberately conservative: a type this does not recognise is left
 * aligned as text, which is merely conventional rather than wrong.
 */
export function isNumericType(dataType: string | undefined): boolean {
  if (dataType === undefined) return false;
  const bare = dataType.trim().replace(/\s+unsigned$/i, '');
  return NUMERIC.test(bare);
}
