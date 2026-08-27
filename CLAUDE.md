# CLAUDE.md

Guidance for working in this repository.

## What this is

Shelf is a cross-platform desktop database client: Electron + Vue 3 +
TypeScript, MIT licensed, with no paid tier and no feature gating. If you find
yourself writing a licence check, a capability that is withheld, or an upsell,
that is a bug.

## Commands

```bash
make             # the gate — lint, unit, build, ui, e2e. ~40s. What CI runs.
make gate-full   # the gate plus the storybook sweep (~2½ min)
make install     # install everything, rebuild native modules
make dev         # hot-reload development
make preview     # run the built app, no dev server and no hot reload
make build       # typecheck + build all processes
make test        # unit tests (vitest)
make test-e2e    # end-to-end tests against the built app (playwright)
make ui          # UI quality gate: visual, accessibility, design invariants
make ui-accept   # regenerate the visual snapshots — read the diff first
make format      # prettier + oxlint --fix
pnpm shots       # screenshot the interface for design review
```

Run `make format` and then `make` before considering a change finished.

**The gate runs in about forty seconds, and that is the point.** It used to take
six minutes, which is long enough that it stopped being run before a change and
started being run after one — so it found things a day late, in a diff that had
moved on. Almost all of that was two Playwright configs pinned to one worker
with `fullyParallel: false`, for a reason that had stopped being true: the
fixtures hand every test its own `mkdtemp` user-data directory, so there is
nothing left to serialise. The rest was a single end-to-end test whose last line
clicked a control that does not exist on SQLite and swallowed the failure, which
cost thirty seconds a run and asserted nothing.

Only the storybook sweep is outside the gate, and only because building the
static storybook is two minutes on its own. Run `make gate-full` when a
component's props or a mock's shape has changed.

## Architecture rules

- **The renderer never imports a driver.** Drivers use Node APIs and native
  modules. If the renderer needs something from `src/drivers`, it is a *type* or
  it belongs in `src/shared`.
- **A connection document carries its secrets, and says so.** Exporting a
  connection writes its passwords in plain text under a `secrets` key, because
  a preset that arrives needing the password remembered is half a move. The
  cost is that this is the one artefact that leaves the machine, so it is paid
  in the open: `secrets` is its own key rather than mixed into `config`, so it
  can be seen and deleted; the document's `note` says what the file holds in
  its first line; and the toast that confirms the export says it too. Importing
  puts them straight into the keyring — the file is a transport, not a store.
- **Secrets go keyring → main → host, and the renderer gets a handle.** It
  receives a single-use token from `window.shelf.db.prepareConnection` and never
  a password — with one deliberate, narrow exception: the connection editor asks
  for the secrets of the *one* connection it has open, so the form can show what
  it already holds. A field that hides its value and declines to hold it makes
  changing a port an act of remembering a password, and "leave blank to keep the
  saved one" is a rule the reader has to be told and then remember. It reveals
  nothing they could not read out of the OS keychain themselves.
- **New host channels go in `src/shared/contract.ts` first.** The renderer client
  and the host registry are checked against that one declaration, so adding a
  channel to one without the other is a type error rather than a runtime
  surprise.
- **Engine differences are declared, not thrown.** Add a capability to
  `Capabilities` and let the interface read it; do not call a method and catch
  "not supported".
- **Values that cross the process boundary are tagged.** Buffers, BigInts, dates
  and ObjectIds do not survive a structured clone intact — use the transcoder in
  `src/drivers/transcode.ts`.
- **Nothing reactive crosses a bridge.** A Vue proxy cannot be structured-cloned,
  and the failure is asynchronous and silent — the open-tab session went
  unwritten for as long as a tab carried a reactive entity reference, and every
  launch opened an empty workspace. Settings go through `lib/settings.ts` and
  host calls through `lib/host.ts`; both serialise at the boundary so no call
  site has to remember.
- **Shapes are asserted, not assumed, in the conformance suite.** Postgres
  returns `array_agg(name)` as OID 1003, which `pg` has no parser for and hands
  back verbatim as the string `{id,name}`: everything type-checked, everything
  crossed the boundary intact, and the first `.join()` in the interface took the
  whole structure view down. Cast to `text[]`, and assert the shape.

## Design rules

- **The root is transparent, and must stay that way.** The OS draws the
  material behind the window; anything that paints an opaque root covers it.
  daisyUI's `--root-bg` is overridden to `transparent` in `base.css` for exactly
  this reason.
- **The three vertical panels are three different surfaces.** Rail, sidebar and
  content are `panel-recessed`, `panel-sidebar` and `panel-content` — receding
  to prominent, with only the content pane opaque. Panels recede by being
  *tinted*, not merely by having less alpha; alpha alone changes how much shows
  through without changing how far back it reads.
- **Fills come from `--fill-1..4`, never from a percentage of
  `--color-base-content`.** That colour is near-white on the dark theme, so a
  "12% tint" of it is 12% white and composites far lighter than the same alpha
  of dark over white. The fill ramp is mixed from one neutral grey with
  per-theme alphas.
