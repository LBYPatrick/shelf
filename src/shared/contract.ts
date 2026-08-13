import type {
  Capabilities,
  ChangeSet,
  Column,
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
  SelectRequest,
  Trigger,
} from '../drivers/types';

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
}

export type HostEventName = keyof HostEvents;
