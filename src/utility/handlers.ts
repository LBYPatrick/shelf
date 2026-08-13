import { createClient } from '@drivers/registry';
import type { HostChannel, HostContract } from '@shared/contract';
import { runExport } from './export';
import { cellToValue, readTable } from './import';
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

    const client = await createClient(session.consume(handle));
    await client.connect(signal);
    session.connections.set(connectionId, client);

    return { capabilities: client.capabilities, version: await client.versionString() };
  },

  'conn/close': async (session, { connectionId }) => {
    const client = session.connections.get(connectionId);
    if (!client) return;
    session.connections.delete(connectionId);
    await client.disconnect();
  },

  'conn/test': async (session, { handle }, signal) => {
    const client = await createClient(session.consume(handle));
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

  'data/select': (session, { connectionId, request }) =>
    session.require(connectionId).selectTop(request),
  'data/selectSql': (session, { connectionId, request }) =>
    session.require(connectionId).selectTopSql(request),
  'data/count': (session, { connectionId, entity, filters }) =>
    session.require(connectionId).count(entity, filters),

  'query/run': (session, { connectionId, text, options }, signal) =>
    session.require(connectionId).query(text, options, signal),
  'query/editability': (session, { connectionId, text, fields }) =>
    session.require(connectionId).resolveEditability(text, fields),

  'changes/apply': (session, { connectionId, changes }) =>
    session.require(connectionId).applyChanges(changes),
  'changes/preview': (session, { connectionId, changes }) =>
    session.require(connectionId).applyChangesSql(changes),

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

  'txn/begin': (session, { connectionId, tabId }) =>
    session.require(connectionId).beginTransaction(tabId),
  'txn/commit': (session, { connectionId, tabId }) =>
    session.require(connectionId).commitTransaction(tabId),
  'txn/rollback': (session, { connectionId, tabId }) =>
    session.require(connectionId).rollbackTransaction(tabId),
};
