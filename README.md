# Shelf

A database client with an interface worth looking at.

Shelf connects to nine database engines, shows you your data in a
spreadsheet-grade grid, and lets you edit it. Every feature is available to
everyone — there is no paid tier, no licence key, no account, and no telemetry.

**macOS · Windows · Linux · MIT licensed**

---

## Why

Desktop database clients tend to be either fast and ugly or pretty and slow, and
the ones that get close to both put their best features behind a licence. Shelf
is the version where the interface is actually designed, the information density
is high enough for real work, and nothing is withheld.

## Engines

All seven server engines are verified against real databases by the conformance
suite; SQLite and DuckDB are covered end to end.

| Engine | Query language | Notes |
| --- | --- | --- |
| PostgreSQL | SQL | Pooled, cursor streaming, server-side cancel, SSL, SSH tunnel |
| MySQL | SQL | Pooled, `KILL QUERY` cancel, timezone-safe dates, big-number-safe |
| TiDB | SQL | MySQL wire protocol, same driver |
| SQLite | SQL | File or in-memory, WAL |
| DuckDB | SQL | File or in-memory, cheap counts |
| MongoDB | `db.coll.find(…)` | Collections as entities, schema inferred by sampling |
| Redis | Redis commands | Keyspace browser with type, TTL, size and encoding |
| ScyllaDB | CQL | Keyspaces, token paging, batched writes |
| DynamoDB | PartiQL | Regions, key-aware editing, exclusive-start-key paging |

Every engine goes through one `DatabaseClient` interface and declares what it can
do through a capability descriptor, so the interface adapts honestly instead of
showing controls that do nothing — DynamoDB has no column sort because it has no
column sort, and Redis has no transactions because it has none. **No capability
is ever tied to a licence, because there is no licence.**

## What it does

- **Browse** — a virtualised schema tree that stays fast at tens of thousands of
  tables, with columns and types inline.
- **Read** — a spreadsheet-grade grid with range selection, paged reads, raw
  filtering, and a full-value inspector for anything wider than a cell.
- **Write** — inline editing that accumulates in a pending-changes ledger,
  previews as SQL, and applies in one transaction. A locked cell always says
  *why* it is locked.
- **Query** — CodeMirror 6 with schema-aware completion, the statement under the
  cursor highlighted, run-all or run-current, cancellation that reaches the
  server, multiple result sets, and manual transactions.
- **Inspect** — columns with their descriptions, indexes, relations, triggers and
  partitions, each shown
  only where the engine has them.
- **Analyze** — for engines that keep statement statistics, the slowest queries
  over the last hour, six hours, day, week, month or all time, with calls, total
  and mean time and each statement's share of the window; plus cache hit ratio,
  transaction rate, connections by state, the largest tables with their dead-row
  bloat, and indexes the planner has never chosen. No engine keeps a history, so
  the app records its own readings and differences them, and says so when a
  window is wider than the history behind it.
- **Diagram** — a D3 force-directed ERD with draggable, position-remembering
  nodes and relationship highlighting.
- **Change the shape** — add, rename and drop columns and indexes, with the
  generated statement shown before it runs and destructive changes requiring the
  object's name to be typed.
- **Explain** — a D3 plan tree where node width and tint follow cost, so the
  expensive step is the one that stands out.
- **Move data** — import CSV, TSV, JSON or JSON Lines with columns matched by
  name; export CSV, JSON, JSONL or SQL, streamed from the connection host
  straight to disk so the size of the table does not matter.
- **Keep** — saved queries and full history, per connection, with failures
  recorded too.
- **Find** — a command palette (`⌘K`) over tabs, tables and actions, with
  subsequence matching, and a start screen that parses a pasted connection URL
  into a filled-in form.
- **Resume** — tabs and unfinished query text come back when you reopen a
  connection.

## Design

- **One accent colour drives everything.** Pick a colour and the whole palette is
  derived from it in OKLCH — including a faint tint carried through the neutral
  surfaces, which is what makes a new accent feel like a new theme rather than a
  repainted button. Any accent is guaranteed readable: the derivation walks the
  lightness until it clears 3:1 against the page and can carry 4.5:1 text.
- **The window is the material.** Real vibrancy on macOS and acrylic on Windows,
  with the three columns tinted to different depths over it and one dial that
  thins them together without closing the distance between them. What appears
  *in front* of the window — menus, sheets — is opaque, because glass on glass
  is unreadable and an in-page blur cannot reach the desktop anyway.
- **Three density modes** driven by a single factor, so nothing drifts out of
  proportion.
