import type {
  Capabilities,
  ChangeSet,
  Column,
  ContainerProperties,
  ContainerRef,
  Entity,
  EntityProperties,
  EntityRef,
  Field,
  FieldEditability,
  Filters,
  Index,
  Page,
  Partition,
  QueryOptions,
  Relation,
  ResultSet,
  Row,
  SelectRequest,
  ServerMetrics,
  StatementReport,
  Trigger,
} from '../drivers/types';
import type {
  AiDeltaEvent,
  AiDriverKind,
  AiItemEvent,
  AiMessage,
  AiPhaseEvent,
  AiReplaceEvent,
  AiSignInState,
  AiTurn,
} from './ai';
import type { SchemaDocument, SchemaScope } from './schemaDoc';

/**
 * Every channel the connection host answers, with the shape of what goes in and
 * what comes back.
 *
 * Keeping this as one map means the renderer's client and the host's registry
 * are checked against the same declaration: adding a channel to one without the
 * other is a type error rather than a runtime "unknown channel".
 */
export interface HostContract {
  /**
   * Opens a connection whose credentials main has already staged with the host.
   * The renderer passes a handle, never a password: secrets travel from the
   * keyring to the host directly and are never held in the interface process.
   */
  'conn/open': {
    payload: { connectionId: string; handle: string };
    result: { capabilities: Capabilities; version: string };
  };
  'conn/close': { payload: { connectionId: string }; result: void };
  'conn/test': {
    payload: { handle: string };
    result: { ok: true; version: string } | { ok: false; message: string };
  };
  'conn/ping': { payload: { connectionId: string }; result: void };

  'schema/databases': { payload: { connectionId: string }; result: readonly string[] };
  'schema/schemas': { payload: { connectionId: string }; result: readonly string[] };
  'schema/entities': {
    payload: { connectionId: string; schema?: string };
    result: readonly Entity[];
  };
  'schema/columns': {
    payload: { connectionId: string; entity: EntityRef };
    result: readonly Column[];
  };
  'schema/indexes': {
    payload: { connectionId: string; entity: EntityRef };
    result: readonly Index[];
  };
  'schema/relations': {
    payload: { connectionId: string; entity: EntityRef };
    result: readonly Relation[];
  };
  'schema/triggers': {
    payload: { connectionId: string; entity: EntityRef };
    result: readonly Trigger[];
  };
  'schema/partitions': {
    payload: { connectionId: string; entity: EntityRef };
    result: readonly Partition[];
  };
  'schema/properties': {
    payload: { connectionId: string; entity: EntityRef };
    result: EntityProperties;
  };
  'schema/container': {
    payload: { connectionId: string; target: ContainerRef };
    result: ContainerProperties;
  };

  /**
   * The server's own statistics, exactly as it keeps them: cumulative since it
   * last reset the counters. Turning a pair of readings into "the last hour"
   * happens in the interface, where the history lives.
   */
  'stats/statements': { payload: { connectionId: string }; result: StatementReport };
  'stats/metrics': { payload: { connectionId: string }; result: ServerMetrics };

  'data/select': { payload: { connectionId: string; request: SelectRequest }; result: Page };
  'data/selectSql': {
    payload: { connectionId: string; request: SelectRequest };
    result: string;
  };
  'data/count': {
    payload: { connectionId: string; entity: EntityRef; filters?: Filters };
    result: number;
  };

  'query/run': {
    payload: { connectionId: string; text: string; options: QueryOptions };
    result: readonly ResultSet[];
  };
  'query/editability': {
    payload: { connectionId: string; text: string; fields: readonly Field[] };
    result: readonly FieldEditability[];
  };

  'changes/apply': { payload: { connectionId: string; changes: ChangeSet }; result: void };
  'changes/preview': {
    payload: { connectionId: string; changes: ChangeSet };
    result: string;
  };

  /**
   * Streams a table or a query to a file. The rows never enter the interface
   * process: the cursor stays in the host and writes straight to disk.
   */
  'export/run': {
    payload: {
      connectionId: string;
      path: string;
      format: 'csv' | 'json' | 'jsonl' | 'sql';
      entity?: EntityRef;
      query?: string;
      filters?: Filters;
    };
    result: { rowsWritten: number };
  };

  /**
   * Inserts rows into an existing table, in batches, inside one transaction.
   * The file is read in the host so a large import never crosses into the
   * interface process.
   */
  'import/run': {
    payload: {
      connectionId: string;
      entity: EntityRef;
      path: string;
      /** Source column name for each target column; absent means skip. */
      mapping: Readonly<Record<string, string>>;
      truncateFirst: boolean;
    };
    result: { inserted: number };
  };