- **A surface that is sunk into the pane is `--surface-well`; one that stands
  off it is `--surface-raised`.** Both were spelled at their call sites — the
  query editor and the assistant's transcript were each `--fill-4`, so the two
  largest surfaces in the app agreed by coincidence and would have stopped
  agreeing the first time either was touched. Raised needs a per-theme value
  because "away from the field" is a different direction in each; sunk does not,
  because a fill is a tint of grey either way.
- **The accent as type is `--color-primary-text`, not `--color-primary`.**
  Setting the fill colour as text on a wash of itself is the one combination
  guaranteed to be low contrast.
- **A filled accent control carries white text**, and the accent moves to make
  that legible rather than the text flipping dark. See `usableAccent`.
- **Nothing in the page blurs, and a scrim dims.** `backdrop-filter` filters
  what the *page* has painted, and the app's glass is the OS's vibrancy material
  behind the whole window, which no in-page filter can reach. Behind a panel
  there is nothing painted at all; behind a menu there is a flat tint and a few
  lines of thin grey text. Measured on screen the filter ran correctly and
  destroyed exactly the pixels it was given, and the result was invisible — a
  full-screen compositing pass a frame per surface, for nothing. So the window
  keeps the OS's glass and the page draws none of its own.
- **A menu and a sheet are opaque.** They open over the sidebar and over the
  workspace, both of which are already translucent, so a translucent one is
  glass on glass — the arrangement that collapses legibility. Their separation
  comes from a fill a clear step away from the columns behind them, a shadow,
  and the light-catching edge. The window is a material; the things in front of
  it are objects.
- **The anchor is one number, and moving it moves everything by the same
  amount.** The dial's middle is where every material paints exactly the alpha
  it was designed at, and those alphas were set too high — at the middle of a
  slider whose whole subject is translucency, the window read as painted rather
  than as glass. They came down by sixteen points, all of them, which is the
  same arithmetic the dial itself does below its anchor: the distances that
  carry the depth are untouched and only the whole window sits further back.
  `CONTENT_ALPHA` in `theme.ts` is the pane's designed value and has to move
  with it, or the offset stops landing the pane on the dial's own number at the
  floor.
- **The opacity dial subtracts; it does not scale.** Scaling every alpha toward
  zero closes the *gaps* between the surfaces as it thins them, so at the bottom
  of the range the working pane and the columns beside it converge on one colour
  and the window reads as a single flat sheet. An offset moves every surface by
  the same amount, so the distance between any two of them is the distance they
  were designed to have at every position of the slider — and the offset is
  sized so the pane lands on the dial's own number at the floor. A control that
  says 20% while painting 36% is not a control.
- **A new option is three things, not one.** A control in the sheet, a row in
  the command palette, and a key in the settings document — and the two that get
  forgotten are the ones nothing fails without. The colour scheme arrived with a
  form control and no palette row; the parity test of the day looked only at
  `Settings` and never saw it. `APPEARANCE_KEYS` in `settingsFile.ts` is derived
  from `Record<keyof AppearanceState, true>`, so the list cannot fall behind the
  interface, and the test walks it: every option is reachable as a command or
  named in `UNCOMMANDED_APPEARANCE`. An export that silently drops half the
  state is the same fault wearing a different coat.
- **A sheet is owned by the view, not by the control that opens it.** Settings
  emits `manage-shortcuts` and `manage-providers` rather than holding those
  sheets, because the palette opens them too — and a surface owned by one
  control can only ever be opened from that one. Both views that show Settings
  have to answer: the start screen's copy was emitting into nothing, so two rows
  there had buttons that did nothing at all.
- **A setting that changes nothing is worse than no setting.** There was a blur
  radius beside the opacity, and once the modal surfaces went opaque it drove
  nothing at all — so it is gone, not merely unused. Someone will move a dead
  control, see nothing happen, and leave it wherever they let go.
- **Tab toolbars are one definition**, in `styles/controls.css`. Everything in
  the row is the same height and shape; *loudness* carries the difference —
  quiet by default, a tonal surface for a mode that is on, and a filled accent
  for the one action that commits, never more than one per bar.
- **No control hands its popup to the engine to draw.** A `<select>` and a
  `<datalist>` look finished until they are opened, at which point the OS draws
  the list with its own focus ring, its own selection colour and its own idea of
  where the list goes. `appearance: none` restyles the closed control and leaves
  the open one native, which is worse: the app looks finished right up to the
  click. `SelectMenu` replaces the first and `SuggestInput` the second — the
  latter for a field that must stay typeable, like a model name we have never
  heard of on someone's local server — and both open the *same* list, from one
  `.menulist` definition in `controls.css` and one `useAnchoredList`. The list
  is teleported to the body, because an absolutely positioned child is cut by
  every ancestor that clips, and in a settings row two of them do.
- **Never take a framework component's class name — or a Tailwind utility's.**
  daisyUI ships `.select`, `.input`, `.btn`, `.card`; a component of ours
  wearing one inherits its border, height and width clamp on top of whatever we
  drew. The utilities bite harder for being one declaration: `.grid` is
  `display: grid`, and a scoped rule that set a table's width and
  `table-layout` but never its `display` did not outrank it — so the structure
  view's table was a grid container, its head and body were blockified into two
  separate anonymous tables, and each sized its own columns. The gate fails on
  both lists.
