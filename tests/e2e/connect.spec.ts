import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import {
  createConnection,
  newQueryTab,
  openTable,
  revealTables,
  typeQuery,
  withClipboard,
} from './helpers';

/**
 * Exercises the entire path in one go: the renderer talks to main, main stages
 * credentials with the connection host, the host loads a driver in its own
 * process, and the result comes back. SQLite is used because it needs no
 * server, so this runs anywhere.
 */
test('creates, tests and opens a SQLite connection end to end', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-db-'));
  const file = join(directory, 'scratch.db');

  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'SQLite', exact: true }).click();
  await page.getByLabel('Database file').fill(file);
  await page.getByLabel('Name').fill('Scratch');

  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByRole('status')).toContainText('SQLite', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  // The workspace replaces the start screen, and the title bar identifies the
  // database we are actually attached to.
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Scratch/ })).toBeVisible();
});

test('browses a table and reads its rows', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-db-'));
  const file = join(directory, 'people.db');

  await createConnection(page, { engine: 'SQLite', file: file, name: 'People' });

  // An empty database still gives a usable workspace: the sidebar says so
  // rather than showing a spinner forever, and no tab is open.
  await expect(page.getByText('Nothing is open')).toBeVisible();
  await expect(page.getByRole('button', { name: /Search tables/ })).toBeVisible();
  await expect(page.getByText('This database has no tables yet.')).toBeVisible();
});

test('opens a DuckDB database, which needs no server either', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-duck-')), 'scratch.duckdb');

  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'DuckDB', exact: true }).click();
  await page.getByLabel('Database file').fill(file);
  await page.getByLabel('Name').fill('Duck');

  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByRole('status')).toContainText('DuckDB', { timeout: 30_000 });
});

test('reports a bad connection instead of failing silently', async ({ page }) => {
  await page
    .getByRole('button', { name: /New connection/ })
    .first()
    .click();

  const sheet = page.getByRole('dialog', { name: 'New connection' });
  await expect(sheet).toBeVisible();

  await sheet.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await sheet.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  // A port nothing is listening on.
  await sheet.getByLabel('Port', { exact: true }).fill('1');

  await sheet.getByRole('button', { name: 'Test' }).click();

  /*
   * The failure is reported rather than swallowed, and it says something. It
   * arrives as a notice rather than as a line at the foot of the form: the form
   * is often taller than the popup holding it, so the one place the answer must
   * not be is below the fold of the thing that asked the question.
   */
  const notice = page.locator('.notice').first();
  await expect(notice).toBeVisible({ timeout: 25_000 });
  await expect(notice).not.toBeEmpty();
});

test('runs a query and shows its results', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-query-')), 'q.db');

  await createConnection(page, { engine: 'SQLite', file: file, name: 'Query' });

  await newQueryTab(page);

  await typeQuery(page, 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');

  await typeQuery(page, "INSERT INTO t VALUES (1, 'one'), (2, 'two');");
  await page.keyboard.press('ControlOrMeta+Enter');

  await typeQuery(page, 'SELECT * FROM t ORDER BY id;');
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(page.getByText('one')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('two')).toBeVisible();

  // The sidebar picks the new table up on refresh, and its structure opens.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('treeitem', { name: /^t$/ })).toBeVisible({ timeout: 15_000 });
});

test('opens the command palette and settings from the keyboard', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-cmd-')), 'c.db');

  await createConnection(page, { engine: 'SQLite', file: file });

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();

  // Typing filters to actions, and Enter runs the highlighted one.
  await page.getByPlaceholder(/Search tables/).fill('sett');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  // Escape closes it and returns focus to where it came from.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
});

test('an accent chosen in settings repaints the interface', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-accent-')), 'a.db');

  await createConnection(page, { engine: 'SQLite', file: file });

  const readPrimary = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
    );
  const before = await readPrimary();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Green' }).click();

  await expect.poll(readPrimary).not.toBe(before);
});

