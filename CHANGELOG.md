# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The query editor completes the words the engine understands**, not only your
  own tables and columns. `SELECT` had to be typed in full while the table after
  it completed from three letters. Each dialect gets its own set — `jsonb` and
  `ON CONFLICT` on Postgres, `AUTO_INCREMENT` on MySQL, `QUALIFY` on DuckDB, CQL
  rather than SQL on Scylla — so the list never suggests a word the server
  would reject.
- **What the engine brought with it is hidden until you ask for it.** A
  catalogue table, an extension's thousand `st_*` functions: they used to sit in
  the tree beside your own three tables. There is a toggle at the head of the
  panel now, off by default, and turning it on asks the server for them rather
  than filtering an answer it already sent.
- **Expand all**, beside Collapse all. A tree that can be shut had no way back
  but clicking every chevron. The two are an icon pair now, each dimmed at its
  own end, so the row also says how far open the tree is — and they share one
  compact row with the built-ins toggle rather than taking two.
- **The sidebar goes back to its default width** — double-click the divider, or
  run it from the palette. Double-clicking used to collapse the sidebar, which
  hid the divider that did it and left the keyboard as the only way back.
- **The macOS build can be signed and notarised by CI.** Six repository secrets
  and nothing else; without them the build is unsigned exactly as before. See
  CONTRIBUTING.

### Changed

- **A query's duration is shown in the unit that suits it**, the way `df -h`
  picks one for a size. It was always whole milliseconds, so a query that took
  four tenths of one reported "0 ms" and a three-minute one reported "180000
  ms" — neither of which is a number anybody reads.
- **The row count and the time a query took can be selected and copied.** The
  root turns selection off, which is right for chrome and wrong for the one
  string in a toolbar that is a measurement.

### Fixed

- **The connection form was half translated.** Read-only, Advanced, the SSH and
  proxy fields and the password reveal were all still in English whatever the
  interface language was, and so were the column and index editors in the
  structure view.

## [1.2.0] - 2026-08-29

### Added

- **Five more assistant providers**: DeepSeek, Kimi, Qwen, GLM and MiniMax. Each
  is picked by name with its address and models already filled in, rather than
  choosing “OpenAI-compatible” and going to look up a base URL. The defaults are
  the international endpoints; the mainland ones are a field edit away.
- **Files and images go with a question.** Attach a CSV sample, a schema dump or
  the error you are staring at — by paperclip, by dropping it anywhere on the
  conversation, or by pasting, which is how a screenshot arrives. Text files
  work with every provider. Images need one that reads them, and the ones that
  cannot say so instead of failing after you have chosen the file.
- **A connection can be copied to the clipboard**, not only saved to a file —
  which is the likelier of the two when you are sharing one rather than backing
  it up. It carries passwords like the file does, and says so more sharply,
  because the clipboard is readable by everything else on the machine.
- **Command-line assistants you have not installed are listed anyway**, greyed
  and unselectable. A list that leaves them out cannot tell you whether Codex is
  missing or was never supported.

### Changed

- **The connection sheet is grouped by what its fields mean** — server,
  credentials, options — instead of flowing through a two-column grid that put
  the password beside the database name. The engine is chosen once and then it
  is a single row, so the nine marks stop taking the top of every visit; they
  sit on one grid of equal columns rather than two ragged rows. Test moved out
  of the row of things that finish, and only appears once there is something to
  test.
- **Each provider is drawn in its own brand colour** instead of every one of
  them taking your accent.
- **Secondary text is readable.** Labels, hints, counts and timestamps were
  drawn between 38% and 62% of the text colour, which measures as low as 3.04:1
  where 4.5:1 is the requirement. All of it now uses one value that clears the
  line, on every accent, in both appearances.
- The accent is stored by name — `"blue"` — rather than as three numbers.
  Settings files written by older versions still work.

### Fixed

- **The engine chips answered a hover with nothing**, and scaled their mark to
  exactly the size the *selected* chip uses, so pointing at one made it look
  chosen.
- The sign-in sheet's hint sat higher than the buttons beside it, in every sheet
  in the app.
- Redis reads a key's type and its expiry together now, rather than one after
  the other for every row in the keyspace view.

## [1.1.1] - 2026-08-29

### Added

- **Grok Build** as an assistant provider, alongside Claude Code and Codex. Like
  them it signs itself in, so there is no key to copy in and nothing to fill
  out; it is offered as soon as the `grok` command is on this machine.