- **A default is somebody's answer, not the absence of one.** The syntax
  catalogue had a "Shelf" entry that wrote nothing and let `base.css` answer —
  coherent as an idea and poor as a menu item, since it was the one row whose
  name told the reader nothing about what they were choosing. Monokai Pro is
  the default; the stylesheet's values stay as the fallback for a token a
  palette does not carry.
- **Never hardcode a colour.** Everything comes from the tokens in
  `src/renderer/styles/`. The accent derivation in `theme.ts` is the single
  source; if you add a semantic colour, add it there and give it a contrast test.
- **Targets have a floor.** `--hit-min` is 28px, the desktop pointer minimum,
  and it sits *outside* the density factor — density changes spacing and how
  much fits on screen, it never shrinks a target below the floor. The grid is
  the single exception, documented where it is declared. iOS's 44pt was tried
  and is the wrong number for a pointer-driven app this dense.
- **How wide the columns are is declared once.** Four things have to agree on
  it: the sidebar is that width, the notch sits at it, the working pane begins
  after it, and the tab strip starts where the pane starts. Each used to work it
  out for itself — three inline `calc(var(--rail-w) + Npx)` expressions and a
  width — which is three chances for one to be left behind, and the tab strip
  was the one that had been: it began after the sidebar toggle, at an offset
  matching nothing else in the window. `--sidebar-w` is the only part that comes
  from the interface, because it is the only part anyone can drag; `--columns-w`
  is derived from it, and every dependent property animates from the one source
  on the one curve.
- **A control belongs in the column it governs.** The sidebar's switch sat on
  the top bar beside the traffic lights, where it was the only control in that
  row acting on something *below* the row — and it pushed the tab strip along to
  that offset that lined up with nothing. It is at the foot of the rail now,
  under the five things that column can show and above the cog, which stays last
  because everything else there is about the database and settings is about the
  app. Its pressed state brightens the glyph and nothing more: the rail's tonal
  tile means "this is the panel you are looking at", and a sixth lit tile would
  say the sidebar is a destination beside the five rather than the switch that
  shows them.
- **The bar is its two columns, not a band across them.** The tab strip is a
  region of `.topbar` rather than a band inside the content pane — that is what
  makes the window controls safe, because they are wider than the rail and
  overhang the sidebar, so while any column boundary reached the top edge it ran
  directly under them. But the bar is not a surface of its own either: its
  leading region wears the sidebar's material and the strip wears the pane's, so
  the window reads as two columns running its full height with the tabs sitting
  on the working pane, which is where a tab strip belongs. The seam between them
  falls at the columns' trailing edge, and the rule that matters is unchanged:
  nothing draws a line where the traffic lights are. Under the *controls* the
  surface is one surface, and the invariant sweeps that region rather than the
  whole bar. Nothing below the bar may be positioned back over it.
- **The open tab is tonal, and one marker travels between them.** A raised thumb
  is only legible as raised against the recessed track it came out of, and the
  bar may not carry a track — so the elevation was a card hovering over nothing,
  which is how it read. The marker is measured from the active tab's box rather
  than stepped, because tabs are as wide as their titles.
- **The rail and the sidebar are one surface.** They are near-neighbours in tone
  by design; matching alphas does not achieve it, because two surfaces sharing a
  tint but differing in opacity diverge by an amount that depends on what is
  behind the window. The depth comes from glass columns against the more present
  content pane instead — which is why the gap between the two is asserted rather
  than admired.
- **The window is two shades, and the bar is made of both.** It was three for a
  while — the columns, a bar with a tint of its own, the pane — and that stacks
  the window in a T: two columns below and a band laid over the top of them. Two
  columns running the full height is the shape the thing actually has. Deleting
  `panel-bar` is part of the rule: a material nothing wears is a material
  somebody will wear again.
- **A conversation card is a job card.** Not a resemblance — the same object: a
  thing that ran, has a name you can change, and can be thrown away. It drifted
  once, into a row with a sparkle glyph on it saying "this is a chat" in a list
  of nothing but chats, a delete button in the text flow, and two timestamps
  that wrapped onto a second line on one card in three so that card stood taller
  than its neighbours. Two lines of room for the name whether or not both are
  used, one time rather than two, and the tools as an overlay: a column of
  even rows can be swept, where a column of three different heights has to be
  read.
- **Every panel searches from the same row.** The chats list carried a field of
  its own, which left the panel header holding nothing but a `+` floating
  against the right edge — a band of empty sidebar, and a button with no row to
  belong to. Two fields in two places across five panels is two things to learn
  where there was one.
- **Sizes come from the density scale.** Use the `--gap-*`, `--row-h`,
  `--field-h` custom properties rather than fixed pixels, and express spacing in
  `rem` so a larger OS text size scales the layout instead of breaking it.
- **A virtualised list turns off scroll anchoring.** The browser holds a scroll
  position steady by adjusting `scrollTop` when content above the anchor changes
  size — which is a good default and the exact opposite of what a recycler
  wants, because every scroll *is* that content changing.
