/**
 * The database, as a document.
 *
 * Everything the assistant knows about a database it reads from here. Nine
 * engines disagree about almost every word — a table is a collection is a key,
 * a schema exists or it does not — so handing a model raw driver output would
 * mean the prompt is written nine times and drifts eight ways. One document
 * shape, built from what a driver already answers, is the alternative.
 *
 * It is pure on purpose. Deciding *what to say* about a schema is where a
 * mistake is silent: a relation dropped on the way in becomes a join the model
 * never proposes, and nothing anywhere reports it. Gathering the parts needs a
 * live connection and belongs in the host; turning them into a document needs
 * nothing but the parts, and is unit tested.
 *
 * Two rules run through it:
 *
 *   - **Names are never invented.** Types are the engine's own spelling, so a
 *     model writing `::jsonb` has been told it is talking to Postgres by the
 *     data rather than by an adjective.
 *   - **A document narrower than the database says so.** A schema with nine
 *     hundred tables does not fit a prompt, and the failure mode of quietly
 *     sending the first fifty is a confident query against a table that was
 *     left out. What was omitted is written into the document, in the same
 *     place the model reads everything else.
 */

import type {
  Column,
  Entity,
  EntityKind,
  EntityRef,
  EngineId,
  EngineNouns,
  Index,
  Relation,
} from '../drivers/types';

export const SCHEMA_DOCUMENT_KIND = 'shelf.schema';
export const SCHEMA_DOCUMENT_VERSION = 1;

/** What a document was asked to describe. */
export type SchemaScope =
  | { readonly kind: 'connection' }
  | { readonly kind: 'database'; readonly name: string }
  | { readonly kind: 'schema'; readonly name: string }
  | { readonly kind: 'entity'; readonly entity: EntityRef };

export interface ColumnDoc {
  readonly name: string;
  /** The engine's own type name, verbatim. */
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey?: true;
  readonly default?: string;
  readonly generated?: true;
  /** The column comment, where the engine keeps one. */
  readonly description?: string;
}

export interface IndexDoc {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique?: true;
  readonly primary?: true;
  readonly type?: string;
}

/** One foreign key, written from the side that holds it. */
export interface RelationDoc {
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly schema?: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: string;
  readonly onUpdate?: string;
}

/** A table pointing back at this one, so a join can be found from either end. */
export interface InboundRelationDoc {
  readonly from: { readonly table: string; readonly schema?: string };
  readonly columns: readonly string[];
  readonly toColumns: readonly string[];
}

export interface TableDoc {
  readonly name: string;
  readonly schema?: string;
  readonly kind: EntityKind;
  readonly description?: string;
  readonly columns: readonly ColumnDoc[];
  readonly primaryKey?: readonly string[];
  readonly indexes?: readonly IndexDoc[];
  readonly references?: readonly RelationDoc[];
  readonly referencedBy?: readonly InboundRelationDoc[];
  /** Roughly how many rows, where asking was cheap. Never used as a fact. */
  readonly approximateRows?: number;
}

export interface SchemaDocument {
  readonly kind: typeof SCHEMA_DOCUMENT_KIND;
  readonly version: number;
  readonly engine: EngineId;
  /** The language the engine takes, which is what the model must write. */
  readonly language: string;
  /** The engine's own words, so the prose the model writes back matches it. */
  readonly nouns: EngineNouns;
  readonly scope: SchemaScope;
  readonly tables: readonly TableDoc[];
  /**
   * What this document does not say.
   *
   * Read by the model as well as by the interface: a caveat kept out of the
   * payload is a caveat the reader never gets either.
   */
  readonly omissions?: readonly string[];
}

/** What a driver answered about one entity, before it is a document. */
export interface EntityFacts {
  readonly entity: Entity;
  readonly columns: readonly Column[];
  readonly indexes?: readonly Index[];
  readonly relations?: readonly Relation[];
  readonly approximateRows?: number;
}

export interface SchemaInput {
  readonly engine: EngineId;
  readonly language: string;
  readonly nouns: EngineNouns;
  readonly scope: SchemaScope;
  readonly entities: readonly EntityFacts[];
}

/** `schema.name`, or just the name where the engine has no schemas. */
export function qualifiedName(ref: { name: string; schema?: string }): string {
  return ref.schema ? `${ref.schema}.${ref.name}` : ref.name;
}

