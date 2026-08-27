import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerEngines } from '@drivers/index';
import { createClient } from '@drivers/registry';
import type { DatabaseClient } from '@drivers/types';
import { TARGETS, type Target } from './targets';

registerEngines();

/**
 * One suite, every engine.
 *
 * The point is not to test each driver's private details but to prove they
 * genuinely present the same interface — that the abstraction holds against
 * seven real databases rather than only in the type system. Where an engine
 * cannot do something it must say so through `capabilities`, and the suite
 * asserts the absence rather than skipping quietly.
 */

/** Statements that create the fixture, per engine. */
function fixture(target: Target): { create: string[]; insert: string[]; drop: string[] } {
  const table = target.table;

  switch (target.engine) {
    case 'postgres':
      return {
        create: [
          `DROP TABLE IF EXISTS ${table}`,
          `CREATE TABLE ${table} (id integer PRIMARY KEY, label text, amount numeric(10,2), created timestamptz)`,
        ],
        insert: [
          `INSERT INTO ${table} VALUES (1, 'alpha', 10.50, now()), (2, 'be,ta', 20.25, now()), (3, NULL, NULL, NULL)`,
        ],
        drop: [`DROP TABLE IF EXISTS ${table}`],
      };

    case 'mysql':
    case 'tidb':
      return {
        create: [
          `DROP TABLE IF EXISTS ${table}`,
          `CREATE TABLE ${table} (id int PRIMARY KEY, label varchar(64), amount decimal(10,2), created datetime)`,
        ],
        insert: [
          `INSERT INTO ${table} VALUES (1, 'alpha', 10.50, now()), (2, 'be,ta', 20.25, now()), (3, NULL, NULL, NULL)`,
        ],
        drop: [`DROP TABLE IF EXISTS ${table}`],
      };

    case 'scylla':
      return {
        create: [
          `CREATE KEYSPACE IF NOT EXISTS shelf WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
          `DROP TABLE IF EXISTS shelf.${table}`,
          `CREATE TABLE shelf.${table} (id int PRIMARY KEY, label text, amount decimal)`,
        ],
        insert: [
          `INSERT INTO shelf.${table} (id, label, amount) VALUES (1, 'alpha', 10.50)`,
          `INSERT INTO shelf.${table} (id, label, amount) VALUES (2, 'be,ta', 20.25)`,
          `INSERT INTO shelf.${table} (id) VALUES (3)`,
        ],
        drop: [`DROP TABLE IF EXISTS shelf.${table}`],
      };

    default:
      return { create: [], insert: [], drop: [] };
  }
}

for (const target of TARGETS) {
  describe(target.label, () => {
    let client: DatabaseClient;

    beforeAll(async () => {
      // A CQL connection that names a keyspace fails outright if it does not
      // exist, so the keyspace is created from a connection that names none.
      if (target.engine === 'scylla') {
        const { database: _database, ...withoutKeyspace } = target.config;
        const bootstrap = await createClient({ ...withoutKeyspace, engine: 'scylla' });
        await bootstrap.connect();
        await bootstrap.query(
          `CREATE KEYSPACE IF NOT EXISTS shelf WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
          { maxRows: 1 }
        );
        await bootstrap.disconnect();
      }

      client = await createClient(target.config);
      await client.connect();

      const sql = fixture(target);
      for (const statement of [...sql.create, ...sql.insert]) {
        await client.query(statement, { maxRows: 10 });
      }

      // The document and key-value stores build their fixture through the same
      // write path the interface uses, since they have no DDL.
      if (target.engine === 'mongodb') {
        await client.query(`db.${target.table}.deleteMany({})`, { maxRows: 10 });
        await client.query(
          `db.${target.table}.insertMany([{"id":1,"label":"alpha","amount":10.5},{"id":2,"label":"be,ta","amount":20.25},{"id":3,"label":null}])`,
          { maxRows: 10 }
        );
      }

      if (target.engine === 'redis') {
        await client.query(
          [
            'SET shelf:conformance:1 alpha',
            'SET shelf:conformance:2 "be,ta"',
            'SET shelf:conformance:3 ""',
          ].join('\n'),
          { maxRows: 10 }
        );
      }

      if (target.engine === 'dynamodb') {
        const { CreateTableCommand, DeleteTableCommand, DynamoDBClient } =
          await import('@aws-sdk/client-dynamodb');
        const raw = new DynamoDBClient({
          region: 'us-east-1',
          endpoint: 'http://127.0.0.1:58000',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        });

        await raw
          .send(new DeleteTableCommand({ TableName: target.table }))
          .catch(() => undefined);
        await raw.send(
          new CreateTableCommand({
            TableName: target.table,
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'N' }],
            BillingMode: 'PAY_PER_REQUEST',
          })
        );
        raw.destroy();

        await client.applyChanges({
          inserts: [
            { entity: { name: target.table }, values: { id: 1, label: 'alpha', amount: 10.5 } },
            {
              entity: { name: target.table },
              values: { id: 2, label: 'be,ta', amount: 20.25 },
            },
            { entity: { name: target.table }, values: { id: 3, label: null } },
          ],
          updates: [],
          deletes: [],
        });
      }
    });

    afterAll(async () => {
      for (const statement of fixture(target).drop) {
        await client?.query(statement, { maxRows: 1 }).catch(() => undefined);
      }
      await client?.disconnect().catch(() => undefined);
    });

    it('reports a version, and an actual one', async () => {
      /*
       * "PostgreSQL unknown" is truthy and longer than two characters, and it
       * is what this suite accepted for as long as the Postgres driver read a
       * column the server does not name. A version string has to carry a
       * version: at least one digit, and not the word we print when there is
       * none.
       */
      const version = await client.versionString();
      expect(version).toBeTruthy();
      expect(version.length).toBeGreaterThan(2);
      expect(version, `${target.label} does not say which version`).toMatch(/\d/);
      expect(version.toLowerCase()).not.toContain('unknown');
    });

    it('answers a ping', async () => {
      await expect(client.ping()).resolves.toBeUndefined();
    });

    it('lists the databases it can see', async () => {
      const databases = await client.listDatabases();
      expect(Array.isArray(databases)).toBe(true);
    });

    it('lists schemas only when it has them', async () => {
      const schemas = await client.listSchemas();
      if (client.capabilities.schemas) expect(schemas.length).toBeGreaterThan(0);
      else expect(schemas).toEqual([]);
    });

    it('finds the fixture among its entities', async () => {
      const entities = await client.listEntities();
      expect(entities.some((entity) => entity.name === target.table)).toBe(true);
    });

    it('describes the fixture’s columns', async () => {
      const columns = await client.listColumns({ name: target.table });
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.every((column) => typeof column.dataType === 'string')).toBe(true);
    });

    it('reads a page of rows', async () => {
      const page = await client.selectTop({
        entity: { name: target.table },
        offset: 0,
        limit: 10,
      });
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.fields.length).toBeGreaterThan(0);
    });

    it('honours the page limit', async () => {
      const page = await client.selectTop({
        entity: { name: target.table },
        offset: 0,
        limit: 1,
      });
      expect(page.rows.length).toBe(1);
    });

    it('produces readable SQL for the read it just did', async () => {
      const sql = await client.selectTopSql({
        entity: { name: target.table },
        offset: 0,
        limit: 5,
      });
      expect(typeof sql).toBe('string');
      expect(sql.length).toBeGreaterThan(5);
    });

    it('counts rows', async () => {
      const total = await client.count({ name: target.table });
      expect(total).toBeGreaterThanOrEqual(3);
    });

    it('streams every row in chunks without loading them all', async () => {
      const cursor = await client.stream({ entity: { name: target.table }, chunkSize: 2 });

      let seen = 0;
      for (;;) {
        const chunk = await cursor.read();
        if (chunk.length === 0) break;
        seen += chunk.length;
        if (seen > 1000) break;
      }
      await cursor.close();

      expect(seen).toBeGreaterThanOrEqual(3);
    });

    /*
     * The column list is an array, not something that prints like one.
     *
     * Postgres returns `array_agg(name)` as OID 1003, which `pg` has no parser
     * for and hands back verbatim as the string `{id,name}`. Everything type-
     * checked, everything crossed the process boundary intact, and the first
     * `.join()` in the interface took the whole structure view down with it.
     * The shape is what the interface relies on, so the shape is what is
     * asserted.
     */
    it('lists indexes, or declares it has none', async () => {
      if (!client.capabilities.indexes) return;
      const indexes = await client.listIndexes({ name: target.table });
      expect(Array.isArray(indexes)).toBe(true);
      for (const index of indexes) {
        expect(Array.isArray(index.columns), `${index.name}.columns`).toBe(true);
      }
    });

    it('lists relations, or declares it has none', async () => {
      if (!client.capabilities.relations) return;
      const relations = await client.listRelations({ name: target.table });
      expect(Array.isArray(relations)).toBe(true);
      for (const relation of relations) {
        expect(Array.isArray(relation.columns), `${relation.name}.columns`).toBe(true);
        expect(Array.isArray(relation.referencedColumns)).toBe(true);
      }
    });

    it('reports properties', async () => {
      const properties = await client.getProperties({ name: target.table });
      expect(typeof properties).toBe('object');
    });

    it('refuses transactions it does not have', async () => {
      if (client.capabilities.transactions) return;
      await expect(client.beginTransaction('t')).rejects.toThrow();
    });

    it('quotes an identifier', () => {
      const quoted = client.quoteIdentifier('odd name');
      expect(quoted).toContain('odd name');
    });

    /**
     * The write path, end to end: change a value, read it back, put it back.
     * This is the part that would quietly corrupt someone's data if a driver
     * got its key handling wrong, so it runs against every engine that claims
     * it can write.
     */
    it('writes a value and reads it back', async () => {
      const entity = { name: target.table };

      // The key column is whatever the driver itself declares, not something
      // this test assumes. That is the real contract: if a driver says a column
      // identifies a row, addressing a row by it has to work.
      const columns = await client.listColumns(entity);
      const keyColumn = columns.find((column) => column.primaryKey)?.name;
      expect(keyColumn, `${target.label} declares no primary key`).toBeTruthy();

      const valueColumn = target.engine === 'redis' ? 'value' : 'label';

      const before = await client.selectTop({ entity, offset: 0, limit: 50 });
      const original = before.rows.find((row) => row[keyColumn!] !== null);
      expect(original, 'no addressable row in the fixture').toBeDefined();

      const keyValue = original![keyColumn!]!;

      await client.applyChanges({
        inserts: [],
        updates: [
          {
            entity,
            primaryKeys: [{ column: keyColumn!, value: keyValue }],
            column: valueColumn,
            value: 'rewritten',
          },
        ],
        deletes: [],
      });

      const after = await client.selectTop({ entity, offset: 0, limit: 50 });
      const updated = after.rows.find((row) => String(row[keyColumn!]) === String(keyValue));
      expect(String(updated?.[valueColumn])).toBe('rewritten');

      // Put it back, so the order tests run in does not matter.
      await client.applyChanges({
        inserts: [],
        updates: [
          {
            entity,
            primaryKeys: [{ column: keyColumn!, value: keyValue }],
            column: valueColumn,
            value: original?.[valueColumn] ?? null,
          },
        ],
        deletes: [],
      });
    });

    it('previews the write as text before doing it', async () => {
      const preview = await client.applyChangesSql({
        inserts: [],
        updates: [
          {
            entity: { name: target.table },
            primaryKeys: [{ column: target.engine === 'redis' ? 'key' : 'id', value: 1 }],
            column: target.engine === 'redis' ? 'value' : 'label',
            value: 'x',
          },
        ],
        deletes: [],
      });

      expect(typeof preview).toBe('string');
      expect(preview.length).toBeGreaterThan(0);
    });

    it('refuses to address a row it cannot identify', async () => {
      // Without a key there is no safe way to name one row, and guessing could
      // rewrite several. Every engine must refuse rather than approximate.
      await expect(
        client.applyChanges({
          inserts: [],
          updates: [
            {
              entity: { name: target.table },
              primaryKeys: [],
              column: 'label',
              value: 'x',
            },
          ],
          deletes: [],
        })
      ).rejects.toThrow();
    });

    it('says which result columns can be edited, and why not', async () => {
      const page = await client.selectTop({
        entity: { name: target.table },
        offset: 0,
        limit: 1,
      });
      const editability = await client.resolveEditability(
        `SELECT * FROM ${target.table}`,
        page.fields
      );

      expect(editability.length).toBe(page.fields.length);
      for (const field of editability) {
        // A locked column always carries a reason, so the grid can explain it.
        if (!field.editable) expect(field.reason).toBeTruthy();
      }
    });

    /**
     * A regression guard for a bug worth remembering: MySQL returns unaliased
     * `information_schema` columns in upper case, so reading `row.column_key`
     * off `COLUMN_KEY` silently gave undefined. Every MySQL table then looked
     * like it had no primary key, and the grid disabled editing everywhere.
     */
    it('detects the fixture’s primary key', async () => {
      if (!client.capabilities.ddl && target.engine !== 'dynamodb') return;

      const columns = await client.listColumns({ name: target.table });
      const keys = columns.filter((column) => column.primaryKey);
      expect(keys.length, `${target.label} found no primary key column`).toBeGreaterThan(0);
    });

    it('describes itself consistently', () => {
      const capabilities = client.capabilities;
      expect(capabilities.nouns.entity).toBeTruthy();
      expect(capabilities.nouns.row).toBeTruthy();
      // An engine that cannot sort server-side must not claim it can.
      expect(['full', 'partial', 'none']).toContain(capabilities.sortPushdown);
    });
  });
}