- **A menu opened from a button is closed by that button.** Dismissal happens
  at the window in the capture phase, so a press on the trigger closed the menu
  before the trigger's own click handler ran, and the handler opened it straight
  back up — pressing twice looked like pressing nothing. `ContextMenu` takes a
  `trigger` so the dismisser leaves it alone and the control can simply toggle.
  A menu opened at a pointer has no trigger and wants none.
- **Escape dismisses the top overlay, and only that one.** Overlays register
  with `useDismiss` rather than listening themselves. Every one of them used to,
  at the window and in the capture phase, each for the same good reason — a
  panel that waits for the key to bubble out of itself stops closing the moment
  focus lands elsewhere, which is when people reach for Escape. But listeners on
  one node in one phase all run, and `stopPropagation` does not stop the
  siblings beside it, so one press collapsed the whole pile.
- **The bar is one material when the sidebar is shut.** Expanded, it is divided
  where the columns end and the seam is nowhere near the window controls.
  Collapsed, the columns are the rail alone — narrower than the traffic lights —
  so that same seam would fall directly under them. So the strip wears the
  columns' material instead of the pane's, and there is no boundary under the
  controls because there is no second material in the bar to have one with.
  Making the strip *transparent* there is the mistake that looks like the same
  idea: it shows the window's own material, which against an opaque pane reads
  as a floating band.
- **The pane's corner is cut, and what it cuts away is filled.** An arc taken
  out of an opaque pane shows whatever is behind it, and behind it is the root —
  transparent, so the notch showed the material the OS draws *outside* the
  window: raw, where the column an eighth of an inch away shows it tinted. That
  patch is the rectangle behind the rounded corner. A wedge wearing the columns'
  own material fills it, masked to the arc so it never laps over the pane —
  glass laid on an opaque surface composites against *it* and comes out a shade
  off the bar it is matching. Only while the sidebar is shut: open, the pane's
  top edge is the strip wearing the pane's own material, and a corner between
  them is a seam inside one surface.
- **The working pane is square while the sidebar is open.** There was one
  rounded corner where it met the chrome, backed by a masked wedge of the sidebar's own surface so the arc did
  not show the material the OS draws *outside* the window — raw, where the
  column an eighth of an inch away showed it blurred and tinted. It softened the
  one place the opaque pane butted into something above it, and there is no such
  place now: the strip wears the pane's surface and sits directly on it, so the
  two are one column with a row of tabs at the top rather than two things
  meeting at a corner. If a rounded clip ever comes back over a *composited*
  child it must be a `clip-path`, not `overflow`: Chromium drops an ancestor's
  rounded overflow clip on a layer of its own, Monaco promotes itself, and the
  corner was correspondingly cut on a table tab and square on a query tab. A
  corner was tried again for the collapsed state and failed the same way from
  the other side: an arc over an opaque surface shows whatever is behind it, and
  the columns' square edge sat in the gap — the rectangle behind the rounded
  corner.
- **The grid's column widths are measured in a canvas, never by the layout.**
  Tabulator's `fitData` family sizes a column by clearing its width and reading
  `offsetWidth` off every cell — a forced reflow each — and `fitDataStretch`
  does it for every column on *every* layout rather than only when asked. Widths
  come from text metrics over a sample of rows instead, and the mode is plain
  `fitData` so nothing refits behind our back.
- **A width change does not redraw the grid; a height change does.** The rows do
  not depend on how wide the pane is — the columns carry their own widths and
  the pane simply shows more or less of them, so all a wider pane needs is the
  last column taking up the slack. The virtual renderer decides how many rows to
  draw from the height it has, so that one has to be answered. Either way it is
  answered once the size stops changing, not on every frame of a panel
  animation, and Tabulator's own `autoResize` observer is off because it was a
  second observer answering the same frames.
- **A pane that comes back the size it left needs no relayout.** The grid's
  layout is `fitDataStretch`, so a full redraw measures the widest content in
  every column across every loaded row. Hiding a tab takes its box to zero and
  showing it brings back exactly the box it had, and the container's observer
  fires on both edges — so the redraw is guarded on the geometry actually
  changing, coalesced to one a frame, and only full when the *width* moved.
- **A sheet is the size of what is in it, and animates when that changes.** It
  used to take one fixed height, so that content arriving late could not resize
  it under the reader — which bought that at the cost of a popup with six facts
  in it reserving the room for forty and sitting two thirds empty. The objection
  is answered where it belongs instead: the height follows the content, the
  change is animated on a decelerating curve, and the scrim centres the panel so
  it grows about its middle rather than dropping its foot. Past 80% of the
  viewport it stops and the body scrolls. Every sheet does this, including the
  ones holding a surface rather than a form: a diagram draws at the size it was
  laid out for and the window fits it, and the one thing with no natural height
  — a text editor, which is a window onto a document and would grow by a line
  per line typed — is given a definite height in the *content* so the sheet can
  measure that like it measures anything else. Measure the *wrapper*, never the
  panel or the body: those are the boxes being constrained, and `scrollHeight`
  is never smaller than the box it is read from, so a panel already holding a
  height reports that height as its content's and every sheet could grow while
  none could shrink. Taking the constraint off to measure and putting it
  straight back is worse — reading a layout property flushes style, so the
  browser takes the natural height as the one the transition starts from and
  the sheet jumps, animating from its new size to itself. Measure again when
  the last transition in the sheet ends: measuring content resizes the panel
  and resizing the panel resizes the content's box, and Chromium's observer
  loop protection cuts that round trip off partway — which left a popup seven
  pixels short of a list that had grown while it was opening.