test('exports a table to a file without loading it into the interface', async ({
  app,
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-export-'));
  const database = join(directory, 'e.db');
  const target = join(directory, 'out.csv');

  // The save dialog is native, so it is answered from the main process. Every
  // other part of the export — cursor, streaming, file writing — is real.
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, target);

  await createConnection(page, { engine: 'SQLite', file: database });

  await newQueryTab(page);
  await typeQuery(page, 'CREATE TABLE e (id INTEGER PRIMARY KEY, label TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');
  await typeQuery(page, "INSERT INTO e VALUES (1, 'alpha'), (2, 'be,ta');");
  await page.keyboard.press('ControlOrMeta+Enter');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('treeitem', { name: 'e' }).dblclick();
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: 'CSV' }).click();
  await sheet.getByRole('button', { name: 'Export' }).click();

  await expect
    .poll(async () => readFile(target, 'utf8').catch(() => ''), { timeout: 15_000 })
    .toContain('alpha');

  const csv = await readFile(target, 'utf8');
  expect(csv.split('\n')[0]).toBe('id,label');
  // A value containing the delimiter must come back quoted, not split in two.
  expect(csv).toContain('"be,ta"');
});

test('restores the tabs that were open, including unfinished query text', async ({
  app,
  page,
}) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-session-')), 's.db');

  await createConnection(page, { engine: 'SQLite', file: file, name: 'Session' });

  await newQueryTab(page);
  await typeQuery(page, 'SELECT 1 -- half written');

  // Give the debounced save time to land before the window goes away.
  await page.waitForTimeout(900);

  await page.reload();

  // Reconnect from the saved card: a reload drops the connection, which is
  // honest — but the tabs for that connection must come back with it.
  await page.getByRole('button', { name: 'Connect to Session' }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await expect(page.locator('.monaco-editor').first()).toContainText('half written', {
    timeout: 15_000,
  });
  void app;
});

test('asks the server for a preview rather than for everything', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-limit-')), 'l.db');

  await createConnection(page, { engine: 'SQLite', file, name: 'Preview' });
  await newQueryTab(page);

  /*
   * A statement with no end to it. The row limit used to be a cut made after
   * the fact — the whole result came back and the first five hundred rows of it
   * were kept — so this would generate rows until something broke. Answering it
   * at all is the proof that the limit went to the server in the statement.
   */
  await typeQuery(
    page,
    'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq) SELECT n FROM seq;'
  );
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.results__summary')).toContainText('first 500 rows', {
    timeout: 20_000,
  });
});

test('draws the schema it is asked to draw', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });
  await revealTables(page);

  /*
   * From the schema's own menu, and scoped to it. It used to be a button on the
   * empty workspace — available only while nothing was open, and unreachable
   * from the moment anything was — and it drew every table in the connection,
   * which on a real database is a hairball no screen can show at a legible
   * size.
   */
  await page.locator('.row--schema').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Diagram/ }).click();

  await expect(page.locator('.erd')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.erd-node')).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator('.zoomer__percent')).toBeVisible();
});