  'import/preview': {
    payload: { path: string; limit: number };
    result: { header: readonly string[]; rows: readonly (readonly string[])[]; total: number };
  };

  /**
   * Runs a statement to completion and spools every row to a file.
   *
   * The counterpart of `query/run`, and the difference is what each is for. A
   * run is a look at the first page and carries a limit; a dispatch is asked
   * for because the whole answer is wanted, so it takes no limit and the rows
   * never enter the interface — they go from the cursor to disk, and the pages
   * and the export are both read back from there. Exporting afterwards is a
   * copy rather than a second execution of the statement, which for a long
   * query is minutes saved and, on live data, a different answer avoided.
   */
  'job/run': {
    payload: { connectionId: string; jobId: string; text: string };
    result: { rows: number; fields: readonly Field[]; bytes: number; path: string };
  };
  /** One page out of a spool, for the viewer. */
  'job/page': {
    payload: { path: string; offset: number; limit: number };
    result: { fields: readonly Field[]; rows: readonly Row[] };
  };
  /** Writes a spool out in one of the file formats, without re-running anything. */
  'job/export': {
    payload: { path: string; target: string; format: 'csv' | 'json' | 'jsonl' | 'sql' };
    result: { rowsWritten: number };
  };
  /** Drops a spool from disk; a job whose rows are gone is history, not a result. */
  'job/discard': { payload: { path: string }; result: void };

  /**
   * The database as a document, for the assistant to read.
   *
   * Gathered in the host because that is where the connection is, and because
   * a schema with six hundred tables is eighteen hundred round trips — work
   * that has no business queueing behind the interface's own.
   */
  'ai/schema': {
    payload: { connectionId: string; scope: SchemaScope; budget?: number };
    result: SchemaDocument;
  };

  /**
   * One turn of a conversation.
   *
   * The request stays open for the whole turn and resolves with everything it
   * produced; what arrives in between comes as `ai/*` events. That is what
   * makes cancellation work without a second channel — the existing RPC cancel
   * aborts the request, and the abort reaches the provider's socket and the
   * database cursor alike.
   */
  'ai/turn': {
    payload: {
      connectionId: string;
      handle: string;
      turnId: string;
      scope: SchemaScope;
      history: readonly AiMessage[];
      question: string;
      /**
       * The interface's language, as a BCP-47 tag, so the reply can default to
       * it. The host has no way to know this: it is a renderer setting and the
       * OS locale of a utility process is not the one the reader chose.
       */
      locale?: string;
    };
    result: AiTurn;
  };

  /**
   * Which command-line assistants this machine has on it.
   *
   * Asked at launch and again whenever the picker opens, rather than stored:
   * somebody installs Codex or removes Claude Code without telling the app, and
   * a list built once would go on offering what is no longer there. It is a
   * handful of `access` calls, so asking is cheaper than remembering.
   */
  'ai/installed': { payload: Record<string, never>; result: readonly AiDriverKind[] };

  /**
   * Whether a command-line assistant has anybody signed in to it.
   *
   * Asked before a turn runs, and again by the sheet that tells somebody how to
   * sign in — a "check again" that lands on the same answer the turn will get is
   * the whole reason that button is worth having.
   */
  'ai/signedIn': { payload: { kind: AiDriverKind }; result: AiSignInState };

  /** Does this provider answer, with these credentials, for this model. */
  'ai/probe': {
    payload: { handle: string };
    result: { ok: true } | { ok: false; message: string };
  };

  'txn/begin': { payload: { connectionId: string; tabId: string }; result: void };
  'txn/commit': { payload: { connectionId: string; tabId: string }; result: void };
  'txn/rollback': { payload: { connectionId: string; tabId: string }; result: void };
}

export type HostChannel = keyof HostContract;
export type HostPayload<K extends HostChannel> = HostContract[K]['payload'];
export type HostResult<K extends HostChannel> = HostContract[K]['result'];

/** Events the host pushes without being asked. */
export interface HostEvents {
  'connection/lost': { connectionId: string; message: string };
  'export/progress': { exportId: string; rowsWritten: number; done: boolean };
  'ai/item': AiItemEvent;
  'ai/phase': AiPhaseEvent;
  'ai/delta': AiDeltaEvent;
  'ai/replace': AiReplaceEvent;
}

export type HostEventName = keyof HostEvents;