- **Saving a query opens on the tab's own name**, rather than on an empty box
  that ignored the name you had already chosen.
- **Dispatching a statement asks what to call the job.** A job is a row in a
  list that is still there tomorrow, and it used to be named after the database
  and the second it started, so two dispatches on one afternoon were told apart
  by their timestamps. The stamp is still the default, so the old behaviour is a
  press of return away.
- **The assistant can suggest a name for either**, from what the statement does,
  where a provider is configured. It fills the box you are typing in — what gets
  saved is whatever you leave there.

### Changed

- **Notices go back to the way 1.0.0 drew them**: a sentence on a plain surface
  with one coloured mark, in a column where all of them can be read. The wash of
  colour, the bar down the edge, the countdown bar and the pile that stayed shut
  until you pointed at it are gone. Throwing one away with a swipe stays, and a
  quick flick now works — it used to slide back under your hand unless you
  dragged most of the way across.
- **The command palette opens instantly.** It had a quarter-second animation, on
  a window you reach for from the keyboard dozens of times a day.
- **A sidebar button always opens its panel.** Pressing the one already showing
  used to collapse the sidebar, so aiming at the panel you were on shut the
  column instead — and from a collapsed sidebar, a press reopened whichever
  panel happened to be last rather than the one you aimed at. The switch at the
  foot of the rail still collapses it.
- **Run, Format, Save, every tab and every card in the sidebar answer a press.**
  They were the most-pressed controls in the window and the only ones that gave
  no sign of having been pressed.
- **The sign-in sheet for Claude Code and Codex is one instruction**, not three
  numbered steps around it — and the command is now selectable as well as
  copyable.
- The start screen finishes arriving about a third of a second sooner.

### Fixed

- **The first question you ask about a database no longer waits for its schema
  to be read.** That reading now happens when you connect, while you are looking
  at the table list, and only where an assistant is actually configured.
- **The sign-in sheet drew two sets of step numbers**, one down each side, with
  every line centred between them.
- A notice thrown away with a swipe could stay in the list forever, invisible,
  for anybody using the system's reduced-motion setting.

## [1.1.0] - 2026-08-28

### Added

- **Stored data**, in Settings or from the command palette: everything Shelf
  keeps on this machine, by category — query history, conversations, job
  results, workspace state, statistics history, saved queries, assistant
  providers and connections — with what each is holding beside it, and a button
  that clears exactly the ones you tick. The things you made by hand start
  unticked. Job results moved into the app's own folder alongside its database,
  out of the system temp directory the operating system is entitled to empty.
- **AWS Bedrock and Azure AI Foundry** as assistant providers. Bedrock asks for
  no key at all — it signs with the AWS credentials this machine already has, so
  there is nothing to copy in — and takes the region your models are enabled in.
  Azure takes your resource's own endpoint and the name of the deployment you
  turned on.
- **Every engine draws its own mark.** The connection list, the engine picker
  and the sidebar show the database's logo rather than two letters.
- **The assistant checks Claude Code and Codex are signed in before asking them
  anything.** One that is installed but signed out used to leave the chat
  waiting indefinitely on a subprocess with no terminal to ask for a login; it
  now says so straight away and shows the command to run.
- **A notice raised while you are in another application reaches the desktop.**

### Changed

- **Notices are rebuilt.** A bar along the bottom shows how long one has left,
  and it stops while the pointer is on it, while the pile is open, or while the
  window is not the one you are looking at. Several of them stack into a pile
  and open into a column when you look at them, one can be thrown away with a
  swipe, and the kind of notice is now readable from across the screen instead
  of from one small coloured glyph.
- **Reset puts back every setting**, not just the data ones: appearance, data,
  the editor and the keyboard shortcuts. It used to leave two of those four
  alone, so somebody who had made the window unreadable could press the only
  button called Reset and watch nothing happen.
- **The assistant says which wait it is in.** It claimed to be reading the
  schema on every turn; the reads are remembered per connection, so after the
  first turn the wait is the model's and it says so.
- A conversation in the sidebar is marked the way every other card in every
  other panel is.

### Fixed

- The assistant could not read a table it asked to inspect: the tool came back
  "Could not read the schema: input is not defined" and the answer carried on
  without the columns.
- Saving a query while on the sample database — or on any connection you had
  not saved — silently did nothing.