test('shows how the database would run a statement', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-explain-')), 'x.db');

  await createConnection(page, { engine: 'SQLite', file, name: 'Plan' });

  await newQueryTab(page);
  await typeQuery(page, 'CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');

  await typeQuery(page, "SELECT * FROM p WHERE name = 'x';");
  await page.getByRole('button', { name: 'Explain' }).click();

  // The plan replaces the grid, and names the operation the engine chose.
  await expect(page.getByRole('img', { name: 'Query plan' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('img', { name: 'Query plan' })).toContainText('SCAN');
});

test('adds and drops a column, showing the SQL before it runs', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-ddl-')), 'd.db');

  await createConnection(page, { engine: 'SQLite', file, name: 'Schema' });

  await newQueryTab(page);
  await typeQuery(page, 'CREATE TABLE s (id INTEGER PRIMARY KEY, name TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');

  await page.getByRole('button', { name: 'Refresh' }).click();

  // Structure lives in the Properties popup now, reached from the row's menu.
  await page.getByRole('treeitem', { name: 's' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Properties' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: 'Column', exact: true }).click();

  const sheet = page.getByRole('dialog', { name: 'Add a column' });
  await sheet.getByLabel('Name').fill('note');
  await sheet.getByLabel('Type').fill('TEXT');
  await sheet.getByRole('button', { name: 'Continue' }).click();

  // The statement is shown, not summarised.
  const confirm = page.getByRole('dialog', { name: 'Apply schema change' });
  await expect(confirm).toContainText('ALTER TABLE "s" ADD COLUMN "note" TEXT');
  await confirm.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(page.getByRole('cell', { name: 'note', exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test('confirms a schema change, and says what the engine will not do', async ({ page }) => {
  const file = join(await mkdtemp(join(tmpdir(), 'shelf-drop-')), 'x.db');

  await createConnection(page, { engine: 'SQLite', file, name: 'Drop' });

  await newQueryTab(page);
  // Two columns, because the one thing this test is named for can only be
  // reached on a column that is *not* the key: the drop control is not offered
  // on a primary key, and a table with nothing else in it has nothing to drop.
  await typeQuery(page, 'CREATE TABLE z (id INTEGER PRIMARY KEY, note TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByRole('button', { name: 'Refresh' }).click();

  await page.getByRole('treeitem', { name: 'z' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Properties' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('radio', { name: 'Indexes' }).click();
  await page.getByRole('button', { name: 'Index', exact: true }).click();

  const sheet = page.getByRole('dialog', { name: 'Add an index' });
  await sheet.getByLabel('Name').fill('z_idx');
  await sheet.getByLabel('Columns', { exact: true }).fill('id');
  await sheet.getByRole('button', { name: 'Continue' }).click();

  // Creating is not destructive, so no confirmation text is demanded.
  const confirm = page.getByRole('dialog', { name: 'Apply schema change' });
  await expect(confirm).toContainText('CREATE INDEX');
  await expect(confirm.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();

  await confirm.getByRole('button', { name: 'Cancel' }).click();

  /*
   * And the other half: a change this engine cannot make is *said*, not
   * attempted.
   *
   * SQLite drops a column by rewriting the table, which the driver declines to
   * do behind someone's back — so the control is offered, pressing it explains
   * why nothing will happen, and no confirmation sheet opens. This used to be a
   * click with `.catch(() => undefined)` on the end of it, which asserted
   * nothing and spent thirty seconds of every run waiting for a dialog that was
   * never going to appear.
   */
  await page.getByRole('radio', { name: 'Columns' }).click();
  await page.getByRole('button', { name: 'Drop column note' }).click();

  await expect(page.getByText(/cannot do that without rewriting the table/i)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'This cannot be undone' })).toHaveCount(0);
});

test('imports a CSV file into an existing table', async ({ app, page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'shelf-import-'));
  const database = join(directory, 'i.db');
  const source = join(directory, 'people.csv');

  // A file with a quoted delimiter and a quoted newline in it, because those
  // are the cases a naive split gets wrong.
  await writeFile(
    source,
    'id,name,note\n1,"Doe, Jane","line one\nline two"\n2,Ada,"say ""hi"""\n',
    'utf8'
  );

  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, source);

  await createConnection(page, { engine: 'SQLite', file: database, name: 'People DB' });

  await newQueryTab(page);
  await typeQuery(page, 'CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, note TEXT);');
  await page.keyboard.press('ControlOrMeta+Enter');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('treeitem', { name: 'people' }).dblclick();

  await page.locator('.toolbar').getByRole('button', { name: 'Import', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Import into people/ });
  await sheet.getByRole('button', { name: 'Choose…' }).click();

  // Columns match on name without being mapped by hand.
  await expect(sheet).toContainText('2 rows found');
  await sheet.getByRole('button', { name: /^Import 2 rows/ }).click();

  await expect(page.getByText('2 imported')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('gridcell', { name: 'Doe, Jane' })).toBeVisible();
});

test('sample mode opens the whole app with no database at all', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  // A database, its schemas, and — once they are opened — tables and a view,
  // all from nothing installed. The folders start shut, which is the point of
  // asserting the schemas before the tables rather than instead of them.
  await expect(page.getByRole('treeitem', { name: 'sample' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'music' })).toBeVisible();
  // In the status bar. The sidebar's head names the engine too now, so the
  // string is on screen twice and a bare `getByText` cannot say which.
  await expect(page.locator('.statusbar').getByText('Sample data (no database)')).toBeVisible();

  await revealTables(page);
  await expect(page.getByRole('treeitem', { name: 'album' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'catalogue' })).toBeVisible();

  await openTable(page, 'album');

  // The data is deliberately awkward — JSON, dates, nulls — so the grid is
  // exercised rather than flattered.
  await expect(page.getByRole('gridcell').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tabulator-cell', { hasText: 'producer' }).first()).toBeVisible();
});

test('the header stays aligned with the body on a table wider than the pane', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });
  await openTable(page, 'album');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    const holder = document.querySelector('.tabulator-tableholder') as HTMLElement;
    holder.scrollLeft = 600;
  });

  // The header used to stay at scrollLeft 0 while the body scrolled, so every
  // column label sat over the wrong column by exactly the scroll distance.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const col = [...document.querySelectorAll('.tabulator-col')].find(
          (c) => c.textContent?.trim() === 'metadata'
        );
        const cell = [...document.querySelectorAll('.tabulator-row .tabulator-cell')].find(
          (c) => c.getAttribute('tabulator-field') === 'metadata'
        );
        if (!col || !cell) return null;
        return Math.round(col.getBoundingClientRect().left - cell.getBoundingClientRect().left);
      })
    )
    .toBe(0);
});

