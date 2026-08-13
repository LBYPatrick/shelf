/**
 * Accessibility audit.
 *
 * axe-core over each screen the app can be in, at the full WCAG 2.1 AA rule
 * set rather than a curated subset: the point of a gate is that it fails on
 * things nobody thought to check for.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setAppearance, stabilize, test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/*
 * axe is injected by hand rather than through @axe-core/playwright, for two
 * reasons: the wrapper opens a second page to bootstrap itself and Electron
 * does not support that, and the app ships a `script-src 'self'` policy that
 * blocks an injected tag. `page.evaluate` runs through the debugger, so it is
 * subject to neither.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8');

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/** Only the parts of axe's result this gate reads. */
interface AxeNode {
  html: string;
}

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: AxeNode[];
}

interface AxeApi {
  run(context: unknown, options: unknown): Promise<{ violations: AxeViolation[] }>;
}

/**
 * Colour contrast is measured in `invariants.spec.ts` instead. axe reads it off
 * a screenshot, and over a translucent surface backed by desktop vibrancy that
 * means it reads whatever wallpaper is behind the window — not reproducible,
 * and not a real finding.
 */
async function audit(page: Page, within?: string): Promise<Violation[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: AxeApi }).axe;
    const results = await axe.run(selector ? { include: [selector] } : document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.html.slice(0, 120)),
    }));
  }, within);
}

test('the start screen is accessible', async ({ page }) => {
  await stabilize(page);
  expect(await audit(page)).toEqual([]);
});

test('the workspace is accessible', async ({ sample }) => {
  await stabilize(sample);
  expect(await audit(sample)).toEqual([]);
});

test('the settings sheet is accessible', async ({ sample }) => {
  await sample.getByRole('button', { name: /settings/i }).click();
  await sample.getByRole('dialog').waitFor();
  await stabilize(sample);
  expect(await audit(sample, '[role=dialog]')).toEqual([]);
});

test('the command palette is accessible', async ({ sample }) => {
  await sample.keyboard.press('Meta+k');
  await sample.getByRole('dialog').waitFor();
  await stabilize(sample);
  expect(await audit(sample, '[role=dialog]')).toEqual([]);
});

test('the workspace is accessible in dark mode', async ({ page }) => {
  await setAppearance(page, 'dark');
  await page
    .getByRole('button', { name: /sample/i })
    .first()
    .click();
  await page.locator('.workspace').waitFor({ timeout: 30_000 });
  await stabilize(page);
  expect(await audit(page)).toEqual([]);
});

test('every screen is reachable with the keyboard alone', async ({ page }) => {
  // A focus trap or an unreachable primary action is invisible to axe but
  // fatal in use, so it is walked rather than inspected.
  await stabilize(page);
  const reached = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      return `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60);
    });
    if (id) reached.add(id);
  }
  // The start screen offers: sample data, new connection, settings, and the
  // connection list itself.
  expect(reached.size).toBeGreaterThanOrEqual(3);
});

test('focus is always visible', async ({ sample }) => {
  await stabilize(sample);
  const invisible: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    await sample.keyboard.press('Tab');
    const finding = await sample.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      /*
       * Three acceptable forms, because the app uses all three: a ring, a cast
       * shadow, or a tint of the control's own surface. The tint is applied as
       * a background-image over whatever colour the control already carries,
       * which is what makes it composite correctly on a coloured button.
       */
      const indicated =
        (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== 'none' ||
        style.backgroundImage !== 'none';
      return indicated ? null : `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60);
    });
    if (finding) invisible.push(finding);
  }
  expect([...new Set(invisible)]).toEqual([]);
});