- A conversation filtered by when it was last added to matched nothing at all.
- In a full tab strip: the `+` scrolled off the end with the tabs, a tab at the
  edge was cut off mid-word, a newly opened tab was not scrolled to, and closing
  one moved the row out from under the pointer that closed it. Closing several
  in a row now keeps every close button where it was, the way a browser does.
- The ring that traces a busy control drew two lines at every corner and jumped
  once a lap.
- A popup could settle a few pixels short of its own content, and one that fitted
  perfectly well dimmed its last row — which on the stored-data sheet is the
  button that does the thing.
- The assistant's opening note mixed languages, describing what it can see in
  English inside a translated sentence.
- The password field claimed passwords are stored in the system keychain and
  never in the app's database. It is the other way round: they are encrypted
  with a key from the keyring and kept in the app's own database, so a copy of
  that file is not a copy of your passwords. Everything that describes this now
  says where the bytes are.

## [1.0.1] - 2026-08-27

### Changed

- A connection exported to a file now carries its passwords, in plain text
  under a `secrets` key, so moving to another machine is one file rather than a
  file and a round of remembering. Importing writes them straight to the OS
  keyring. The document's note says what it holds in its first line, and the
  toast that confirms the export says it too — this is the one artefact that
  leaves the machine, and a file that quietly contains a password is the one
  people attach to a ticket.

### Fixed

- The macOS app opened as "damaged" and had to be moved to the Trash. It was
  not signed at all, so a downloaded copy carried only the ad-hoc *linker*
  signature from the Electron executable — identifying itself as `Electron`,
  sealing no resources, and describing a bundle it no longer matched. The app
  is ad-hoc signed now, which is not notarisation but is the difference between
  asking permission on first open and appearing to be corrupt.
- SQLite did not work in any packaged build. `better-sqlite3` moved to
  prebuildify, so the binary the install hook compiles against Electron's ABI
  lands in `prebuilds/`, and packaging excluded that whole directory as
  leftovers — which it had been, one version earlier. The other platforms'
  prebuilds are still dropped, but in `afterPack`, where the architecture being
  built is known.
- Packaging now checks what it produced: that the SQLite binary is in the
  bundle and that the signature verifies. Neither fault above was catchable by
  the test suite, which runs against the build directory where `node_modules`
  is on disk and nothing is signed.

## [1.0.0] - 2026-08-27

### Added

- Assistant: ask a database in words. Statements are classified before they
  reach the connection and only reads run; anything else comes back as SQL with
  an offer to open it in a query tab. A turn's queries are declared as working
  or as the answer, so the intermediate ones fold away and the one that was
  asked for is open. Claude Code and Codex are driven as subprocesses; the rest
  go over their own APIs. The reply's language follows the question, with the
  interface's language settling what a bare table name cannot.
- Jobs: a dispatched query gets a card you can rename, search and filter, and
  the statement it actually ran is one click away.
- Keyboard shortcuts are editable — by performing the chord, or as a JSON
  document. Only what differs from the defaults is stored, so a keymap written
  in an old version does not pin every other shortcut to that version.
- Colour schemes for everything that draws code — the editor, statements in a
  conversation, and the JSON views: Visual Studio Code, Nord, Tokyo Night, Rosé
  Pine, Gruvbox, Monokai Pro, Darcula, Catppuccin and One Dark, chosen per
  appearance or synced across both, with a specimen of the palette beside the
  picker.
- The database menu switches between saved connections, opens the connection
  editor over the workspace, and diagnoses the connection: timed round trips
  with a trace of every one, and the catalogue reads measured rather than
  asserted.
- The command palette reaches the colour schemes, the shortcuts editor, a new
  connection and the diagnosis; the settings document carries the scheme and the
  keymap, so an export is the whole of what was configured.
- The tab strip's plus asks which kind of tab, with the shortcut beside each.
- Downloadable builds for macOS, Windows and Linux, produced by tagging a
  release: a `.dmg` and a `.zip`, a `.deb`, an `.rpm` and an `.AppImage`, and an
  installer and a portable `.exe`. Each is built on the architecture it runs on.
- Claude Code and Codex are found on the machine rather than added by hand. If
  either is installed and signed in it appears in the picker with nothing to
  fill in, and it is looked for again on every launch.
- Every assistant provider shows its own mark, so the row says which company is
  about to be sent the question.

- Start screen rebuilt as a two-pane welcome window: identity and the ways to
  start something new on the left, recent connections, saved ones and the sample
  database on the right as folding groups. The window is compact while it is
  shown and returns to the workspace size when a database opens.
