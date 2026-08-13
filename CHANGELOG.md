# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Three-process Electron architecture: the renderer talks to a dedicated
  connection host over a `MessageChannel`, so database work cannot block the
  interface and a driver crash costs one process restart.
- `DatabaseClient` interface with a capability descriptor, so nine very
  different engines share one interface without pretending to be alike.
- All nine drivers: PostgreSQL, MySQL, TiDB, SQLite, DuckDB, MongoDB, Redis,
  ScyllaDB and DynamoDB — each with cancellation that reaches the server where
  the engine allows it, chunked streaming, and single-transaction (or batched)
  change application.
- Query tab: CodeMirror 6 with schema-aware completion, the statement under the
  cursor highlighted, run-all / run-current, real cancellation, multiple result
  sets, SQL formatting and manual transactions.
- Structure tab: columns, indexes, relations, triggers and partitions, each
  rendered only where the engine's capabilities allow.
- Schema diagram: a D3 force-directed ERD with draggable nodes that keep their
  positions, relationship highlighting, and zoom.
- Command palette (`⌘K`) with subsequence matching over tabs, tables and
  actions; settings sheet with live accent, density and data preferences; a
  keyboard shortcut reference generated from the binding data.
- Export to CSV, JSON, JSONL or SQL, streamed from the connection host straight
  to disk with backpressure honoured.
- Full-value inspector for cells wider or taller than a row.
- Session persistence: open tabs and unfinished query text return per
  connection.
- Start screen rebuilt around a single hero field that parses a pasted
  connection URL — scheme, host, port, credentials, database and SSL — into a
  filled-in form; saved connections are cards carrying their engine mark and
  label colour.
- Schema editing: add, rename and drop columns and indexes, with the generated
  statement shown before it runs and destructive changes gated behind typing the
  object's name.
- Import from CSV, TSV, JSON and JSON Lines, with columns matched by name and a
  hand-written delimited parser that handles quoted delimiters, quoted newlines
  and doubled quotes.
- EXPLAIN plan visualisation as a D3 tree, with node width and tint following
  cost.
- Saved queries and query history, per connection, recorded on failure as well
  as success.
- Interface polish pass: drawn icon set, custom checkbox and disclosure controls
  replacing the native ones, stronger easing curves, depth on inputs and
  buttons, staggered list entrances, a travelling rail marker, and the
  connection's identity moved into the title bar.

- Sample mode: a synthetic database with schemas, views, relations, JSON,
  binary, big integers and nulls, so the whole app can be explored and designed
  against with nothing installed.
- A driver conformance suite that runs one set of assertions against all seven
  server engines in `docker-compose.yml`, covering connect, list, read, page,
  stream, write-and-read-back, and the refusals each engine declares.

- Five languages: English, Japanese, Simplified Chinese, Korean and Vietnamese,
  following the system locale or set explicitly. Engine nouns are translated as
  well as interface strings. Three tests hold the locales to the English key
  set, forbid empty strings, and check every interpolation placeholder survives.
- Settings is reachable before connecting, from a gear on the start screen.
- The window has no title bar. The connection sits at the top of the sidebar,
  above the schema it belongs to.
- The table tab gained a real toolbar: an explicit **Edit data** mode, Save /
  Discard / Copy SQL with a pending count, and Refresh / Import / Export.

- **A UI quality gate** (`make ui`): 28 checks over the built app, in three
  layers. Design invariants name the specific defects that have shipped —
  header/body misalignment, content clipped by the window's rounded corners,
  dividers crossing the window controls, unstyled native controls, `ease-in` on
  a UI transition, text below its contrast threshold. An axe-core audit covers
  each screen in both themes. Screenshots are the backstop for what those cannot
  name. Every invariant was verified to fail when its defect is reintroduced.

- **A filter builder on every table.** Column, operator, value, joined by
  and/or, with a raw-SQL mode beside it for what the builder cannot express.
  The driver contract already carried structured filters; only the interface
  was raw-only.