- **A list inside a popup scrolls inside its own card.** The sheet's body is a
  scroller of last resort: let a list grow instead and a table with forty
  columns hands the scrolling to the whole popup, which puts a track down the
  side of it and carries the tab row off the top. The cap is a `max-height`
  rather than a height, so three columns still make a popup three rows tall.
  Whether the body scrolls at all is decided from the measurement rather than
  left to `overflow: auto`: a classic scrollbar takes its width out of the
  content, so a body overflowing by a few pixels narrows its own text, wraps a
  line, and overflows further.
- **A statement is one container, and the model says which ones open.** A turn
  that answers a question properly may run four queries on the way to it, and
  four tables of intermediate counting bury the one table that was asked for —
  so `run_sql` carries an `intent`, and the model declares each query as working
  or as the answer. A working query collapses to one row: its name, what it
  returned, a chevron at the end. Both open onto the *same* thing — one
  `SqlBlock`, coloured by `shared/sqlHighlight.ts`, with copy and open-in-a-tab.
  What opens *first* is the rows: someone expanding a query that ran wants to
  see what came back, and the SQL is how it came back — a different question and
  a rarer one — so it sits behind a second fold inside the first, and closing
  the outer one closes it too. A step with no rows to put in front of it shows
  its statement directly; a fold kept for the sake of symmetry is two clicks to
  reach the one thing there is. Two containers for one idea is how an interface
  starts reading as assembled rather than designed. The fold is a third state,
  not a boolean seeded from the intent: a step is emitted the moment the call
  starts and updated when it returns, so a fold initialised from the early value
  snaps shut under a reader who had already opened it. A model that omits the
  intent is read as still working, which is the quieter mistake — an answer
  shown as working is one chevron away, where the reverse is a table nobody
  asked for.
- **A fold fades its content in; it does not only grow a box.** Height alone was
  the whole animation, and a box growing to reveal content already at full
  opacity reads as a clipping mask sliding off rather than as something
  appearing — the table's first row is fully drawn before there is room for a
  second. Opacity and a quarter-rem of travel give it somewhere to come from,
  both composited, so a table with two hundred cells costs no more to reveal
  than an empty box. The travel goes *with* the edge that is moving, not
  against it.
- **A transcript is a document; the chrome around it is not.** The root sets
  `user-select: none`, which is what stops a drag across the sidebar painting
  half the tree blue — and the one view in this app made of prose, statements
  and someone's own rows has to opt back in. `.selectable` does that, and its
  own controls opt out again: a chevron whose label highlights on a double click
  is a control in the one place where double-clicking a word is how a word gets
  selected.
- **A statement is laid out before it is shown.** A model writes SQL the way it
  writes a sentence — one long line, or whatever indentation the last example it
  saw happened to use — and the statement is the part of an answer people read
  closely. `SqlBlock` runs it through the same `sql-formatter` call and the same
  `formatterDialect` table the query tab's Format button uses, so a statement
  lifted out of a conversation looks like one typed into an editor, and the copy
  and the tab both get the laid-out text. A parse failure falls back to what the
  model wrote, silently: the button says so because somebody pressed it and
  nothing happened, where here the statement is on screen and correct either way.
- **A tab is named for what is in it.** The statement lifted out of a
  conversation opens under the name the model gave that query — "Albums per
  artist" — never under a label about where it came from. A strip of tabs all
  called "From the assistant" tells the reader the one thing they already know
  while withholding the one thing they need. That name is asked for in the
  prompt (`purpose` on the tool, `title=` on a fence) rather than derived from
  the SQL, because the model knows what it was counting and a parser does not.
- **An icon-only control carries a drawn label, not a `title`.** The OS tooltip
  arrives after a second and a half, in a corner of its own choosing, styled by
  the platform. `v-tip` from `lib/hoverTip.ts` puts it beside the control, on
  focus as well as hover — and skips the delay while another is already up,
  because moving along a row of icons is one gesture.
- **A shortcut is changed by performing it, and nothing is written until you
  say so.** The recorder takes the keyboard in the capture phase and stops the
  event dead, because the chord somebody is most likely to rebind is one the app
  already acts on — ⌘K cannot be recorded by an app that opens its palette on
  ⌘K. The tick is what commits: a chord written the instant a key lands cannot
  be corrected, because the correction is itself a keystroke. `mod` is resolved
  from one `isMac` shared by the recorder and by `displayKeys`; two sources
  there record a chord under one platform's rules and draw it under the other's.
  Overrides are stored, never the whole map — a keymap outlives the build it was
  written in, and someone who changed one shortcut in an old version must not be
  pinned to that version's defaults for every other one.