- Settings can be edited as the JSON document they are stored as, beside the
  form, and exported to or imported from a file. Values a control could not
  produce are dropped or clamped rather than written through.
- Any saved connection can be exported as a JSON preset and imported back.
  Presets never carry a password: it stays in the OS keyring.

- Three-process Electron architecture: the renderer talks to a dedicated
  connection host over a `MessageChannel`, so database work cannot block the
  interface and a driver crash costs one process restart.
- `DatabaseClient` interface with a capability descriptor, so nine very
  different engines share one interface without pretending to be alike.
- All nine drivers: PostgreSQL, MySQL, TiDB, SQLite, DuckDB, MongoDB, Redis,
  ScyllaDB and DynamoDB — each with cancellation that reaches the server where
  the engine allows it, chunked streaming, and single-transaction (or batched)
  change application.
- Query tab: a Monaco editor with schema-aware completion, the statement under the
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
- Analysis, in the database's Properties popup: the slowest statements over the
  last hour, six hours, day, week, month or all time, with calls, total and mean
  time and each statement's share of the window, and a ranked chart of where the
  time went; plus cache hit ratio, transaction rate, connections by state, the
  largest tables with their dead-row bloat and the indexes the planner has never
  chosen. No engine keeps a history — `pg_stat_statements` and MySQL's digest
  table both hold one running total since the counters were last reset — so the
  app records its own readings and differences them, and says so when a window
  is wider than the history behind it.
- Properties for a schema and for a database: size, owner, encoding, collation
  and counts, with the largest tables inside it, declared per engine through a
  new `containers` capability.
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

### Changed

- The empty pane lists the ways to start, each with its keystroke, instead of
  two grey sentences.
- The window is two columns running its full height with the tabs on the working
  pane, rather than a band laid across the top of them.
- The sidebar's four lists — tables, saved queries, history and chats — share
  one search field, one tile and one filter.
- The start screen wears the app's own glass, and can be taken out of full
  screen.
- Settings opened from the start screen can now reach the shortcuts editor and
  the provider list; both rows previously did nothing there.
- The assistant reads a database's schema once per connection instead of before
  every message. Gathering is a round trip per table for its columns and two
  more for its indexes and relations, and it ran in full on every turn; the
  reads are kept and the document is still assembled per question.
- A new provider's name field starts empty, with the provider as its
  placeholder, rather than pre-filled with the first driver's name.

### Fixed

- PostgreSQL reported its version as "unknown" everywhere. `SHOW server_version`
  answers with a column named `server_version`, and the driver read `version`
  off it.
- A menu opened from a button is closed by pressing that button again.
- Escape leaves the shortcut recorder without closing the sheet it is in.
- A tab dragged one width moves one place, not two, and keeps moving after the
  first.

- **Exporting to a file wrote a file of blank lines.** The host read
  `cursor.fields` before the cursor had answered a single batch, and several
  drivers only learn a result's shape from the first one — so the column list
  was empty, the CSV header was a blank line and every row rendered as nothing.
  The export reported the right row count while doing it. Both existing export
  tests take the clipboard branch, which is why it shipped; there is an
  end-to-end test for the file branch now.
- **The sample database could not export a query's results at all.** Its
  `stream` read the entity and ignored the query, so it threw on `undefined`
  before a byte was written — in the one engine every screenshot and every gate
  run uses.
- **An unnamed export is stamped rather than called `query-results`.** A fixed
  name collides with itself: the second export either overwrites the first or
  has to be renamed by hand. It is `query-YYYYMMDD-hhmmss-nnnnnn` now, which is
  unique and sorts a folder of exports into the order they were taken. Names the
  user chose are kept, and made safe for a filesystem — a saved query called
  "orders / last 30 days" was producing a path with a directory in it.
- **The structure view's table was a CSS grid.** Tailwind owns `.grid`, and a
  scoped rule that set the table's width and `table-layout` but never its
  `display` did not outrank it — so head and body were blockified into two
  separate anonymous tables, each sizing its own columns, and every header label
  sat a third of the pane away from the values under it. Renamed, given a
  `colgroup` per section, and the framework-name gate now covers Tailwind's
  utilities as well as daisyUI's components.
- **Opening Indexes or Relations on PostgreSQL took the whole view down.** The
  driver returned `array_agg(name)` as OID 1003, which `pg` has no parser for
  and hands back verbatim as the string `{id,name}`; the first `.join()` in the
  render threw. Cast to `text[]`, and the conformance suite now asserts the
  shape rather than only the type.