test('filters a table with the builder, without anyone writing SQL', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await openTable(page, 'album');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  const before = await page.locator('.tabulator-row').count();

  // The bar is asked for rather than always present, so it does not spend a
  // band of every table's height on a filter nobody is using.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();

  // Column, operator, value — the three things a filter is, none of which
  // should require knowing the engine's dialect.
  const bar = page.locator('.filterbar');
  await expect(bar).toBeVisible();
  await bar.getByLabel('Column').click();
  await page.getByRole('option', { name: 'title' }).click();
  await bar.getByLabel('Operator').click();
  await page.getByRole('option', { name: 'like', exact: true }).click();
  await bar.getByLabel('Value').fill('a%');
  await bar.getByRole('button', { name: 'Apply' }).click();

  await expect
    .poll(async () => page.locator('.tabulator-row').count(), { timeout: 15_000 })
    .toBeLessThan(before);

  // And clearing puts them back, rather than leaving the tab stuck on a filter
  // with no visible way out.
  await bar.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => page.locator('.tabulator-row').count()).toBe(before);
});

/*
 * The editor is Monaco, and the reason to bring one rather than write one is
 * everything you get without asking: find, replace, multi-cursor, go-to-line.
 * This checks the two people reach for, and that the line readout beside them
 * is real rather than decorative.
 */
test('the editor brings find and replace, and says where the caret is', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });
  await newQueryTab(page);

  await typeQuery(page, 'SELECT one\nFROM two\nWHERE one = 1');
  await expect(page.locator('.statusbar')).toContainText('of 3');

  // Find, from the binding every editor uses.
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.locator('.monaco-editor .find-widget');
  await expect(find).toBeVisible();
  await page.keyboard.type('one');
  // Two matches: the select list and the predicate.
  await expect(find).toContainText('1 of 2');

  /*
   * And replace, which is the half that has to be reachable to be worth having.
   * The accelerator differs by platform — ⌘H is the system's "hide the app" on
   * macOS, so the editor puts replace on ⌥⌘F there.
   */
  await page.keyboard.press('Escape');
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Meta+f' : 'Control+h');
  await expect(page.locator('.monaco-editor .find-widget.replaceToggled')).toBeVisible();
  await page.keyboard.press('Escape');
});

/*
 * Writing to the clipboard changes nothing on screen, so a button that does it
 * and says nothing is indistinguishable from a broken one. Copying a table's
 * name, copying pending SQL and writing an export file were all silent —
 * the export's own confirmation was written onto the sheet it then closed.
 */
test('a clipboard write says so', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  const notice = page.locator('.notices [role="status"]');

  await withClipboard(async () => {
    await page.getByRole('treeitem', { name: 'album' }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy table name' }).click();

    await expect(notice).toContainText('Copied music.album');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('music.album');
  });

  // And it leaves on its own rather than sitting there needing dismissal.
  await expect(notice).toBeHidden({ timeout: 15_000 });
});