- **The first round trip is a warm-up, and it is thrown away.** It pays for
  everything both ends do lazily — a driver's statement cache, a pool handing
  back a parked connection, a TLS session resuming — and measured with the rest
  it was twenty-five times the median every time, which made every healthy
  connection report itself as erratic. Discarding it is honest only if it is
  *said*, so the count under the chart is the count of trips kept. There is no
  p95 beside it either: the nearest-rank 95th of fifteen samples is the
  fourteenth, so the one terrible trip that is the whole reason to look at a
  tail falls outside it. At this sample size the honest tail is the worst trip.
- **A verdict's colour agrees with its words.** The sheet drew a green tick
  beside "erratic — some trips take far longer than others", because the tone
  was a constant and only the sentence was derived. Colour is the part read
  first and from furthest away.
- **Feedback lands on `pointerdown`,** not on click.
- **The cost of telling two gestures apart is paid where they overlap, and
  nowhere else.** A job card opens on one click and its name renames on two, so
  the *name* waits out the double-click interval before opening while the rest
  of the card opens at once. Charged to the whole card, that quarter-second is
  added to the commonest action there is; charged nowhere, the rename could not
  be reached at all on a finished job — the first click opened its tab, the grid
  inside took the caret, and the box that had just opened blurred and committed
  before a key could reach it.
- **Anything draggable tracks the pointer one to one,** preserves the grab
  offset, resists at its limits, and hands its release velocity to the spring
  that follows. `useDrag` does all of this; use it rather than a `mousemove`
  handler.
- **A drag that rearranges a list captures the pointer on the list, not on the
  item.** The capture normally goes on whatever the gesture started on, which is
  right for a handle — it is the thing being moved and it stays where it is —
  and wrong for a reorder, because applying one moves the dragged element in the
  DOM and a node that leaves the document, even for the instant it takes to
  reinsert it, loses its capture. The tab strip was exactly this: the first
  reorder landed and the gesture died there, so a tab could be carried one place
  and no further. `useDrag`'s `surface` points the capture at an ancestor that
  does not move.
- **A reorder counts what it has already done.** The drag reports the *total*
  distance from where the pointer went down, so the number of places to move is
  `round(total / width)` — but the list has already been rearranged by the
  previous frame, and applying that same total again against the item's new
  index moves it twice, then four times. Keep the count: what the pointer is
  asking for is a function of the total, what has been done is the count, and
  the difference is what to do now. Bounds come from the index the item was
  *picked up* at, never from where it currently is — bounds that move with it
  shrink under the drag and clamp it after a single place.
- **Every animation must survive `prefers-reduced-motion`,** every translucent
  surface must survive `prefers-reduced-transparency`, and every colour pair must
  clear its contrast threshold.

## The assistant

- **It reads. It does not write.** That is the whole trust proposition, and it
  is enforced in `src/ai/agent.ts` rather than asked for in the prompt: every
  statement is classified by `shared/sqlSafety.ts` before it reaches a database,
  and only a `read` runs. Anything else — including a statement whose leading
  verb we do not recognise — comes back as SQL in the conversation with an offer
  to open it in a query tab. The alternative considered and rejected was a
  permission prompt per statement: one that appears for `SELECT 1` is one people
  learn to click through, so the time it says `DROP` they click through that
  too. A rule told once beats a dialog nobody reads.
- **One door to the assistant, not two.** A row's menu offered "Ask for a
  query…" beside "Chat" — a one-shot request that wrote a statement into a new
  tab, and a conversation. The first was the lesser of the two in every case
  that mattered: it could not look at a row before answering, could not be told
  it had misread the question, and produced a statement whose only recourse was
  to ask again from the beginning. Everything it did, a conversation does on its
  first turn and then keeps doing. It is gone — the sheet, the `ai/ask` channel,
  `runAsk` and the extractor behind it — rather than merely unreachable, because
  the menu was its only door. Two entries to one room, one of them narrower,
  makes the reader choose before they know enough to choose.
- **The refusal tells the model what to do instead.** "Denied" produces an
  apology and a stop; the wording in `runSql` produces the statement written out
  for the reader. It is asserted in the unit suite because it is load-bearing.
- **A driver is an implementation; an instance is a configuration.** Ported from
  the sibling project. `AI_DRIVERS` in `shared/aiDrivers.ts` is what the
  interface can offer and `src/ai/registry.ts` is what the host can build; they
  name the same set, and a row in one without the other is a menu item that
  fails when chosen. Two accounts of one provider are two instances, not a
  setting toggled back and forth.
- **Provider differences are declared, not thrown** — the same rule the database
  drivers follow. Claude Code declares `tools: false` because our tools are
  functions in this process and handing them to a subprocess would mean standing
  up an MCP server; the agent reads the capability and asks for a query without
  offering to run one. It is not a defect to be fixed by a `try`.
- **Keys go keyring → main → host, and the renderer gets a handle.** Exactly the
  arrangement `prepareConnection` uses, down to the single-use handle. The one
  deliberate exception is the same one the connection editor takes: the provider
  editor shows the key it already holds, because a field that hides its value
  turns changing a model name into an act of finding your API key again.