function columnDoc(column: Column): ColumnDoc {
  return {
    name: column.name,
    type: column.dataType,
    nullable: column.nullable,
    ...(column.primaryKey ? { primaryKey: true as const } : {}),
    ...(column.defaultValue ? { default: column.defaultValue } : {}),
    ...(column.generated ? { generated: true as const } : {}),
    ...(column.comment ? { description: column.comment } : {}),
  };
}

function indexDoc(index: Index): IndexDoc {
  return {
    name: index.name,
    columns: [...index.columns],
    ...(index.unique ? { unique: true as const } : {}),
    ...(index.primary ? { primary: true as const } : {}),
    ...(index.type ? { type: index.type } : {}),
  };
}

/**
 * One entity's facts, as the document states them.
 *
 * Relations arrive from the driver in both directions on the *holding* table,
 * which is the right answer for a properties panel and the wrong shape for a
 * prompt: "outgoing" and "incoming" are the same edge described twice, and a
 * model reading both writes joins in circles. They are split into the two
 * questions actually asked instead — what this table points at, and what points
 * at it.
 */
export function toTableDoc(facts: EntityFacts): TableDoc {
  const { entity } = facts;
  const columns = [...facts.columns].sort((a, b) => a.ordinal - b.ordinal).map(columnDoc);

  const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);

  const outgoing = (facts.relations ?? []).filter(
    (relation) => relation.direction === 'outgoing'
  );
  const incoming = (facts.relations ?? []).filter(
    (relation) => relation.direction === 'incoming'
  );

  const references = outgoing.map<RelationDoc>((relation) => ({
    columns: [...relation.columns],
    references: {
      table: relation.referencedTable.name,
      ...(relation.referencedTable.schema ? { schema: relation.referencedTable.schema } : {}),
      columns: [...relation.referencedColumns],
    },
    ...(relation.onDelete ? { onDelete: relation.onDelete } : {}),
    ...(relation.onUpdate ? { onUpdate: relation.onUpdate } : {}),
  }));

  /*
   * An incoming relation is stated from the other table's point of view: the
   * driver reports the *referencing* table under `referencedTable`, because
   * from the holder's side that is the other end of the edge.
   */
  const referencedBy = incoming.map<InboundRelationDoc>((relation) => ({
    from: {
      table: relation.referencedTable.name,
      ...(relation.referencedTable.schema ? { schema: relation.referencedTable.schema } : {}),
    },
    columns: [...relation.referencedColumns],
    toColumns: [...relation.columns],
  }));

  // A primary-key index restates the primary key, which the columns already
  // carry. It is dropped rather than sent twice.
  const indexes = (facts.indexes ?? []).filter((index) => !index.primary).map(indexDoc);

  return {
    name: entity.name,
    ...(entity.schema ? { schema: entity.schema } : {}),
    kind: entity.kind,
    ...(entity.comment ? { description: entity.comment } : {}),
    columns,
    ...(primaryKey.length > 0 ? { primaryKey } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(referencedBy.length > 0 ? { referencedBy } : {}),
    ...(typeof facts.approximateRows === 'number'
      ? { approximateRows: facts.approximateRows }
      : {}),
  };
}

export function buildSchemaDocument(input: SchemaInput): SchemaDocument {
  return {
    kind: SCHEMA_DOCUMENT_KIND,
    version: SCHEMA_DOCUMENT_VERSION,
    engine: input.engine,
    language: input.language,
    nouns: input.nouns,
    scope: input.scope,
    tables: input.entities.map(toTableDoc),
  };
}

/**
 * Roughly how many tokens a string costs.
 *
 * Four characters to the token is the ratio every tokeniser lands near for
 * JSON, and the number is only ever used to decide what to leave out — an
 * estimate that is wrong by a tenth changes which table is the last one in,
 * not whether the request succeeds. Asking a provider to count would mean a
 * network round trip per narrowing step, per provider, to answer a question
 * whose consequence is one table.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function schemaDocumentText(document: SchemaDocument): string {
  return JSON.stringify(document);
}

export interface NarrowOptions {
  /** The ceiling the document must fit under, in estimated tokens. */
  readonly budget: number;
  /**
   * Tables to keep whatever happens — the ones the reader was pointing at when
   * they asked. Qualified names, matched case-insensitively.
   */
  readonly keep?: readonly string[];
}

