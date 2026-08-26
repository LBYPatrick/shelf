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
  // Each test launches its own app against its own user-data directory, so
  // nothing here is shared and nothing has to be serialised. See the note in
  // `playwright.config.ts`.
  fullyParallel: true,
  workers: process.env['CI'] ? 4 : '75%',
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
