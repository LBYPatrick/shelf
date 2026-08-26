/**
 * Finding a table by typing at it.
 *
 * Two ways of writing a query, because people arrive with two different things
 * in mind. Someone who knows where the table lives writes a path —
 * `music.album`, or `sample.music.album` — and someone who only knows what it
 * looks like writes a pattern: `^a.*t$`, `log|metrics`.
 *
 * They are alternatives, not a blend, and the query says which by what is in
 * it. Regular-expression syntax means a pattern; anything else is a path. The
 * dot decides nothing, because it cannot: it is the separator in one reading
 * and "any character" in the other, and a query that meant both would mean
 * neither. Given a pattern, the dot goes back to being a dot.
 *
 * A path segment matches as a subsequence, so `albsum` still finds
 * `album_summary` the way people type when they are aiming rather than reading.
 */

export interface SearchableEntity {
  readonly name: string;
  readonly schema?: string | undefined;
  readonly database?: string | undefined;
}

/**
 * What makes a query a pattern rather than a path.
 *
 * `.` is deliberately absent from the list: on its own it is the separator, and
 * every pattern that wants it as a wildcard brings an anchor or a quantifier
 * along with it. `a.b` is two levels; `a.*b` is a pattern.
 */
const PATTERN = /[\\^$*+?()[\]{}|]/;

export type Query =
  | { readonly kind: 'empty' }
  | { readonly kind: 'path'; readonly segments: readonly string[] }
  | { readonly kind: 'pattern'; readonly regex: RegExp };

export function parseQuery(query: string): Query {
  const trimmed = query.trim();
  if (trimmed === '') return { kind: 'empty' };

  if (PATTERN.test(trimmed)) {
    try {
      return { kind: 'pattern', regex: new RegExp(trimmed, 'i') };
    } catch {
      // Half-typed — `album(` on the way to `album(x)`. Falling back to a path
      // keeps the list alive instead of emptying it between keystrokes.
    }
  }

  const segments = trimmed
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  return segments.length === 0 ? { kind: 'empty' } : { kind: 'path', segments };
}

/**
 * How well one word matches, or null for not at all.
 *
 * Subsequence rather than substring, scored so that earlier and tighter matches
 * rank higher: adjacent characters are worth more than scattered ones, and a
 * match at a word boundary more than one in the middle.
 */
function scoreWord(text: string, needle: string): number | null {
  if (!needle) return 0;

  const haystack = text.toLowerCase();
  const pattern = needle.toLowerCase();

  let index = 0;
  let previous = -1;
  let points = 0;

  for (const char of pattern) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return null;

    if (found === previous + 1) points += 3;
    if (found === 0 || /[\s_.-]/.test(haystack[found - 1] ?? '')) points += 2;

    previous = found;
    index = found + 1;
  }

  // Shorter targets win ties: "album" should beat "album_summary" for "album".
  return points - haystack.length * 0.01;
}

/** The entity written the way a path query addresses it. */
export function qualifiedPath(entity: SearchableEntity): string {
  return levelsOf(entity).join('.');
}

/** The last segment of a path query — the table it was actually asking for. */
export function leafOf(query: Query): string | undefined {
  return query.kind === 'path' && query.segments.length > 1
    ? query.segments[query.segments.length - 1]
    : undefined;
}

/**
 * The levels this entity actually has, outermost first.
 *
 * Absent ones are dropped rather than left as holes, and that is the whole
 * point: MySQL reports no schema per table, because on MySQL the database *is*
 * the schema. Binding a path against three fixed slots meant every entity from
 * that engine carried an undefined in the middle, so `production.orders` bound
 * its two words to [schema, name], hit the hole and matched nothing — while
 * `orders` on its own worked, because one word never reached the levels above.
 * That is exactly what "searching is broken" looks like from the outside.
 *
 * A level a driver reports as an empty string counts as absent too.
 */
function levelsOf(entity: SearchableEntity): string[] {
  const levels: string[] = [];
  if (entity.database) levels.push(entity.database);
  // MySQL's database and schema are one thing under two names; a path that
  // repeated it would read `production.production.orders`.
  if (entity.schema && entity.schema !== entity.database) levels.push(entity.schema);
  levels.push(entity.name);
  return levels;
}

/**
 * Scores an entity against a parsed query, or null if it does not match.
 *
 * A path binds from the right over the levels the entity has: the last segment
 * is always the table, and each one before it the next level out. A query with
 * more segments than the entity has levels cannot match, which is what makes
 * `nowhere.album` correctly find nothing rather than falling back to `album`.
 *
 * A *single* segment is the exception, and it has to be. Binding one word to
 * the table alone means typing a schema's name finds nothing at all, which is
 * not strictness — it is a search that appears broken. One word asks "anything
 * called this", and a hit on the name outranks a hit on a level above it. Two
 * or more words are the moment the writer said where to look, and then the
 * levels bind.
 *
 * A pattern is tried against the table's name and against its full path, so
 * `^a.*t$` finds a table and `^sample\.music` finds a schema's worth of them.
 */
export function scoreEntity(entity: SearchableEntity, query: Query): number | null {
  if (query.kind === 'empty') return 0;

  if (query.kind === 'pattern') {
    if (query.regex.test(entity.name)) return 8;
    return query.regex.test(qualifiedPath(entity)) ? 4 : null;
  }

  const path = levelsOf(entity);
  const wanted = query.segments;
  if (wanted.length > path.length) return null;

  if (wanted.length === 1) {
    const word = wanted[0]!;
    const onName = scoreWord(entity.name, word);
    if (onName !== null) return onName * 2;

    for (let index = path.length - 2; index >= 0; index -= 1) {
      const score = scoreWord(path[index]!, word);
      if (score !== null) return score;
    }

    return null;
  }

  let total = 0;

  for (let offset = 0; offset < wanted.length; offset += 1) {
    const at = path[path.length - wanted.length + offset]!;

    const score = scoreWord(at, wanted[offset]!);
    if (score === null) return null;

    // The table's own name is what was being looked for; the levels above it
    // are qualifiers, and matching one of those is worth less than matching it.
    total += offset === wanted.length - 1 ? score * 2 : score;
  }

  return total;
}

/** Ranks a list of entities against a raw query string. */
export function searchEntities<T extends SearchableEntity>(
  entities: readonly T[],
  query: string
): T[] {
  const parsed = parseQuery(query);
  if (parsed.kind === 'empty') return [...entities];

  return entities
    .map((entity) => ({ entity, score: scoreEntity(entity, parsed) }))
    .filter((hit): hit is { entity: T; score: number } => hit.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.entity);
}