/**
 * The other end of a relation, as a name.
 *
 * A relation names its far end `table`, not `name` — the two shapes look alike
 * and are not, and passing one to `qualifiedName` yields the string
 * `undefined`, which matches nothing and quietly disables the whole
 * neighbour-keeping rule. It is a function so both callers use the same one.
 */
function endpointName(ref: { readonly table: string; readonly schema?: string }): string {
  return qualifiedName({ name: ref.table, ...(ref.schema ? { schema: ref.schema } : {}) });
}

/** Everything `table` points at or is pointed at by, as qualified names. */
function neighbours(table: TableDoc): string[] {
  return [
    ...(table.references ?? []).map((relation) => endpointName(relation.references)),
    ...(table.referencedBy ?? []).map((relation) => endpointName(relation.from)),
  ];
}

/**
 * Cuts a document down to a budget, and says what it cut.
 *
 * Tables are dropped whole rather than trimmed column by column: a table with
 * half its columns is worse than a table that is absent, because the model
 * cannot tell the difference between "this column does not exist" and "you were
 * not shown it", and will write a query against the half it can see.
 *
 * The order of preference is the order a person would use — the tables you
 * asked about, then the ones they are joined to, then the rest as they came.
 * Relations to tables that did not make it are dropped with them, so the
 * document never references something it does not contain.
 */
export function narrowSchemaDocument(
  document: SchemaDocument,
  options: NarrowOptions
): SchemaDocument {
  if (estimateTokens(schemaDocumentText(document)) <= options.budget) return document;

  const keep = new Set((options.keep ?? []).map((name) => name.toLowerCase()));
  const adjacent = new Set<string>();
  for (const table of document.tables) {
    if (!keep.has(qualifiedName(table).toLowerCase())) continue;
    for (const name of neighbours(table)) adjacent.add(name.toLowerCase());
  }

  const rank = (table: TableDoc): number => {
    const name = qualifiedName(table).toLowerCase();
    if (keep.has(name)) return 0;
    if (adjacent.has(name)) return 1;
    return 2;
  };

  const ordered = document.tables
    .map((table, index) => ({ table, index, rank: rank(table) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);

  const chosen: TableDoc[] = [];
  const empty = schemaDocumentText({ ...document, tables: [] });
  let cost = estimateTokens(empty);

  for (const { table } of ordered) {
    const size = estimateTokens(JSON.stringify(table));
    if (cost + size > options.budget && chosen.length > 0) continue;
    chosen.push(table);
    cost += size;
  }

  const present = new Set(chosen.map((table) => qualifiedName(table).toLowerCase()));
  const dropped = document.tables.length - chosen.length;

  // Put them back in the order they arrived: a list re-sorted by relevance
  // reads as a ranking the reader did not ask for.
  const byName = new Map(chosen.map((table) => [qualifiedName(table), table]));
  const tables = document.tables
    .map((table) => byName.get(qualifiedName(table)))
    .filter((table): table is TableDoc => table !== undefined)
    .map((table) => pruneDanglingRelations(table, present));

  return {
    ...document,
    tables,
    omissions: [
      ...(document.omissions ?? []),
      `${dropped} of ${document.tables.length} tables are not included; ask before assuming a table does not exist.`,
    ],
  };
}

function pruneDanglingRelations(table: TableDoc, present: ReadonlySet<string>): TableDoc {
  const references = (table.references ?? []).filter((relation) =>
    present.has(endpointName(relation.references).toLowerCase())
  );
  const referencedBy = (table.referencedBy ?? []).filter((relation) =>
    present.has(endpointName(relation.from).toLowerCase())
  );

  const next: Record<string, unknown> = { ...table };
  if (references.length > 0) next['references'] = references;
  else delete next['references'];
  if (referencedBy.length > 0) next['referencedBy'] = referencedBy;
  else delete next['referencedBy'];

  return next as unknown as TableDoc;
}

/** How the scope reads in a sentence, for a prompt and for a label. */
export function scopeLabel(scope: SchemaScope): string {
  switch (scope.kind) {
    case 'entity':
      return qualifiedName(scope.entity);
    case 'connection':
      return 'the whole connection';
    default:
      return scope.name;
  }
}