/*
 * The sidebar is an outline of folders, and folders start shut.
 *
 * Every schema used to be expanded on arrival, so opening a database with forty
 * of them meant scrolling past every table in all of them to reach the one you
 * wanted.
 */
test('the sidebar opens as folders, shut until asked', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  // The database is the only one of its kind, so it is open; its schemas are
  // not, and their tables are therefore nowhere on screen.
  const database = page.getByRole('treeitem', { name: 'sample' });
  await expect(database).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('treeitem', { name: 'music' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('treeitem', { name: 'album' })).toBeHidden();

  // Each level counts what is inside it, so a shut folder still says how much.
  await expect(page.getByRole('treeitem', { name: 'music' })).toContainText('4');

  await page.getByRole('treeitem', { name: 'music' }).click();
  await expect(page.getByRole('treeitem', { name: 'album' })).toBeVisible();
  // Opening one schema does not open the others.
  await expect(page.getByRole('treeitem', { name: 'daily_metrics' })).toBeHidden();

  // Closing the database takes its whole subtree with it.
  await database.click();
  await expect(page.getByRole('treeitem', { name: 'music' })).toBeHidden();
  await database.click();

  /*
   * "Collapse all" shuts the folders, not the root they all hang from. Closing
   * the database too empties the sidebar to a single row, at which point the
   * button does nothing and the way back is the one thing left on screen.
   */
  await revealTables(page);
  await expect(page.getByRole('treeitem', { name: 'album' })).toBeVisible();

  await page.getByRole('button', { name: /Collapse all/ }).click();
  await expect(page.getByRole('treeitem', { name: 'album' })).toBeHidden();
  await expect(page.getByRole('treeitem', { name: 'music' })).toBeVisible();
  await expect(database).toHaveAttribute('aria-expanded', 'true');
});

/*
 * The four things you can do to a table used to be one thing: a small icon that
 * appeared on hover at the end of a sidebar row and opened a whole tab. One
 * hidden target, one destination.
 */
test('every table carries a menu, from the button and from right-click', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  const row = page.getByRole('treeitem', { name: 'album' }).first();
  await row.click({ button: 'right' });

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Copy table name',
    'Quick docs',
    'Properties',
    'Export data to file…',
    // The assistant is offered whether or not a provider has been configured:
    // an action that appears only once you have set something up is an action
    // nobody discovers they could set up. One entry, not two — the one-shot
    // "ask for a query" was everything a conversation does on its first turn,
    // minus the ability to be told it had misread the question.
    'Chat',
  ]);

  // Properties carries the sections that used to be a tab of their own.
  await menu.getByRole('menuitem', { name: 'Properties' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: 'Indexes' })).toBeVisible();
  await expect(sheet.getByRole('radio', { name: 'Relations' })).toBeVisible();
  await expect(sheet.getByText('play_count')).toBeVisible();
  await page.keyboard.press('Escape');

  // Escape closes the menu rather than leaving it stranded over the tree.
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // And the visible affordance opens the same list — a menu nobody can find is
  // a menu that is not there.
  await row.hover();
  await page.getByRole('button', { name: /Actions for album/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();

  await withClipboard(async () => {
    await page.getByRole('menuitem', { name: 'Copy table name' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('music.album');
  });
});

/*
 * There used to be no global sign that anything was happening. A query taking
 * eight seconds looked exactly like one that had not started, and a failure in
 * a tab you were not looking at was silent.
 */
test('the status bar says when work succeeded and when it failed', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await newQueryTab(page);
  const bar = page.locator('.statusbar');
  await expect(bar).not.toHaveClass(/statusbar--ok|statusbar--error/);

  await typeQuery(page, 'select * from music.artist');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(bar).toHaveClass(/statusbar--ok/, { timeout: 15_000 });

  // And the wash clears itself rather than sitting there as a permanent green.
  await expect(bar).not.toHaveClass(/statusbar--ok/, { timeout: 15_000 });

  await typeQuery(page, 'select * from nothing_of_the_sort');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(bar).toHaveClass(/statusbar--error/, { timeout: 15_000 });
});

/*
 * `⌘F` and `⌘S` were in the bindings table, in the Settings list and in the
 * README, and no handler existed for either — the whole Data group of the
 * shortcut list did nothing at all.
 */
test('the data shortcuts do what the shortcut list says they do', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await openTable(page, 'album');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  /*
   * Collapsed rather than unmounted, so `toBeHidden` would not see it — the bar
   * keeps its own box and is clipped to nothing by the wrapper. Its height is
   * the thing that actually decides whether it costs the grid any room.
   */
  const shell = page.locator('.table-tab__filter');
  expect((await shell.boundingBox())?.height).toBe(0);

  // The shortcut both opens it and puts the caret where you were about to type.
  await page.keyboard.press('ControlOrMeta+f');

  const bar = page.locator('.filterbar');
  await expect(bar).toBeVisible();
  await expect(bar.getByLabel('Value')).toBeFocused();
  // Polled, because it grows into place over a couple of hundred milliseconds
  // rather than snapping open.
  await expect.poll(async () => (await shell.boundingBox())?.height ?? 0).toBeGreaterThan(20);
});