- **Claude Code is driven as a subprocess, and its credentials are never read.**
  It signs itself in. `--system-prompt` replaces the built-in prompt, `--tools`
  with nothing after it leaves the session with no tools, and empty
  `--setting-sources` plus `--strict-mcp-config` keep the reader's own memory
  files and MCP servers out of a prompt about their database. It runs in a temp
  directory for the same reason.
- **A document narrower than the database says so.** `narrowSchemaDocument`
  drops whole tables rather than trimming columns — a table with half its
  columns is worse than an absent one, because the model cannot tell "this
  column does not exist" from "you were not shown it" — and writes what it
  dropped into `omissions`, which the prompt reads out. Relations to tables that
  did not make it are pruned with them, so the document never references
  something it does not contain. The same rule the statistics view follows: the
  caveat goes where the answer is, not in a footnote.
- **Gathering a schema is bounded, because it is N+1.** Columns, indexes and
  relations are a round trip per entity, so six hundred tables is eighteen
  hundred queries before a word has been sent. `src/ai/schema.ts` caps the
  depth, says so in the document, and lets `inspect_schema` read any table in
  full on demand.
- **The reply's language defaults to the interface's, and is decided by the
  question.** The distinction is the rule: an interface in Japanese does not
  mean the question was asked in Japanese, and answering in a language the
  question was not asked in is worse than any amount of not knowing which to
  use. So the question decides, and the interface's language settles what the
  question cannot — one word, or a bare table name. The tag comes from the
  renderer in the `ai/turn` payload, because it is a renderer setting and a
  utility process's own OS locale is not the one anybody chose. And identifiers
  are exempted explicitly: told to answer in Chinese, a model will translate
  `play_count` in the prose around a query and leave the reader hunting for a
  column that does not exist.
- **Types are the engine's own spelling.** A model writing `::jsonb` has been
  told it is talking to Postgres by the data rather than by an adjective.
- **A tool call closes off whatever is streaming.** An adapter that runs its own
  tools — Claude Code does, over the loopback bridge — streams prose, calls a
  tool, and goes on streaming, all inside one `send`. The text item is created
  on the first delta, so without this it is appended to for the whole session
  and a sentence written *after* a query lands above the table that query
  returned: the reader sees "here are the results" with nothing under it, and
  the table arrives above the sentence a moment later. The round's text is
  accumulated separately from the item's buffer, because closing an item empties
  that buffer and the wire message still has to carry the whole of what the
  model said.
- **Text streams as one item and is split when it stops.** Re-parsing fences on
  every token means re-rendering a half-arrived code block many times a second;
  the agent emits one text item, streams into it, and replaces it with its parts
  once the round is done.
- **The transcript follows the bottom only while the reader is at it.** Scrolling
  up to re-read something must not be undone by the next token. Jumped, never
  smooth-scrolled — a smooth scroll re-requested every few milliseconds never
  arrives anywhere.
- **A conversation is not persisted.** It would be a copy of whatever rows the
  assistant read on the way to an answer, sitting in the application database
  beside the connection list. What is worth keeping out of a chat is a query,
  and a query has a query tab.

## The storybook

- **Every component has a story**, in `*.stories.ts` beside it. It is not a
  gallery: it is the only place several of these can be looked at in a state
  that is hard to reach in the app — a grid with two thousand rows, a chat that
  refused a write, a card whose name is long enough to wrap.
- **A story is a *store*, not an argument list**, for the many components that
  read one and draw it. `.storybook/seed.ts` puts a store into the state a story
  is about; the setup does not belong in each file.
- **`window.shelf` and the host client are faked, not stubbed.**
  `.storybook/mocks/shelf.ts` is typed as `ShelfApi`, so a channel added to the
  preload script and not added there is a type error. It *remembers* what is
  written to it, because a bridge that forgets everything can only ever show the
  empty state. `mocks/host.ts` answers from fixtures with deliberate latency —
  resolving synchronously would hide every skeleton in the app.
- **`make storybook-check` opens all of them and fails on any that throws or
  draws nothing.** A storybook that builds is not a storybook that works; the
  first run of that check found twelve broken stories and a mock that had fallen
  a feature behind the preload script. It looks at the whole document rather
  than the story's container, because half the surfaces here are teleported.
- **Two stories are deliberately less than the component can do**, and say so in
  their own docblock: `TableTab` is shown without its grid populated and
  `QueryTab` without a multi-statement script, because Storybook mounts a story
  more than once while settling and the second pass patches Vue's tree around
  DOM that Tabulator and Monaco own. Both were checked against the built app
  with a page-error listener attached before that note was written. The
  populated versions live in `Pages/Workspace`.

## Statistics

- **Per-statement timings are cumulative, and the app supplies the history.**
  `pg_stat_statements` and MySQL's digest table both hold one running total per
  statement since the counters were last reset, so "the last hour" does not
  exist to be asked for. Readings are stored per connection and differenced —
  `src/shared/queryStats.ts`, which is pure and unit tested because an off-by-one
  in a difference produces a plausible number rather than an error.