- **Column descriptions were fetched and never shown.** They sit under the
  column name now, where a sentence has the width of a sentence.
- **Referential actions were shown as catalogue letters** — `a`, `n`, `c` —
  rather than `NO ACTION`, `SET NULL`, `CASCADE`.
- **The opacity dial painted 36% when it said 20%**, and closed the gaps between
  the surfaces as it thinned them, so the working pane and the glass columns
  converged on one colour at the bottom of the range. It subtracts a constant
  now: every surface keeps the distance it was designed to have, and the pane
  lands on the dial's own number at the floor.
- **The rail names its icons.** A column of glyphs is legible only to someone
  who already knows what they mean, and `title` is not the answer: the OS
  tooltip arrives after a second and a half, in a corner of its own choosing,
  styled by the platform rather than by the app. The label is drawn beside the
  icon, appears on keyboard focus as well as hover, and — once one is up —
  the next is immediate, because moving along a row of icons is one gesture and
  waiting again at every stop is what makes a toolbar feel slow.
- **Every properties popup is the same, settled height.** They are opened and
  *then* their content arrives, so sized by that content each was one height
  while it said "Loading…" and another once the answer landed — and the next one
  opened was a different size again. They have a definite height now and their
  bodies scroll.
- **The settings icon is a cog.** It was an eight-lobed blob with a circle in
  it, recognisable as "settings" only by where it sat — which is not
  recognisable. It turns a quarter under the pointer: the one icon in the rail
  whose shape means something mechanical is the one where movement reads as the
  object behaving rather than as decoration.
- **The connection editor shows the password it saved.** It used to leave the
  field empty and explain, in help text, that blank meant "keep the saved one" —
  a rule the reader has to be told and then remember, and one that made changing
  a port an act of remembering a password. The field is filled from the keyring
  and editable, with one control to reveal it.
- **The properties popup no longer resizes as you read it.** Its sections are
  wildly different heights, so every switch resized the window and every
  arriving fetch nudged it again. One frame holds still and the panes cross-fade
  inside it; the analysis is mounted once rather than torn down and reloaded on
  every switch back.
- **Connections by state fills its card and answers to the pointer.** The ring
  says a whole is divided and is bad at letting you compare the divisions, so
  the comparing is done by bars in a list that runs the width of the card
  instead of a narrow column pinned beside the chart. Hovering either the ring
  or a row lights the other.
- **A dark rectangle sat in the corner of the content pane.** The notch that
  backs the pane's cut corner was a full square behind it, and the pane is
  glass — so across the quarter-disc the two surfaces stacked and composited to
  a shade darker than either. It is masked to the wedge now, and the gate
  asserts it in pixels: eight pixels across is far under the screenshot
  threshold, so the snapshot that exists to guard this corner could not see it.
- **The filter bar's controls sat four pixels from the top and eleven from the
  bottom.** Everything in it is a field-height control except the segmented
  switch, which is that plus its own track padding — and the track cannot
  shrink, because the option inside it is a pointer target. So the bar was
  taller than most of what it held and `flex-start` dropped the whole surplus at
  the bottom. The row carries the height now and centres its own contents.
- **A printed snippet can be selected and copied.** The `pg_stat_statements`
  setup commands are shown precisely so they can be run somewhere else, and a
  block you have to retype is one that gets retyped wrong.
- **Menus and sheets are opaque, and nothing in the page blurs any more.**
  `backdrop-filter` filters what the page has painted, and the app's glass is
  the OS's material behind the whole window, which no in-page filter can reach.
  Measured on screen, the filter ran correctly and destroyed exactly the pixels
  it was given, and the result was invisible. A menu over the sidebar was also
  one translucent surface on another, which the material rules already forbid.
  The blur setting went with it rather than being left as a control that
  provably does nothing.
- **Every panel ran a full-screen backdrop filter over nothing.** The root is
  transparent and the blurred desktop is the OS's own material behind the whole
  window, which no in-page filter can reach — so the blur cost a compositing
  pass per panel per frame and produced exactly what not running it produced.
  Blur now belongs only to sheets and menus, which are the surfaces that sit
  over the app's own content and have something to refract.
- **The open-tab session was never written.** It is assembled from Vue state,
  and a reactive proxy cannot be structured-cloned — the context bridge rejected
  it asynchronously, into a promise nobody awaited, so every launch opened an
  empty workspace in silence. Settings now serialise at one boundary, and the
  gate asserts the round trip.
