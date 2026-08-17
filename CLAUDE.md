# CLAUDE.md

Guidance for working in this repository.

## What this is

Shelf is a cross-platform desktop database client: Electron + Vue 3 +
TypeScript, MIT licensed, with no paid tier and no feature gating. If you find
yourself writing a licence check, a capability that is withheld, or an upsell,
that is a bug.

## Commands

```bash
make install     # install everything, rebuild native modules
make dev         # hot-reload development
make build       # typecheck + build all processes
make test        # unit tests (vitest)
make test-e2e    # end-to-end tests against the built app (playwright)
make ui          # UI quality gate: visual, accessibility, design invariants
make ui-accept   # regenerate the visual snapshots — read the diff first
make format      # prettier + eslint --fix
pnpm shots       # screenshot the interface for design review
```

Run `make format`, `make build`, `make test`, `make test-e2e` and `make ui`
before considering a change finished.

## Architecture rules

- **The renderer never imports a driver.** Drivers use Node APIs and native
  modules. If the renderer needs something from `src/drivers`, it is a *type* or
  it belongs in `src/shared`.
- **Secrets never reach the renderer.** Credentials go keyring → main → host.
  The renderer receives a single-use handle from
  `window.shelf.db.prepareConnection` and nothing more.
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
- **The opacity dial subtracts; it does not scale.** Scaling every alpha toward
  zero closes the *gaps* between the surfaces as it thins them, so at the bottom
  of the range the working pane and the columns beside it converge on one colour
  and the window reads as a single flat sheet. An offset moves every surface by
  the same amount, so the distance between any two of them is the distance they
  were designed to have at every position of the slider — and the offset is
  sized so the pane lands on the dial's own number at the floor. A control that
  says 20% while painting 36% is not a control.
- **A setting that changes nothing is worse than no setting.** There was a blur
  radius beside the opacity, and once the modal surfaces went opaque it drove
  nothing at all — so it is gone, not merely unused. Someone will move a dead
  control, see nothing happen, and leave it wherever they let go.
- **Tab toolbars are one definition**, in `styles/controls.css`. Everything in
  the row is the same height and shape; *loudness* carries the difference —
  quiet by default, a tonal surface for a mode that is on, and a filled accent
  for the one action that commits, never more than one per bar.
- **Never take a framework component's class name — or a Tailwind utility's.**
  daisyUI ships `.select`, `.input`, `.btn`, `.card`; a component of ours
  wearing one inherits its border, height and width clamp on top of whatever we
  drew. The utilities bite harder for being one declaration: `.grid` is
  `display: grid`, and a scoped rule that set a table's width and
  `table-layout` but never its `display` did not outrank it — so the structure
  view's table was a grid container, its head and body were blockified into two
  separate anonymous tables, and each sized its own columns. The gate fails on
  both lists.
- **Never hardcode a colour.** Everything comes from the tokens in
  `src/renderer/styles/`. The accent derivation in `theme.ts` is the single
  source; if you add a semantic colour, add it there and give it a contrast test.
- **Targets have a floor.** `--hit-min` is 28px, the desktop pointer minimum,
  and it sits *outside* the density factor — density changes spacing and how
  much fits on screen, it never shrinks a target below the floor. The grid is
  the single exception, documented where it is declared. iOS's 44pt was tried
  and is the wrong number for a pointer-driven app this dense.
- **One bar spans the window, and the window controls sit on it.** The tab strip
  is a region of `.topbar`, not a band inside the content pane. This is what
  makes the controls safe: they are wider than the rail and overhang the
  sidebar, so while any column boundary reached the top edge it ran directly
  under them, and every fix moved the seam rather than removing it. Nothing
  below the bar may be positioned back over it, and no *region* of the bar may
  carry a shade of its own — a tint across part of one bar is the same line
  again. A control's own selected state is not a region; a track behind a group
  of them is.
- **The open tab is tonal, and one marker travels between them.** A raised thumb
  is only legible as raised against the recessed track it came out of, and the
  bar may not carry a track — so the elevation was a card hovering over nothing,
  which is how it read. The marker is measured from the active tab's box rather
  than stepped, because tabs are as wide as their titles.
- **The rail and the sidebar are one surface.** They are near-neighbours in tone
  by design; matching alphas does not achieve it, because two surfaces sharing a
  tint but differing in opacity diverge by an amount that depends on what is
  behind the window. The depth comes from glass columns against the opaque
  content pane instead, and from the one rounded corner where the three meet.
- **Sizes come from the density scale.** Use the `--gap-*`, `--row-h`,
  `--field-h` custom properties rather than fixed pixels, and express spacing in
  `rem` so a larger OS text size scales the layout instead of breaking it.
- **A virtualised list turns off scroll anchoring.** The browser holds a scroll
  position steady by adjusting `scrollTop` when content above the anchor changes
  size — which is a good default and the exact opposite of what a recycler
  wants, because every scroll *is* that content changing.
- **Escape dismisses the top overlay, and only that one.** Overlays register
  with `useDismiss` rather than listening themselves. Every one of them used to,
  at the window and in the capture phase, each for the same good reason — a
  panel that waits for the key to bubble out of itself stops closing the moment
  focus lands elsewhere, which is when people reach for Escape. But listeners on
  one node in one phase all run, and `stopPropagation` does not stop the
  siblings beside it, so one press collapsed the whole pile.
- **A rounded clip over a composited child is a `clip-path`, not `overflow`.**
  Chromium does not apply an ancestor's rounded overflow clip to a descendant
  promoted to its own layer — the clip degrades to a rectangle. Monaco promotes
  itself, so the content pane's corner was cut on a table tab and square on a
  query tab. Sixty-four pixels is far under the snapshot diff threshold, which
  is why it has its own clipped screenshot rather than relying on the full one.
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
- **Feedback lands on `pointerdown`,** not on click.
- **Anything draggable tracks the pointer one to one,** preserves the grab
  offset, resists at its limits, and hands its release velocity to the spring
  that follows. `useDrag` does all of this; use it rather than a `mousemove`
  handler.
- **Every animation must survive `prefers-reduced-motion`,** every translucent
  surface must survive `prefers-reduced-transparency`, and every colour pair must
  clear its contrast threshold.

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

- Pure logic — SQL generation, colour maths, motion physics — is unit tested.
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
- **`make ui` is the design gate**, and it is the one to extend when a visual
  bug is found by eye: add the invariant that names it, in
  `tests/ui/invariants.spec.ts`, so it cannot come back silently. Each invariant
  there corresponds to a defect that actually shipped.
- Screenshots are the backstop for what an invariant cannot name. They are
  captured with `omitBackground`, which means they record element-level
  translucency but are blind to the *root* background — that one is covered by
  an invariant instead.

## Style

Google's TypeScript style guide, 2-space indent, single quotes, named exports.
Comments explain *why*, not *what* — if a line needs a comment to say what it
does, rewrite the line.
