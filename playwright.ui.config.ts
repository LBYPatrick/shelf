import { defineConfig } from '@playwright/test';

/**
 * The UI quality gate.
 *
 * Separate from the functional suite because it asks a different question:
 * not "does this work" but "does this look and behave like one designed thing".
 * It runs the same app, and fails on the classes of defect that kept slipping
 * through review — clipped content, misaligned headers, unstyled native
 * controls, unreachable contrast, motion that ignores the user's preference.
 */
export default defineConfig({
  testDir: './tests/ui',
  /*
   * The screenshots are a local gate, not a CI one.
   *
   * A pixel is a function of the rasteriser that drew it, and a GitHub runner
   * is not the machine the baselines were taken on — a different macOS, a
   * different font set, a different backing scale. The differences measure two
   * to seven per cent of the image, which is not antialiasing noise and is not
   * something a threshold can be widened past without also swallowing the
   * regressions these exist to catch.
   *
   * Regenerating them on the runner instead would trade one problem for two:
   * baselines nobody can review by eye, and a suite that goes red every time
   * the runner image is updated. And a screenshot is the one test here that
   * needs a person — `ui-accept` exists because the answer to a diff is
   * *look at it*, and nothing on CI looks at anything.
   *
   * What CI keeps is the half that measures rather than photographs. Every
   * rule the screenshots back up has an invariant beside it for exactly this
   * reason.
   */
  testIgnore: process.env['CI'] ? ['**/visual.spec.ts'] : [],
  /*
   * One retry, for launching rather than for asserting.
   *
   * Every test here starts a whole Electron app, and on a shared runner one
   * occasionally fails to start at all — `Process failed to launch!`, before a
   * line of the test has run. That is the machine, not the app. An assertion
   * that fails twice in a row is still a failure.
   */
  retries: process.env['CI'] ? 1 : 0,
  // Each test launches its own app against its own user-data directory, so
  // nothing here is shared and nothing has to be serialised. See the note in
  // `playwright.config.ts`.
  fullyParallel: true,
  /*
   * Fewer in CI than the machine could nominally take. A runner has three
   * cores and every test is a whole Electron app: at four, three of them
   * failed to launch at all rather than failing an assertion, which is the
   * shape of a suite that has been asked for more than the box has.
   */
  workers: process.env['CI'] ? 2 : '75%',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Anti-aliasing differs by a hair between runs; a real change moves far
      // more pixels than this.
      maxDiffPixelRatio: 0.01,
      /*
       * Playwright's default per-pixel tolerance is 0.2, which is loose enough
       * to swallow a whole surface changing shade — the panel shades differ by
       * a few percent lightness by design, and at 0.2 swapping one for another
       * compared equal. Tight enough to see that, still loose enough not to
       * trip on subpixel text rendering.
       */
      threshold: 0.05,
      // Motion is disabled during capture, so any remaining difference is real.
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      /*
       * Keep the alpha channel. Without this the capture is composited onto
       * white, and since the light theme's base surface is very nearly white
       * too, every translucent surface in the app photographs as opaque — the
       * screenshots were blind to the entire material layer, which is a large
       * part of what they exist to protect.
       */
      omitBackground: true,
    },
  },
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
});
