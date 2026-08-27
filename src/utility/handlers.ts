import { createClient } from '@drivers/registry';
import type { HostChannel, HostContract } from '@shared/contract';
import { changesShape } from '@ai/schemaCache';
import { probe, schemaFor, turn } from './assistant';
import { runExport } from './export';
import { cellToValue, readTable } from './import';
import { discardSpool, readSpoolPage, spool, spoolCursor, spoolPath } from './spool';
import { openTunnel, through } from './tunnel';
import type { Session } from './session';

/**
 * A handler receives the session it belongs to, the request payload, and a
 * signal that fires when the caller cancels. Long operations are expected to
 * honour the signal — a cancelled query must be cancelled at the database, not
 * merely ignored here.
 */
export type Handler<K extends HostChannel> = (
  session: Session,
  payload: HostContract[K]['payload'],
  signal: AbortSignal
) => Promise<HostContract[K]['result']>;

type Registry = { [K in HostChannel]: Handler<K> };

export const handlers: Registry = {
  'conn/open': async (session, { connectionId, handle }, signal) => {
    // Reconnecting over a live connection would leak the old one.
    const existing = session.connections.get(connectionId);
    if (existing) await existing.disconnect().catch(() => undefined);
    await session.closeTunnel(connectionId);

    /*
     * The tunnel comes up first and the driver is pointed at it, so no driver
     * knows anything about proxying — see `utility/tunnel.ts`. It is closed
     * with the connection, and again on the way in, because a reconnect that
     * left the old listener behind would leak a port per attempt.
     */
    const config = session.consume(handle);
    const tunnel = await openTunnel(config);

    try {
      const client = await createClient(through(config, tunnel));
      await client.connect(signal);
      session.connections.set(connectionId, client);
      if (tunnel) session.tunnels.set(connectionId, tunnel);

      return { capabilities: client.capabilities, version: await client.versionString() };
    } catch (error) {
      await tunnel?.close().catch(() => undefined);
      throw error;
    }
  },

  'conn/close': async (session, { connectionId }) => {
    const client = session.connections.get(connectionId);
    session.connections.delete(connectionId);
    session.closeSchemaCache(connectionId);
    await client?.disconnect();
    await session.closeTunnel(connectionId);
  },

  'conn/test': async (session, { handle }, signal) => {
    // Tested through the tunnel too, or "test connection" would pass on a
    // machine that cannot reach the database at all.
    const config = session.consume(handle);
    const tunnel = await openTunnel(config);
    const client = await createClient(through(config, tunnel));
    try {
      await client.connect(signal);
      return { ok: true as const, version: await client.versionString() };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await client.disconnect().catch(() => undefined);
      // A test owns its tunnel and takes it down with it; nothing is left
      // listening after a dialog the reader has already closed.
      await tunnel?.close().catch(() => undefined);
    }
  },

  'conn/ping': (session, { connectionId }) => session.require(connectionId).ping(),

  'schema/databases': (session, { connectionId }) =>
    session.require(connectionId).listDatabases(),
  'schema/schemas': (session, { connectionId }) => session.require(connectionId).listSchemas(),
  'schema/entities': (session, { connectionId, schema }) =>
    session.require(connectionId).listEntities(schema),
  'schema/columns': (session, { connectionId, entity }) =>
    session.require(connectionId).listColumns(entity),
  'schema/indexes': (session, { connectionId, entity }) =>
    session.require(connectionId).listIndexes(entity),
  'schema/relations': (session, { connectionId, entity }) =>
    session.require(connectionId).listRelations(entity),
  'schema/triggers': (session, { connectionId, entity }) =>
    session.require(connectionId).listTriggers(entity),
  'schema/partitions': (session, { connectionId, entity }) =>
    session.require(connectionId).listPartitions(entity),
  'schema/properties': (session, { connectionId, entity }) =>
    session.require(connectionId).getProperties(entity),
  'schema/container': async (session, { connectionId, target }) => {
    const client = session.require(connectionId);
    // The capability is the declaration; this is the same answer stated in the
    // type system, for a driver that has one without the other.
    return client.getContainerProperties?.(target) ?? { facts: [] };
  },

  'stats/statements': async (session, { connectionId }) => {
    const client = session.require(connectionId);
    return client.readStatements?.() ?? { ok: false as const, problem: 'unsupported' as const };
  },
  'stats/metrics': async (session, { connectionId }) => {
    const client = session.require(connectionId);
    return (
      client.readMetrics?.() ?? {
        gauges: [],
        largestTables: [],
        activity: [],
        unusedIndexes: [],
      }
    );
  },

  'data/select': (session, { connectionId, request }) =>
    session.require(connectionId).selectTop(request),
  'data/selectSql': (session, { connectionId, request }) =>
    session.require(connectionId).selectTopSql(request),
  'data/count': (session, { connectionId, entity, filters }) =>
    session.require(connectionId).count(entity, filters),

  /*
   * The one door DDL goes through.
   *
   * The query tab runs whatever was typed, and the structure editor's "Apply
   * schema change" runs its statement here too — so this is where a schema the
   * assistant has remembered stops being true. Dropped in a `finally` because a
   * statement that failed may still have got half way, and a needless drop
   * costs one re-read where a missed one costs a model describing a column that
   * is no longer there.
   */
  'query/run': async (session, { connectionId, text, options }, signal) => {
    try {
      return await session.require(connectionId).query(text, options, signal);
    } finally {
      if (changesShape(text)) session.forgetSchema(connectionId);
    }
  },
  'query/editability': (session, { connectionId, text, fields }) =>
    session.require(connectionId).resolveEditability(text, fields),

  'changes/apply': (session, { connectionId, changes }) =>
    session.require(connectionId).applyChanges(changes),
  'changes/preview': (session, { connectionId, changes }) =>
    session.require(connectionId).applyChangesSql(changes),

  /*
   * Dispatch: the statement runs to completion and every row lands on disk.
   *
   * No limit is applied — that is the whole distinction from `query/run`, which
   * exists to fetch a page you can look at. The cursor is drained straight into
   * a spool, so the cost is bounded by the chunk size rather than by the size
   * of the answer.
   */
  'job/run': async (session, { connectionId, jobId, text }, signal) => {
    const client = session.require(connectionId);

    try {
      const cursor = await client.stream({ query: text, chunkSize: 1000 });
      const path = spoolPath(jobId);

      const result = await spool(cursor, path, undefined, signal);
      return { ...result, path };
    } finally {
      if (changesShape(text)) session.forgetSchema(connectionId);
    }
  },

  'job/page': (_session, { path, offset, limit }) => readSpoolPage(path, offset, limit),

  'job/export': async (_session, { path, target, format }, signal) => {
    const cursor = await spoolCursor(path, 1000);

    let rowsWritten = 0;
    await runExport(
      cursor,
      { format, path: target, chunkSize: 1000 },
      (progress) => (rowsWritten = progress.rowsWritten),
      signal
    );

    return { rowsWritten };
  },

  'job/discard': (_session, { path }) => discardSpool(path),

  'export/run': async (session, payload, signal) => {
    const client = session.require(payload.connectionId);

    const cursor = await client.stream({
      ...(payload.entity ? { entity: payload.entity } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.filters ? { filters: payload.filters } : {}),
      chunkSize: 1000,
    });

    let rowsWritten = 0;
    await runExport(
      cursor,
      {
        format: payload.format,
        path: payload.path,
        chunkSize: 1000,
        ...(payload.entity ? { table: payload.entity.name } : {}),
      },
      (progress) => (rowsWritten = progress.rowsWritten),
      signal
    );

    return { rowsWritten };
  },

  'import/preview': async (_session, { path, limit }) => {
    const table = await readTable(path);
    return { header: table.header, rows: table.rows.slice(0, limit), total: table.rows.length };
  },

  'import/run': async (session, payload) => {
    const client = session.require(payload.connectionId);
    const table = await readTable(payload.path);

    const targets = Object.keys(payload.mapping);
    const sourceIndex = new Map(table.header.map((name, index) => [name, index]));

    if (payload.truncateFirst) {
      await client.query(`DELETE FROM ${client.quoteIdentifier(payload.entity.name)}`, {
        maxRows: 1,
      });
    }

    // Batched rather than one statement per row: a thousand round trips is the
    // difference between an import that takes a second and one that takes a
    // minute.
    const BATCH = 500;
    let inserted = 0;

    for (let start = 0; start < table.rows.length; start += BATCH) {
      const slice = table.rows.slice(start, start + BATCH);

      await client.applyChanges({
        inserts: slice.map((row) => ({
          entity: payload.entity,
          values: Object.fromEntries(
            targets.map((target) => {
              const index = sourceIndex.get(payload.mapping[target] ?? '');
              return [target, index === undefined ? null : cellToValue(row[index] ?? '')];
            })
          ),
        })),
        updates: [],
        deletes: [],
      });

      inserted += slice.length;
    }

    return { inserted };
  },

  'ai/schema': (session, { connectionId, scope, budget }, signal) =>
    schemaFor(session, connectionId, scope, budget, signal),

  'ai/turn': (session, payload, signal) => turn(session, payload, signal),

  'ai/probe': (session, { handle }, signal) => probe(session, handle, signal),

  'txn/begin': (session, { connectionId, tabId }) =>
    session.require(connectionId).beginTransaction(tabId),
  'txn/commit': (session, { connectionId, tabId }) =>
    session.require(connectionId).commitTransaction(tabId),
  'txn/rollback': (session, { connectionId, tabId }) =>
    session.require(connectionId).rollbackTransaction(tabId),
};
