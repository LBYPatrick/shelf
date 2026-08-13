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
- **A scrim dims; the surface on it blurs. Never both.** A blurred backdrop has
  already flattened what is behind it, so the glass on top has nothing left to
  refract and reads as flat tint — and it costs two full-screen backdrop filters
  per frame for one result. Use `.surface-sheet` (48px) or `.surface-popover`
  (28px); bigger surfaces read as thicker.
- **Tab toolbars are one definition**, in `styles/controls.css`. Everything in
  the row is the same height and shape; *loudness* carries the difference —
  quiet by default, a tonal surface for a mode that is on, and a filled accent
  for the one action that commits, never more than one per bar.
- **Never take a framework component's class name.** daisyUI ships `.select`,
  `.input`, `.btn`, `.card`; a component of ours wearing one inherits its
  border, height and width clamp on top of whatever we drew. The gate fails on
  this.
- **Never hardcode a colour.** Everything comes from the tokens in
  `src/renderer/styles/`. The accent derivation in `theme.ts` is the single
  source; if you add a semantic colour, add it there and give it a contrast test.
- **Targets have a floor.** `--hit-min` is 28px, the desktop pointer minimum,
  and it sits *outside* the density factor — density changes spacing and how
  much fits on screen, it never shrinks a target below the floor. The grid is
  the single exception, documented where it is declared. iOS's 44pt was tried
  and is the wrong number for a pointer-driven app this dense.
- **Nothing may draw a boundary under the window controls.** They are wider than
  the rail and overhang the sidebar, so a divider or a shade change at that seam
  cuts each control in half. The rail wears the sidebar's shade for exactly the
  height of the strip, via one gradient rather than a second stacked layer.
- **Sizes come from the density scale.** Use the `--gap-*`, `--row-h`,
  `--field-h` custom properties rather than fixed pixels, and express spacing in
  `rem` so a larger OS text size scales the layout instead of breaking it.
- **Feedback lands on `pointerdown`,** not on click.
- **Anything draggable tracks the pointer one to one,** preserves the grab
  offset, resists at its limits, and hands its release velocity to the spring
  that follows. `useDrag` does all of this; use it rather than a `mousemove`
  handler.
- **Every animation must survive `prefers-reduced-motion`,** every translucent
  surface must survive `prefers-reduced-transparency`, and every colour pair must
  clear its contrast threshold.

## Testing

- Pure logic — SQL generation, colour maths, motion physics — is unit tested.
- Anything touching `better-sqlite3` cannot run under plain Node, because the
  module is compiled against Electron's ABI. Cover it with an end-to-end test
  instead.
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