- **A table mid-load announced that it was empty.** Tabulator draws its "No
  rows" placeholder the moment it has no rows, which is also the whole of the
  first fetch — under the loading veil, blurred.
- **A schema and a database had no menu at all.** Right-clicking a folder did
  nothing, because the handler took an entity and returned early without one.
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
- **The start screen painted no surface of its own**, borrowing its contrast
  from whatever was behind the window. On the dark theme its text is light, so
  over a bright desktop the title, the subtitle and the "new connection" card
  were light-on-light and effectively invisible. The workspace was only fine
  because its content pane is opaque. The gate now checks that every screen
  paints its own background, and covers the start screen in dark.
- **An Export sheet for query results** — format (CSV, TSV, JSON, JSON Lines,
  Markdown, SQL) and destination (file or clipboard) as two choices rather than
  a list of eight download items. A file is streamed to disk by the host, so it
  carries the whole result set however large; the clipboard carries what is
  loaded, and the sheet says which is which. **It does not open yet** — see the
  fixme in the end-to-end suite.
- **Column labels sat high in the header** rather than centred in it: Tabulator
  writes an inline height onto every column from the natural height of its
  label, which is shorter than the header row and beat the stylesheet.
- **An empty outlined box floated below the last row.** This stylesheet
  replaces Tabulator's rather than extending it, and the range overlay's
  *positioning* rules were never carried across — only its colours. The overlay
  therefore laid out in normal flow instead of over the cells, so the selection
  rectangle sat one column left and one row below the cell it belonged to.
- **Two highlights for one selection in the icon rail.** The travelling marker
  and the selected item each painted a surface, which only goes unnoticed for
  as long as they line up exactly — and after the header band was aligned they
  no longer did, leaving a grey square peeking out above the blue one. The
  marker is the whole indicator now, and both it and the rail's padding derive
  from one value.
- **Column headers could not line up with their values.** The header was set in
  the UI face at 11px over 13px monospace data; different faces have different
  side bearings, so every label sat a pixel or two off the column it named. A
  column name and its values are both identifiers — they share one face and one
  size now, with weight and colour carrying the difference.
- **Hover and selection fills came from `--color-base-content`**, the same flaw
  already fixed for borders: on the dark theme that colour is near-white, so an
  "8% hover" was 8% white. Twenty-three of them now come from the fill ramp.
- **The rail and the sidebar are one surface now.** Giving them separate shades
  put their boundary directly under the window controls, which are wider than
  the rail; hiding that with a banded top only moved the seam above the first
  rail icon instead. Matching alphas does not fix it either — two surfaces
  sharing a tint but differing in opacity diverge by an amount that depends on
  what is behind the window, so the seam shows over a bright desktop and not a
  dark one. Two depths, not three.
- **The rail's first icon and the connection row beside it sat four pixels
  apart** — close enough to read as a mistake rather than a choice. They were
  positioned independently; both now centre in one shared header band.
- **The dark panels had lost most of their translucency.** They were pushed to
  88% opacity to stop the sidebar photographing as washed-out grey, which was
  an artifact of a screenshot compositing against white rather than anything
  visible on screen. Restored to real glass, with a check that fails if a panel
  becomes opaque or loses its blur.
- **A bright vertical line down the full height of the window.** The resize
  handle occupies a one-pixel column of layout between the sidebar and the
  content, and painted nothing — so the window's own backdrop showed through
  it. On a translucent window that is the desktop, which is why the line was
  bright over a light wallpaper, present in both themes, and unaffected by
  every attempt to adjust the colours around it: the page was not drawing it.
  The gate now samples every column of the window and fails on any pixel the
  page leaves unpainted.
- **The rail and sidebar dividers are gone.** Panels that already differ in
  tone do not also need a line between them; on the dark theme the hairline was
  the brightest thing in the window, brighter than either surface it separated.
- **Bright white lines between every panel.** Dividers were a percentage of
  `--color-base-content`, which is near-white on the dark theme — so an "8%
  hairline" was 8% white. They come from the neutral grey the fills use now,
  and the gate fails any border brighter than the text beside it.
- **The dark sidebar washed out over a bright wallpaper.** A dark surface at
  58% opacity composites *lighter* than the opaque content pane next to it, so
  the two stopped reading as the same window. Dark materials hold their tone
  now.
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
