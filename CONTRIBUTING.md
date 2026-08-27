# Contributing

Shelf is Electron + Vue 3 + TypeScript. Work on `main`.

```bash
make install    # check tooling, install packages, rebuild native modules
make dev        # run with hot reload
make            # the gate — run this before considering a change finished
```

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node | 20 or newer | For the build; the app ships with Electron's own |
| pnpm | 11.22 | `make install` fetches it through corepack if it is missing |
| C toolchain | any | `better-sqlite3` compiles against Electron's ABI — Xcode CLT on macOS, `build-essential` on Linux |
| Docker | optional | Only for `make db-up`, the conformance suite's databases |

## The gate

`make` runs lint, unit tests, the build, the design gate and end to end, in
about forty seconds. It is what CI runs, and everything it checks is something
that has broken before.

| Command | What it does |
| --- | --- |
| `make` | The gate |
| `make gate-full` | The gate plus the storybook sweep |
| `make dev` | Run the app with hot reload |
| `make preview` | Run the built app, with no dev server |
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

`CLAUDE.md` carries the rules behind these — why the renderer never imports a
driver, why values crossing the boundary are tagged, and the design invariants
the UI gate enforces.

## Testing against real databases

```bash
make db-up          # Postgres, MySQL, TiDB, Redis, ScyllaDB, MongoDB, DynamoDB
make test-drivers   # one conformance suite, run against every one of them
make db-down
```

The suite asserts that all seven present the same interface: connect, list,
read, page, stream, write, read back, and refuse what they genuinely cannot do.
Where an engine lacks a feature it must say so through `capabilities` — the
absence is asserted, not skipped.

## Storybook

Every component has a story beside it. It is worth having for the states the app
makes hard to reach on demand: a grid with two thousand rows, a schema tree with
five thousand tables, a conversation that refused to run a `DELETE`, a card
whose name is long enough to wrap. `window.shelf` and the connection host are
replaced with in-memory fakes that remember what is written to them, so a
control that changes something is a story where the interface answers.
`make storybook-check` opens all of them and fails on any that throws or renders
nothing.

## Releases

```bash
echo 1.2.0 > VERSION
make publish
```

It asks which version, runs the gate, brings `package.json` to whatever
`VERSION` says, commits, pushes `main`, and tags. Pushing the tag is what
publishes: a workflow builds on three runners and attaches the packages to the
release. Each is built on the architecture it runs on, because the native
modules are compiled against the machine that builds them.

The release page is drafted before the packages exist and goes live once they
are attached, so nobody arrives during the build and finds a release with
nothing to download.

| Variable | What it does |
| --- | --- |
| `V=1.2.0` | The version, instead of being asked for it |
| `NOTES=notes.json` | `{"title": "…", "body": "…"}` for the release page |
| `YES=1` | Skip the confirmation — for an agent, not for a person |

## Commits

Conventional Commits: `type(scope): summary`, where the type is one of `feat`,
`fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `style` or `chore`.

The subject line is the machine-readable half and it is deliberately dull.
Everything a commit message is actually for goes in the body: what was wrong,
what was tried, and why the chosen fix is the one that holds. One idea per
commit — if the body needs the word "also", it is two commits.

## Troubleshooting the build

<details>
<summary><strong>A query fails at once with a native module error</strong></summary>

`better-sqlite3` is compiled against Electron's ABI, and a plain `pnpm install`
leaves it built for Node. Run `make install`, which rebuilds it.

</details>

<details>
<summary><strong><code>make package</code> fails building Linux packages</strong></summary>

The `.rpm` needs `rpmbuild` and the AppImage needs `bsdtar`:

```bash
sudo apt-get install rpm libarchive-tools     # Debian and Ubuntu
brew install rpm dpkg                         # building Linux packages on macOS
```

</details>