- **The sidebar collapses by animating its width**, so the workspace slides
  rather than jumping, and the divider has a grabber that appears under the
  pointer and takes the accent while held. The panel is `inert` while
  collapsed — a zero-width column is otherwise still in the tab order.
- **Control surfaces are derived, not hand-picked.** Fills come from one
  neutral grey at Apple's four levels with per-theme alphas, elevation is spent
  only on things that genuinely float, and the accent has a second, lighter
  form for use as *type*.

### Fixed

- **Every target now clears the 28px desktop minimum.** Text fields, the
  segmented control, the sheet close button, the accent swatches and the tab
  strip's new-tab button were all under it; the entity row's action button was
  20×12 and the "collapse all" button 63×14. The floor is enforced by the gate.
- **A shade boundary ran under the window controls**, cutting each traffic light
  in half — one side on the rail, the other on the sidebar.
- **The sidebar used two different numbers for the same clearance** — the
  connection row hardcoded 2.25rem where the rail used `--rail-top` at 2.5rem —
  so the connection never lined up with the first rail icon. The head and counts
  rows now share the tree's rhythm instead of being three unrelated strips.
- **Three checkboxes were the raw native control** — in query history, the query
  toolbar and settings — beside a `CheckBox` component built precisely because
  the native one ignores the accent. The history pane's remaining English
  strings are translated too.
- **One visual language across the chrome.** Tabs were the only square,
  underlined thing in a window that is otherwise rounded and tonal — they are
  raised surfaces on a recessed track now, the same relationship the segmented
  control has between its track and thumb. The three tab toolbars each had their
  own heights, paddings and mixture of filled, tonal and bare controls; there is
  one definition now.
- **Modal presentation follows the material rule**: the scrim dims without
  blurring, and the surface on it carries a large blur. Blurring both flattens
  the backdrop the glass is supposed to refract.
- **A disabled primary button loses its fill rather than fading.** A filled
  accent at 40% opacity is pale colour carrying pale white text, which reads as
  a rendering fault rather than as "not yet".
- **A grey pill was painted across the whole status bar.** `.status` is a
  daisyUI component name, and our per-tab status group had taken it — so
  daisyUI drew its own surface behind the row count and the pager. Same cause
  as the select below; the gate now checks the framework's whole component
  list rather than the handful that had bitten so far. `.tab` was taken too.
- **Every dark-mode check in the UI gate had been running in light mode.** The
  test helper wrote `shelf.settings.appearance` where the store reads
  `shelf.appearance.mode`, so the switch silently did nothing and the checks
  passed for that reason. It asserts the theme actually changed now, and the
  dark snapshot has been regenerated against a genuinely dark window.
- **The segmented control stretched to fill its row**, leaving the thumb in a
  long empty track — which reads as a progress bar with a label on it rather
  than a choice between three things. It is sized to its options.
- **The select drew a box inside a box, with two chevrons in it.** Its root
  element was `class="select"` — which is a daisyUI *component* class, so the
  framework applied its own border, fixed height, `width: clamp(3rem, 20rem,
  100%)` and a background-image arrow on top of ours. The gate now fails on any
  component that takes a framework component's name.
- **The table toolbar and filter bar are rebuilt.** The filter now fits on one
  line for the common case — `where · column · operator · value` — with the
  conditions sized to what they hold rather than stretched to fill the pane, and
  the mode switch and Apply moved out of a row of their own and onto the end of
  the bar. The toolbar is one rhythm: everything the same height and shape, with
  loudness carrying the difference.
- **Navy text on a blue button, and on every selected menu row.** The accent's
  foreground was whichever of black/white measured higher — 5.02:1 for navy
  against 3.76:1 for white on a mid-blue, so navy won. It cleared AA and looked
  wrong: a saturated field carries far less apparent contrast than its ratio
  suggests. White now wins whenever it is legible, and the accent darkens up to
  0.12 lightness to make it so before the text ever flips.
- **The segmented control had no visible selected segment.** It measured its
  options once on mount, and inside a closed sheet that is a zero-width box, so
  the indicator was 0px wide. It re-measures on resize now.
