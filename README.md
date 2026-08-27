<p align="center">
  <img src="build/icon.png" alt="Shelf" width="112" />
</p>

<h1 align="center">Shelf</h1>

<p align="center">
  <strong>A database client with an interface worth looking at.</strong>
</p>

<p align="center">
  Nine engines. Every feature. No account.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-4C6EF5" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/licence-MIT-3BA55D" alt="MIT licence" />
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-2F3136" alt="Platforms" />
  <img src="https://img.shields.io/badge/Electron%2043-47848F?logo=electron&logoColor=white" alt="Electron 43" />
  <img src="https://img.shields.io/badge/Vue%203-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <img src="docs/workspace.png" alt="Shelf showing a table in the sample database" width="900" />
</p>

---

Shelf connects to nine database engines, shows your data in a spreadsheet-grade
grid, and lets you edit it. Every feature is available to everyone — no paid
tier, no licence key, no account, and no telemetry.

Desktop database clients tend to be either fast and ugly or pretty and slow, and
the ones that get close to both put their best features behind a licence. Shelf
is the version where the interface is actually designed, the information density
is high enough for real work, and nothing is withheld.

---

## Install

Download the latest build from [Releases](../../releases/latest).

| Platform | File | Notes |
| --- | --- | --- |
| macOS (Apple Silicon) | `.dmg` or `.zip` | Unsigned — see [Troubleshooting](#troubleshooting) |
| Windows | `Shelf Setup *.exe`, or the portable `.exe` | x64 |
| Linux | `.deb`, `.rpm` or `.AppImage` | x64; the packages install a desktop entry, the AppImage runs as it is |

Nothing asks for an account, and nothing phones home.

---

## Engines

Every engine goes through one `DatabaseClient` interface and declares what it can
do through a capability descriptor, so the interface adapts honestly instead of
showing controls that do nothing — DynamoDB has no column sort because it has no
column sort, and Redis has no transactions because it has none. **No capability
is ever tied to a licence, because there is no licence.**

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

The seven server engines are verified against real databases by the conformance
suite; SQLite and DuckDB are covered end to end.

---

## What it does

- **Browse** — a virtualised schema tree that stays fast at tens of thousands of
  tables, with columns and types inline.
- **Read** — a spreadsheet-grade grid with range selection, paged reads, raw
  filtering, and a full-value inspector for anything wider than a cell.
- **Write** — inline editing that accumulates in a pending-changes ledger,
  previews as SQL, and applies in one transaction. A locked cell always says
  *why* it is locked.
- **Query** — a Monaco editor with schema-aware completion, the statement under
  the cursor highlighted, run-all or run-current, cancellation that reaches the
  server, multiple result sets, and manual transactions.
- **Dispatch** — send a statement off to run on its own: it releases the tab at
  once, keeps its whole answer in a spool on this machine, and says so when it is
  done. The hundred most recent are kept, searchable by name and narrowable by
  status, when they started, when they finished and how long they took.
- **Inspect** — columns with their descriptions, indexes, relations, triggers and
  partitions, each shown only where the engine has them.
- **Analyze** — for engines that keep statement statistics, the slowest queries
  over the last hour, six hours, day, week, month or all time, with calls, total
  and mean time and each statement's share of the window; plus cache hit ratio,
  transaction rate, connections by state, the largest tables with their dead-row
  bloat, and indexes the planner has never chosen. No engine keeps a history, so
  the app records its own readings and differences them, and says so when a
  window is wider than the history behind it.
- **Ask** — describe what you want in plain language and get the SQL. Right-click
  a table, a schema or a database and chat scoped to it: it reads your schema,
  runs read-only queries to check its own answer, and draws the rows it got back.
  Each query says whether it was working or the answer, so the counting it did on
  the way folds out of your reading and the table you asked for does not. Any
  statement can be lifted into a query tab, under the name the assistant gave it.
  **It never writes.** Anything that would change data or shape comes back as a
  statement for you to run yourself.
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
- **Keep** — saved queries, full history and saved conversations, per connection,
  with failures recorded too.
- **Find** — a command palette (`⌘K`) over tabs, tables and actions, with
  subsequence matching, and a start screen that parses a pasted connection URL
  into a filled-in form.
- **Rebind** — every shortcut is changed by performing the chord, or edited as
  the JSON document it is stored as. Only what differs from the defaults is kept,
  so a keymap written in an old version does not pin every other shortcut to it.
- **Carry settings and connections between machines** — settings are editable as
  a form or as the JSON document they are stored as, and both they and any saved
  connection can be written to a file and read back. A connection document is a
  preset: it never carries the password, which stays in the OS keyring.
- **Resume** — tabs and unfinished query text come back when you reopen a
  connection.

### The assistant's providers

Claude Code and Codex are **found, not configured**: if either is installed and
signed in on this machine it appears in the picker with nothing to fill in, and
it is looked for again on every launch. Anthropic, OpenAI and Gemini take an API
key, as does anything speaking the OpenAI protocol — including Ollama or LM
Studio on your own machine.

Keys go from the OS keyring to the connection host directly. The renderer only
ever holds a single-use handle.

---

## Design

<p align="center">
  <img src="docs/start-dark.png" alt="The start screen in the dark theme" width="900" />
</p>

- **One accent colour drives everything.** Pick a colour and the whole palette is
  derived from it in OKLCH — including a faint tint carried through the neutral
  surfaces, which is what makes a new accent feel like a new theme rather than a
  repainted button. Any accent is guaranteed readable: the derivation walks the
  lightness until it clears 3:1 against the page and can carry 4.5:1 text.
- **The window is the material.** Real vibrancy on macOS and acrylic on Windows.
  The three vertical panels are three distinct surfaces — the icon rail furthest
  back, the sidebar in front of it, and the content pane the only opaque one,
  because a grid of ten thousand cells over a moving wallpaper is unreadable.
  What appears *in front* of the window — menus, sheets — is opaque too, because
  glass on glass is unreadable and an in-page blur cannot reach the desktop
  anyway. One dial thins the panels together without closing the distance between
  them.
- **Three density modes** driven by a single factor, so nothing drifts out of
  proportion.
- **Springs, not keyframes.** Anything you can grab tracks the pointer one to
  one, resists at its limits, and carries your release velocity into the
  animation that follows.
- **Five languages** — English, 日本語, 简体中文, 한국어 and Tiếng Việt, following
  the system locale or set explicitly. Engine-specific words — *collection*,
  *keyspace*, *item* — are translated too, so a Japanese sentence does not end up
  with an English noun dropped into the middle of it.
- `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`
  are all honoured. Where the compositor offers nothing — most Linux setups — the
  whole thing falls back to opaque surfaces rather than a blur that does not blur.

### Try it without a database

The start screen offers **sample data**: a synthetic database with schemas,
views, foreign keys, JSON, binary, big integers and nulls. Everything works
against it — browsing, editing, queries, the diagram — and nothing is installed
or saved. It also backs the screenshots above and part of the test suite.

---

## Keyboard

| Chord | Action |
| --- | --- |
| `⌘K` / `⌘P` | Command palette |
| `⌘↩` | Run |
| `⇧⌘↩` | Run current statement |
| `⌘T` | New query tab |
| `⇧⌘A` | New assistant chat |
| `⌘W` | Close tab |
| `⇧⌘T` | Reopen last closed tab |
| `⌃⇥` / `⌃⇧⇥` | Next / previous tab |
| `⌘B` | Toggle sidebar |
| `⌘F` | Focus filter |
| `⌘S` | Apply pending changes |
| `⌘,` | Settings |
| `F5` | Refresh schema |

Use `Ctrl` for `⌘` off macOS. Every one of these can be rebound in Settings.

---

## Build from source

```bash
make install    # check tooling, install packages, rebuild native modules
make dev        # run with hot reload
make preview    # run the built app, with no dev server
```

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node | 20 or newer | For the build; the app ships with Electron's own |
| pnpm | 11.22 | `make install` fetches it through corepack if it is missing |
| C toolchain | any | `better-sqlite3` compiles against Electron's ABI — Xcode CLT on macOS, `build-essential` on Linux |
| Docker | optional | Only for `make db-up`, the conformance suite's databases |

### Commands

| Command | What it does |
| --- | --- |
| `make` | The gate — lint, unit, build, UI, e2e. About forty seconds |
| `make gate-full` | The gate plus the storybook sweep |
| `make dev` | Run the app with hot reload |
| `make build` | Type-check and build all three processes |
| `make test` | Unit tests |
| `make test-e2e` | End-to-end tests against the built app |
| `make ui` | The design gate — visual, accessibility, invariants |
| `make ui-accept` | Regenerate the visual snapshots — read the diff first |
| `make db-up` / `make db-down` | Start and stop the test databases |
| `make test-drivers` | Conformance suite against every engine |
| `make test-assistant` | Ask a real model end to end (needs Claude Code signed in) |
| `make storybook` | Browse every component in isolation |
| `make storybook-check` | Open every story and fail on any that throws |
| `make package` | Build a distributable for the host platform |
| `make publish` | Gate, bump, push and tag a release |
| `make format` | Format and lint-fix |
| `make clean` / `make uninstall` | Remove artifacts / remove everything |
| `pnpm shots` | Screenshot the interface for design review |

`make` is the gate, and it is what CI runs. Run it before considering a change
finished.

### Testing against real databases

```bash
make db-up          # Postgres, MySQL, TiDB, Redis, ScyllaDB, MongoDB, DynamoDB
make test-drivers   # one conformance suite, run against every one of them
make db-down
```

The suite asserts that all seven present the same interface: connect, list, read,
page, stream, write, read back, and refuse what they genuinely cannot do. Where
an engine lacks a feature it must say so through `capabilities` — the absence is
asserted, not skipped.

### Storybook

Every component has a story beside it. It is worth having for the states the app
makes hard to reach on demand: a grid with two thousand rows, a schema tree with
five thousand tables, a conversation that refused to run a `DELETE`, a card whose
name is long enough to wrap. `window.shelf` and the connection host are replaced
with in-memory fakes that remember what is written to them, so a control that
changes something is a story where the interface answers. `make storybook-check`
opens all of them and fails on any that throws or renders nothing.

### Releases

```bash
echo 1.2.0 > VERSION
make publish
```

It asks which version, runs the gate, brings `package.json` to whatever `VERSION`
says, commits, pushes `main`, and tags. Pushing the tag is what publishes: a
workflow builds on three runners and attaches the packages to the release. Each
is built on the architecture it runs on, because the native modules are compiled
against the machine that builds them.

The release page is drafted before the packages exist and goes live once they are
attached, so nobody arrives during the build and finds a release with nothing to
download.

| Variable | What it does |
| --- | --- |
| `V=1.2.0` | The version, instead of being asked for it |
| `NOTES=notes.json` | `{"title": "…", "body": "…"}` for the release page |
| `YES=1` | Skip the confirmation — for an agent, not for a person |

---

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
  ai/         the assistant: agent loop, provider adapters, schema documents
  preload/    the single typed bridge exposed to the page
  renderer/   Vue 3 application
```

---

## Not built yet

What exists is complete and tested. What is missing is missing rather than
half-present:

- **A create-table builder.** Columns and indexes can be added, altered and
  dropped from the structure tab, but a new table still needs `CREATE TABLE` in
  the query editor.
- **Backup and restore of a whole database.** Import and export of a table are
  built; an engine-native dump is not.
- **Structure-footer sparklines.** The ERD and the EXPLAIN plan tree are built;
  this third D3 view is not.
- **Signed macOS and Windows builds.** The packaging reads the certificates when
  they are there; none are configured yet.

---

## Troubleshooting

<details>
<summary><strong>macOS says the app is damaged, or from an unidentified developer</strong></summary>

The 1.0.0 builds are unsigned and not notarised, so Gatekeeper refuses them on
first open. Right-click the app and choose **Open**, then **Open** again in the
dialog. If macOS still refuses, clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Shelf.app
```

</details>

<details>
<summary><strong>There is no Intel Mac build</strong></summary>

Native modules are compiled against the machine that builds them, and the
packaging workflow has no Intel runner — a cross-built app would carry a database
driver for the wrong architecture and fail at the first query. Build from source
on an Intel Mac with `make package`.

</details>

<details>
<summary><strong>A query fails at once with a native module error</strong></summary>

`better-sqlite3` is compiled against Electron's ABI, and a plain `pnpm install`
leaves it built for Node. Run `make install`, which rebuilds it.

</details>

<details>
<summary><strong>The window is opaque, with no blur</strong></summary>

That is the fallback, not a fault. Where the compositor offers no vibrancy — most
Linux setups — or where the system asks for reduced transparency, the panels
paint real opaque surfaces rather than a blur that does not blur.

</details>

<details>
<summary><strong><code>make package</code> fails building Linux packages</strong></summary>

The `.rpm` needs `rpmbuild` and the AppImage needs `bsdtar`:

```bash
sudo apt-get install rpm libarchive-tools     # Debian and Ubuntu
brew install rpm dpkg                         # building Linux packages on macOS
```

</details>

---

## Contributing

Work on `main`. Run `make format`, then `make` — lint, unit tests, the build, the
design gate and end to end, in about forty seconds. Everything it checks is
something that has broken before.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`. The subject line is deliberately dull; the body carries
what was wrong, what was tried, and why the chosen fix is the one that holds.

---

## Licence

MIT — see [LICENSE](LICENSE).