- **A window wider than the history says so.** Presenting a narrower answer as
  the one that was asked for is the one thing that view must not do, so the
  caveat is a line of prose above the chart rather than a footnote.
- **A counter that went backwards means a reset**, and every earlier reading is
  then a baseline that would produce negative deltas. The history is truncated
  at the reset rather than filtered at each read.

## Testing

- Pure logic — SQL generation, colour maths, motion physics, schema documents,
  statement classification, accelerators — is unit tested.
- Anything touching `better-sqlite3` cannot run under plain Node, because the
  module is compiled against Electron's ABI. Cover it with an end-to-end test
  instead.
- **Test runs are invisible.** Under `SHELF_E2E` the window is never shown at
  all: Electron paints an unshown window, and Playwright drives it and captures
  screenshots over the debugging protocol, which needs neither an on-screen
  window nor OS focus. `backgroundThrottling` is off so a window nobody is
  looking at still settles its layout and animations.
- End-to-end tests run against the *built* app and use a throwaway user-data
  directory, so they never touch real saved connections.
- **The assistant's rule is tested with a hostile model, not a real one.** A
  well-behaved model never breaks it, so `tests/unit/assistant.test.ts` scripts
  an adapter that insists on running a `DELETE` and asks twice. `make
  test-assistant` is the other half — a real model, end to end, through the
  Claude Code CLI — and is deliberately outside `make test`: it spends money,
  needs the CLI signed in, and can fail because a network is down. It skips
  itself rather than failing where the CLI is absent.
- **`make ui` is the design gate**, and it is the one to extend when a visual
  bug is found by eye: add the invariant that names it, in
  `tests/ui/invariants.spec.ts`, so it cannot come back silently. Each invariant
  there corresponds to a defect that actually shipped.
- Screenshots are the backstop for what an invariant cannot name. They are
  captured with `omitBackground`, which means they record element-level
  translucency but are blind to the *root* background — that one is covered by
  an invariant instead.

## How to write

Direct and plain. Write so a non-native speaker gets it on the first read.

- Paragraphs are one to three sentences. Bullets are for distinct items, never
  for prose broken into pieces.
- No opening pleasantries, no closing summary, no "Moreover", "Furthermore",
  "In summary".
- Banned: delve, tapestry, testament, realm, navigate, foster, intricate,
  dynamic, holistic, landscape.
- Technical answers put the code first and the explanation after it. Keep code
  comments functional; do not explain how the language works.
- When comparing options, show them side by side with the real trade-offs. Do
  not blend them into one compromise.

This is about the prose *around* the work — chat replies, PR descriptions,
issue comments. It is not about the comments in this codebase, which are
deliberately long because they carry the reason a line is the way it is.

## Commits

**Every commit follows Conventional Commits.** `type(scope): summary`, where the
type is one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`,
`ci`, `style` or `chore`, and a breaking change is marked `!` before the colon
with a `BREAKING CHANGE:` footer. The scope is the part of the app the change is
about — `assistant`, `grid`, `drivers`, `i18n`, `gate` — and is omitted rather
than invented when a change is genuinely global.

The subject line is the machine-readable half and it is deliberately dull.
Everything this repository's commit messages are actually for goes in the body:
what was wrong, what was tried, and why the chosen fix is the one that holds. A
subject that says `fix(tabs): a tab dragged one width moved two places` and a
body that explains that the drag reports a total while the list had already
moved is worth more than either half alone.

One idea per commit. If the body needs the word "also", it is two commits —
unless the parts genuinely cannot compile apart, which is worth saying in the
body rather than working around.

## Style

Google's TypeScript style guide, 2-space indent, single quotes, named exports.
Comments explain *why*, not *what* — if a line needs a comment to say what it
does, rewrite the line.

**Prettier owns line breaking, and the gate checks it.** It did not, and
nothing said so: `tidy.sh` ran prettier and then `eslint --fix`, and
`vue/max-attributes-per-line` re-expanded every multi-attribute tag prettier
had just collapsed. ESLint won because it ran last, `make` never ran
`prettier --check`, and sixty-eight files sat permanently unformatted while the
gate was green. Two formatters cannot both be right; with eslint-plugin-vue gone
there is one, and `make lint` checks it.

**The linter is oxlint, and it runs `correctness` only.** Adopting a linter is
not adopting its opinions: ESLint here ran the recommended sets and five named
rules, so that is what `.oxlintrc.json` reproduces. `unicorn`'s pedantic and
style categories are off — `no-await-in-loop` alone fires ninety times on code
that is sequential on purpose, and `no-useless-spread` cannot tell a redundant
copy from a defensive one, which in `closeOthers` is a snapshot of a list the
loop mutates.

**What ESLint took with it, and where it went.** `vue/no-undef-components` has
no equivalent: oxlint reads a `.vue` file's script and does not look inside its
template, and `vue-tsc` does not see the tag either — both measured before the
swap, not assumed. Nothing is registered globally here, so a component the
template names and the script never imported renders as *nothing at all*, which
is how the Export sheet shipped unopenable. `tests/unit/vueComponents.test.ts`
is that rule now.