- **The language picker was a native `<select>`.** `appearance: none` restyles
  the closed control and does nothing to the popup, which the OS draws — so the
  app looked finished until you clicked it.
- **The status bar drew its contents past the window edge.** `<Teleport>`
  inserts the active tab's group after the bar has laid itself out, and the
  slot's intrinsic width resolved against the empty box it had at that moment.
  Everything was then laid out from there rightwards and cut in half by the
  window. (A `container-type: inline-size` added while chasing this made it
  worse — size containment collapsed the slot to 8px.)
- **The window was never actually translucent.** The OS was drawing vibrancy
  behind it the whole time and daisyUI's opaque `--root-bg` painted over it.
- **The three vertical panels were the same surface**, and then, once separated,
  were separated so slightly — about 4/255 — as to be invisible. They now recede
  by tint rather than by alpha alone.
- **The tab strip announced its new-tab button as a tab.** A `tablist` may only
  contain tabs.
- **The entity tree's items had no tree to belong to**, and the schema and
  column rows had no role at all, so assistive technology read the sidebar as a
  list with holes in it. Set size and position are now stated explicitly, which
  virtualisation otherwise makes impossible to infer.
- **The command palette pointed at a results list that does not exist** when
  nothing matches, and never announced which result was selected.

- **The grid header did not follow horizontal scrolling.** On any table wider
  than the pane every column label sat over the wrong column, by exactly the
  scroll distance. Three things had to be fixed: horizontal virtual rendering
  positions columns itself and never scrolls the header, the header row had no
  intrinsic width so there was nothing to scroll, and the sync listener bound
  before Tabulator had built its DOM.
- Option labels built with `t()` at setup time kept whichever language the
  component mounted in; they are computed now.
- The rail and sidebar dividers ran up through the window controls.
- The status bar's contents were clipped by the window's rounded corners.

- **MySQL and TiDB reported no primary keys at all**, which silently disabled
  editing on every table. `information_schema` returns unaliased columns in
  upper case, so reading `row.column_key` off `COLUMN_KEY` yielded undefined.
  Every column is now aliased explicitly, and the conformance suite asserts the
  key is found.
- The MySQL cursor aborted after its first chunk. It was driven with
  `for await`, and breaking out of that loop calls the iterator's `return()`,
  which destroys the stream — so exports stopped after one batch. It is now
  driven with pause/resume.
- ScyllaDB crashed on any statement returning no rows: `CREATE`, `DROP` and
  `USE` come back with no `rows` property at all rather than an empty one.

- Picking a database engine submitted the connection form. The engine chips were
  `<button>` elements inside a `<form>` without an explicit `type`, so they
  defaulted to `type="submit"` — choosing an engine saved a half-empty
  connection and closed the sheet. Every button now declares its type.
- Sheets stopped closing on Escape once focus moved outside the panel; the
  handler now listens at the window.
- The delimiter detector could be outvoted by a single quoted field containing
  commas; quoted spans are masked before counting.
- Connection manager: saved connections, per-engine forms generated from engine
  descriptors, connection testing, and read-only connections enforced in the
  driver.
- Secret storage through the OS keyring; passwords never enter the renderer.
- Workspace: icon rail, resizable sidebar with a virtualised entity tree,
  draggable tab strip, and a status bar the active tab contributes to.
- Table data tab: virtualised grid with spreadsheet range selection, paging,
  raw SQL filtering, inline editing with a pending-changes ledger, and an SQL
  preview of what would be written.
- Accent-driven theming in OKLCH with a self-correcting derivation that keeps
  any chosen colour readable, four translucent material weights, three density
  modes, and spring-based motion primitives.
- Contrast is verified in tests across every accent preset in both appearances.

### Known issues

- Packaging is unsigned unless `APPLE_TEAM_ID` is set.
- End-to-end coverage runs against the serverless engines (SQLite, DuckDB). The
  five that need a server are covered by the shared conformance suite only when
  one is reachable.
