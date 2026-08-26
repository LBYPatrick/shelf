/**
 * Reading JSON that came from outside.
 *
 * Two files here parse a document a person could have written by hand — a
 * settings export, a connection preset — and both begin the same way: is this
 * thing an object at all. Each had its own copy of the answer, which is one
 * copy too many for a predicate whose whole subtlety is the two cases people
 * forget.
 */

/**
 * Whether a parsed value is a plain object.
 *
 * `typeof null === 'object'` and so does an array, and both are exactly what a
 * hand-written document is likely to contain where an object was expected — so
 * a check that only asks `typeof` reads `[]` as a settings group and then finds
 * none of its keys.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