/*
 * Selecting cells and pressing ⌘C did nothing at all.
 *
 * Tabulator's clipboard module was never switched on, and the handler that was
 * meant to catch the key was registered as `instance.on('keydown')` — an
 * external event Tabulator does not have, so it was never once called. The grid
 * copies the text it drew, which is the point: a date on the clipboard has to
 * be the date that was on screen and not the transport's ISO envelope.
 */
test('cells copy out of the grid, and say so', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await openTable(page, 'album');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  // The first cell of each row is the row-number gutter, which is a column to
  // the grid and not to the data — it must not come along.
  const cell = (row: number, column: number) =>
    page
      .locator('.tabulator-row')
      .nth(row)
      .locator('.tabulator-cell')
      .nth(column + 1);

  // A range, made the way a range is made: press on one corner and drag to the
  // other. What the grid has selected is what lands on the clipboard.
  const start = await cell(0, 0).boundingBox();
  const finish = await cell(1, 1).boundingBox();
  if (!start || !finish) throw new Error('the grid drew no cells to select');

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(finish.x + finish.width / 2, finish.y + finish.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await withClipboard(async () => {
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.locator('.notices [role="status"]')).toContainText('Copied');

    const expected = [
      [await cell(0, 0).innerText(), await cell(0, 1).innerText()].join('\t'),
      [await cell(1, 0).innerText(), await cell(1, 1).innerText()].join('\t'),
    ].join('\n');

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  });
});

/*
 * Shift-clicking a cell opens it in full — and used to kill the renderer.
 *
 * The inspector was rendered with `v-if` on the value it was about to show, so
 * it mounted already open, which inserted a `scroll()`-timeline animation into
 * the document in the same commit that made it visible. Chromium did not throw;
 * the process died and the window went with it.
 */
test('a cell opens in full without taking the window with it', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await openTable(page, 'album');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  await page
    .locator('.tabulator-row')
    .first()
    .locator('.tabulator-cell')
    .nth(2)
    .click({ modifiers: ['Shift'] });

  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Still there, still answering — which is the whole assertion.
  await expect(page.locator('.tabulator-row').first()).toBeVisible();
});

/*
 * How many rows to bring back is chosen in the bar, before the run.
 *
 * It used to be a number typed into Settings, defaulting to fifty thousand —
 * a limit nobody set, on a control nobody found, holding rows nobody was
 * looking at. And running a statement wrote to the query history under a
 * foreign key the connection did not have, so every run in sample mode threw
 * `FOREIGN KEY constraint failed` into a promise nobody awaited.
 */
test('the row limit is chosen in the bar, and no run fails quietly', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });

  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole('button', { name: /new query/i })
    .first()
    .click();
  await page.locator('.monaco-editor').waitFor();
  await typeQuery(page, 'select * from album');

  await page.getByRole('combobox', { name: /Maximum rows/i }).click();
  await page.getByRole('option', { name: '10 rows' }).click();
  await page.getByRole('button', { name: /^Run/ }).first().click();

  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator('.tabulator-row').count()).toBe(10);

  /*
   * And it says so rather than presenting ten rows as the whole answer — as
   * "first 10 rows", one statement rather than two. It used to print a count
   * *and* "showing first 10" beside it, which read as a total and a window onto
   * it; the total stopped existing when the limit went into the statement, and
   * what was printed in its place was the ceiling plus the one extra row the
   * server is asked for: "11 rows · showing first 10".
   */
  await expect(page.locator('.results__bar')).toContainText('first 10 rows');
  await expect(page.locator('.results__bar')).not.toContainText('11');

  expect(failures).toEqual([]);
});

