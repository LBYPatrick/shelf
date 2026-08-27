import type { DatabaseClient, Entity, EntityRef } from '@drivers/types';
import {
  buildSchemaDocument,
  narrowSchemaDocument,
  qualifiedName,
  type EntityFacts,
  type SchemaDocument,
  type SchemaScope,
} from '@shared/schemaDoc';

/**
 * Reading a database into a document.
 *
 * The gathering half of `shared/schemaDoc.ts`: this needs a live connection and
 * so lives in the host, and it does nothing the document module could do
 * instead. What it mostly does is decide how much to ask for, which is the part
 * that is easy to get wrong in a way nobody notices until a real database is
 * pointed at it.
 *
 * The shape of the problem is N+1. Columns, indexes and relations are one round
 * trip *per entity*, so a schema with six hundred tables is eighteen hundred
 * queries — a minute of waiting before a single word has been sent to a model,
 * for a document far too large to send. So the depth is bounded, and what was
 * left out is written into the document rather than silently dropped: the model
 * is told the list is partial, and can ask for a table by name.
 */

/** Entities we will read columns for. Beyond this the list is names only. */
const COLUMN_LIMIT = 120;

/** Entities we will read indexes and relations for. The expensive half. */
const DETAIL_LIMIT = 60;

/** Round trips in flight at once. Enough to hide latency, few enough to be polite. */
const CONCURRENCY = 8;

export interface GatherOptions {
  /** The document is narrowed to fit this many estimated tokens. */
  readonly budget: number;
  readonly signal?: AbortSignal;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

function inScope(entity: Entity, scope: SchemaScope): boolean {
  switch (scope.kind) {
    case 'schema':
      return entity.schema === scope.name;
    case 'entity':
      return (
        entity.name === scope.entity.name &&
        (scope.entity.schema === undefined || entity.schema === scope.entity.schema)
      );
    default:
      return true;
  }
}

/**
 * Which entities matter most, given what was asked about.
 *
 * Asking about one table means that table and the tables it joins to — a query
 * about orders is nearly always a query about orders and customers, and a
 * document containing only the first produces a `SELECT` where a join belonged.
 * Neighbours cannot be known before the relations are read, so the target is
 * read first and the rest of the list is ordered behind it.
 */
function order(entities: readonly Entity[], scope: SchemaScope): Entity[] {
  if (scope.kind !== 'entity') return [...entities];

  const target = scope.entity;
  return [...entities].sort((a, b) => rank(a, target) - rank(b, target));
}

function rank(entity: Entity, target: EntityRef): number {
  if (entity.name === target.name && (!target.schema || entity.schema === target.schema)) {
    return 0;
  }
  return entity.schema === target.schema ? 1 : 2;
}

export async function gatherSchema(
  client: DatabaseClient,
  scope: SchemaScope,
  options: GatherOptions
): Promise<SchemaDocument> {
  const capabilities = client.capabilities;

  const schema =
    scope.kind === 'schema'
      ? scope.name
      : scope.kind === 'entity'
        ? scope.entity.schema
        : undefined;
  const all = await client.listEntities(
    capabilities.schemas && typeof schema === 'string' ? schema : undefined
  );

  // A routine has no columns to describe and no rows to select from; it is
  // noise in a document whose whole purpose is to support writing a query.
  const relevant = order(
    all.filter((entity) => entity.kind !== 'routine' && inScope(entity, scope)),
    scope
  );

  const detailed = relevant.slice(0, COLUMN_LIMIT);
  const omissions: string[] = [];

  if (relevant.length > detailed.length) {
    omissions.push(
      `${relevant.length - detailed.length} of ${relevant.length} tables are listed by name only; ask for one by name to see its columns.`
    );
  }

  const facts = await mapLimited(detailed, CONCURRENCY, async (entity) => {
    const ref: EntityRef = {
      name: entity.name,
      ...(entity.schema ? { schema: entity.schema } : {}),
    };

    const columns = await client.listColumns(ref).catch(() => []);
    const wantsDetail = detailed.indexOf(entity) < DETAIL_LIMIT;

    const [indexes, relations] = await Promise.all([
      wantsDetail && capabilities.indexes
        ? client.listIndexes(ref).catch(() => [])
        : Promise.resolve([]),
      wantsDetail && capabilities.relations
        ? client.listRelations(ref).catch(() => [])
        : Promise.resolve([]),
    ]);

    return {
      entity,
      columns,
      ...(indexes.length > 0 ? { indexes } : {}),
      ...(relations.length > 0 ? { relations } : {}),
    } satisfies EntityFacts;
  });

  if (detailed.length > DETAIL_LIMIT) {
    omissions.push(
      `Indexes and foreign keys were read for the first ${DETAIL_LIMIT} tables only.`
    );
  }

  const document = buildSchemaDocument({
    engine: client.engine,
    language: capabilities.queryLanguage,
    nouns: capabilities.nouns,
    scope,
    entities: facts,
  });

  const withNotes: SchemaDocument =
    omissions.length > 0 ? { ...document, omissions } : document;

  return narrowSchemaDocument(withNotes, {
    budget: options.budget,
    keep: scope.kind === 'entity' ? [qualifiedName(scope.entity)] : [],
  });
}

/**
 * Everything about a handful of named tables, whatever the budget was.
 *
 * What `inspect_schema` runs. The initial document is bounded and the model is
 * told so; this is how it gets past that bound for the two or three tables it
 * turns out to need, rather than the interface having to guess them in advance.
 */
export async function gatherTables(
  client: DatabaseClient,
  names: readonly string[]
): Promise<SchemaDocument> {
  const capabilities = client.capabilities;
  const all = await client.listEntities();

  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const matched = all.filter((entity) => {
    const qualified = qualifiedName(entity).toLowerCase();
    return wanted.has(qualified) || wanted.has(entity.name.toLowerCase());
  });

  const facts = await mapLimited(matched.slice(0, 20), CONCURRENCY, async (entity) => {
    const ref: EntityRef = {
      name: entity.name,
      ...(entity.schema ? { schema: entity.schema } : {}),
    };
    const [columns, indexes, relations] = await Promise.all([
      client.listColumns(ref).catch(() => []),
      capabilities.indexes ? client.listIndexes(ref).catch(() => []) : Promise.resolve([]),
      capabilities.relations ? client.listRelations(ref).catch(() => []) : Promise.resolve([]),
    ]);
    return { entity, columns, indexes, relations } satisfies EntityFacts;
  });

  const missing = names.filter(
    (name) =>
      !matched.some(
        (entity) =>
          qualifiedName(entity).toLowerCase() === name.toLowerCase() ||
          entity.name.toLowerCase() === name.toLowerCase()
      )
  );

  const document = buildSchemaDocument({
    engine: client.engine,
    language: capabilities.queryLanguage,
    nouns: capabilities.nouns,
    scope: { kind: 'connection' },
    entities: facts,
  });

  // Naming what was not found matters more here than anywhere else: the model
  // asked for these by name, and silence reads as "it exists and is empty".
  return missing.length > 0
    ? { ...document, omissions: [`No such table: ${missing.join(', ')}.`] }
    : document;
}