- **Springs, not keyframes.** Anything you can grab tracks the pointer one to
  one, resists at its limits, and carries your release velocity into the
  animation that follows.
- `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast` are all honoured.

## Getting started

```bash
make install    # check tooling, install packages, rebuild native modules
make dev        # run with hot reload
```

Requires **Node 20+** and **pnpm**. `make install` will install pnpm through
corepack if it is missing.

### The window is a material

On macOS the desktop shows through the window and is blurred by the compositor;
on Windows the same is done with acrylic. The three vertical panels are three
distinct surfaces — the icon rail sits furthest back, the sidebar in front of
it, and the content pane is the only opaque one, because a grid of ten thousand
cells over a moving wallpaper is unreadable and blurring that area every frame
is the most expensive thing the window could ask for.

Where the compositor offers nothing — most Linux setups — or where the user has
asked for less transparency, the whole thing falls back to real opaque surfaces
rather than a blur that does not blur.

### Languages

English, 日本語, 简体中文, 한국어 and Tiếng Việt, following the system locale by
default or set explicitly in Settings. Engine-specific words — *collection*,
*keyspace*, *item* — are translated too, so a Japanese sentence does not end up
with an English noun dropped into the middle of it.

### Try it without a database

The start screen offers **sample data**: a synthetic database with schemas,
views, foreign keys, JSON, binary, big integers and nulls. Everything works
against it — browsing, editing, queries, the diagram — and nothing is installed
or saved. It also backs the screenshots and part of the test suite.

### Testing against real databases

```bash
make db-up          # Postgres, MySQL, TiDB, Redis, ScyllaDB, MongoDB, DynamoDB
make test-drivers   # one conformance suite, run against every one of them
make db-down
```

The suite asserts that all seven present the same interface: connect, list,
read, page, stream, write, read back, and refuse what they genuinely cannot do.
Where an engine lacks a feature it must say so through `capabilities` — the
absence is asserted, not skipped.

### Commands

| Command | What it does |
| --- | --- |
| `make dev` | Run the app with hot reload |
| `make db-up` | Start the test databases |
| `make test-drivers` | Conformance suite against every engine |
| `make build` | Type-check and build all processes |
| `make package` | Build a distributable for the host platform |
| `make test` | Unit tests |
| `make test-e2e` | End-to-end tests against the built app |
| `make format` | Format and lint-fix |
| `make clean` | Remove build artifacts |
| `make uninstall` | Remove dependencies and artifacts |
| `pnpm shots` | Screenshot the interface for design review |

## Architecture

```
main ──ipc:requestPort──> MessageChannel ─┬─> connection host (utilityProcess)
  │                                        └─> renderer
  └── better-sqlite3 app.db  +  OS keyring
```

Three processes, and the split matters:

- **The renderer never touches a driver.** Every connection runs in a separate
  `utilityProcess`, so a slow query, a native-module crash or a two-million-row
  result set cannot freeze the window. If the host dies, it is restarted.
- **Traffic bypasses the main process.** The renderer and the host share a
  `MessageChannel`, so database work never queues behind window, menu or dialog
  handling.
- **Secrets never enter the renderer.** Passwords live in the OS keyring
  (Keychain, DPAPI, libsecret) and travel from main to the connection host
  directly. The renderer only ever holds a single-use handle.

```
src/
  shared/     types and channels that cross process boundaries
  main/       window, app database, keyring, IPC, host supervision
  utility/    the connection host: sessions, handler registry, RPC loop
  drivers/    the DatabaseClient interface and one module per engine
  preload/    the single typed bridge exposed to the page
  renderer/   Vue 3 application
```

## Keyboard

| | |
| --- | --- |
| `⌘↩` / `Ctrl+↩` | Run |
| `⌘W` | Close tab |
| `⇧⌘T` | Reopen last closed tab |
| `⌃⇥` | Next tab |
| `⌘F` | Filter |
| `F5` | Refresh |

## Not built yet

What exists is complete and tested. What is missing is missing rather than
half-present:

- **A create-table builder.** Columns and indexes can be added, altered and
  dropped from the structure tab, but a new table still needs `CREATE TABLE` in
  the query editor.
- **Engine-native backup and restore.**
- **Structure-footer sparklines.** The ERD and the EXPLAIN plan tree are built;
  this third D3 view is not.
- **A shortcut editor.** Keybindings are already data and are listed in
  Settings, but cannot be changed from the interface.
- **Backup and restore of a whole database.** Import and export of a table are
  built; a full dump is not.

## Contributing

Run `make format` before committing. `make build`, `make test` and
`make test-e2e` should all pass.

## Licence

MIT — see [LICENSE](LICENSE).