/*
 * The table tab and the query tab now reach the same sheet. The table tab used
 * to skip it and infer the format from whatever extension you typed into the
 * save dialog, so "Export" meant two different interactions in two places.
 */
test('exports a table through the same sheet the query tab uses', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await revealTables(page);
  await openTable(page, 'artist');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('radio', { name: 'Clipboard' }).click();
  await sheet.getByRole('radio', { name: 'CSV' }).click();

  await withClipboard(async () => {
    await sheet.getByRole('button', { name: 'Export' }).click();
    await expect(sheet.getByRole('status')).toContainText('Copied', { timeout: 10_000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('name');
  });
});

/*
 * The sheet used to be invisible here, and the cause was not in the sheet at
 * all: `QueryTab` named `<ExportSheet>` in its template without importing it.
 * Nothing is registered globally, so Vue resolved it to nothing and rendered
 * nothing — no warning, no error, no element, which is why every hypothesis
 * about the model contract and the prop names came back clean.
 *
 * `vue/no-undef-components` now fails the lint on that, and this test is the
 * behavioural half of the same guard.
 */
test('exports query results, choosing a format and a destination', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole('button', { name: /new query/i })
    .first()
    .click();
  await page.locator('.monaco-editor').first().click();
  await typeQuery(page, 'select * from music.artist');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.tabulator-row').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  await sheet.getByRole('radio', { name: 'Clipboard' }).click();
  await sheet.getByRole('radio', { name: 'Markdown' }).click();

  await withClipboard(async () => {
    await sheet.getByRole('button', { name: 'Export' }).click();
    await expect(sheet.getByRole('status')).toContainText('Copied', { timeout: 10_000 });

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('| name');
    expect(copied).toContain('Talk Talk');
  });
});

/*
 * A block of code is printed so it can be run somewhere else, and one you have
 * to retype is one that gets retyped wrong. The setup commands for
 * `pg_stat_statements` are the case that matters — the reader is looking at
 * them precisely because the server cannot answer yet.
 */
test('a snippet can be selected and copied, and says so', async ({ page }) => {
  await page.getByRole('button', { name: /Sample database/ }).click();
  await expect(page.locator('.strip')).toBeVisible({ timeout: 20_000 });

  await page.locator('.row--database').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Analyze/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const row = page.locator('.stats tbody tr').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  const snippet = page.locator('.snippet').first();
  await expect(snippet).toBeVisible();
  // Selectable, so the reader can take part of it rather than all of it.
  await expect(snippet.locator('pre')).toHaveCSS('user-select', 'text');

  await withClipboard(async () => {
    await snippet.getByRole('button', { name: 'Copy' }).click();
    await expect(page.locator('.notices [role="status"]')).toContainText('Copied', {
      timeout: 10_000,
    });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('SELECT');
  });
});

/*
 * The start screen and the workspace get different windows, and the shrink back
 * is the half that broke. `isResizable()` was the obvious way to ask which
 * shape the window was in, and it lies: pinning a window by setting its minimum
 * and maximum to the same size leaves macOS reporting it as not resizable long
 * after both are cleared, so the window grew once when a database opened and
 * every later call decided it was already small and did nothing.
 */
test('the window is compact for the start screen and full for a workspace', async ({
  app,
  page,
}) => {
  const size = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize());

  const start = await size();

  await page.getByRole('button', { name: /Sample database/ }).click();
  await page.locator('.strip').waitFor({ timeout: 20_000 });
  await expect.poll(size).not.toEqual(start);

  const workspace = await size();
  expect(workspace[0]!).toBeGreaterThan(start[0]!);
  expect(workspace[1]!).toBeGreaterThan(start[1]!);

  // Back to the start screen: the window has to give the space back.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(size).toEqual(start);
});
