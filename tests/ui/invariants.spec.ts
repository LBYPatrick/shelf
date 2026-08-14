/**
 * Design invariants.
 *
 * Each of these is a bug that shipped at least once and was found by eye. A
 * screenshot test would catch them too, but only by failing with "these pixels
 * differ" — these fail with the reason, which is the difference between a gate
 * that gets fixed and one that gets its snapshots regenerated.
 */
import { setAppearance, stabilize, test, expect } from './fixtures';
import { openTable, revealTables } from '../e2e/helpers';
import type { Page } from '@playwright/test';

test.describe('layout', () => {
  test('nothing overflows the window horizontally', async ({ sample }) => {
    const overflow = await sample.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          // A scroll container is allowed to hold wider content; the grid is
          // exactly that, and clipping it is the intended behaviour.
          const scrolls = getComputedStyle(el).overflowX !== 'visible';
          return !scrolls && box.width > 0 && box.right > limit + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
    });
    expect(overflow).toEqual([]);
  });

  test('the status bar clears the window’s rounded corners', async ({ sample }) => {
    // Shipped broken: the row count on the right and the connection dot on the
    // left were both cut off by the corner radius.
    const clearance = await sample.evaluate(() => {
      const bar = document.querySelector('.statusbar');
      if (!bar) return null;
      const style = getComputedStyle(bar);
      return {
        start: Number.parseFloat(style.paddingInlineStart),
        end: Number.parseFloat(style.paddingInlineEnd),
      };
    });
    expect(clearance).not.toBeNull();
    // The window radius is 10px, so anything less than that clips.
    expect(clearance!.start).toBeGreaterThanOrEqual(10);
    expect(clearance!.end).toBeGreaterThanOrEqual(10);
  });

  test('the status bar truncates instead of running off the edge', async ({ app, sample }) => {
    // Shipped broken: at a narrow window the row count ran past the right edge
    // and was cut mid-character by the window itself.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(880, 560);
    });
    await sample.locator('.sidebar__filter').first().fill('daily_metrics');
    await openTable(sample, 'daily_metrics');
    await sample.locator('.tabulator-row').first().waitFor({ timeout: 20_000 });

    // The pager is the control that has to stay reachable; the row count is the
    // value that has to stay readable. Both are asserted against the bar's own
    // box rather than the window's, so this fails whether the bar overflows or
    // is merely positioned badly inside it.
    const outside = await sample.evaluate(() => {
      const bar = document.querySelector('.statusbar')!;
      const limit = bar.getBoundingClientRect().right;
      return [...bar.querySelectorAll('.status__pager, .status__item')]
        .map((el) => ({
          cls: el.className.toString(),
          right: el.getBoundingClientRect().right,
        }))
        .filter((el) => el.right > limit)
        .map((el) => `${el.cls} ends ${Math.round(el.right - limit)}px past the bar`);
    });
    expect(outside).toEqual([]);
  });

  test('the rail and the connection row share a centre line', async ({ sample }) => {
    // They were positioned independently and landed four pixels apart — close
    // enough to read as a mistake rather than a choice.
    const rows = await sample.evaluate(() => {
      const centre = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? box.top + box.height / 2 : null;
      };
      return {
        icon: centre('.rail__item'),
        connection: centre('.switcher__button'),
        top: document.querySelector('.rail__item')?.getBoundingClientRect().top ?? 0,
      };
    });

    expect(rows.icon).not.toBeNull();
    expect(Math.abs(rows.icon! - rows.connection!)).toBeLessThanOrEqual(1);
    // The traffic lights sit at y=14 and are about 12px tall; anything starting
    // above ~30 would be under them.
    expect(rows.top).toBeGreaterThanOrEqual(32);
  });

  test('nothing sits under the window controls, collapsed or not', async ({ sample }) => {
    /*
     * With the sidebar collapsed the content pane reaches the window's leading
     * edge and the traffic lights float over it, which put the first tab
     * underneath them — overlapping and unclickable.
     */
    await sample
      .getByRole('button', { name: /new query/i })
      .first()
      .click();
    await sample.locator('.monaco-editor').waitFor();
    await sample.locator('.rail__item').first().click();
    await sample.waitForTimeout(400);

    const geometry = await sample.evaluate(() => {
      const inset = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--controls-inset')
      );
      const tab = document.querySelector('.striptab')!.getBoundingClientRect();
      return { inset, tabLeft: tab.left };
    });

    expect(geometry.tabLeft).toBeGreaterThanOrEqual(geometry.inset);
  });

  test('the window can be dragged by its top row', async ({ sample }) => {
    // Everything along the top edge that is not itself a control should move
    // the window; the tabs opt out because they drag to reorder.
    await sample
      .getByRole('button', { name: /new query/i })
      .first()
      .click();
    await sample.locator('.striptab').first().waitFor();

    const regions = await sample.evaluate(() => {
      const region = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        return el ? getComputedStyle(el).webkitAppRegion : null;
      };
      return { strip: region('.strip'), tab: region('.striptab') };
    });

    expect(regions.strip).toBe('drag');
    expect(regions.tab).toBe('no-drag');
  });

  test('no divider crosses the window controls', async ({ sample }) => {
    // Shipped broken: full-height borders on the rail and sidebar ran straight
    // through the traffic lights.
    const offenders = await sample.evaluate(() => {
      const inset = 28; // Traffic lights occupy roughly the top 28px.
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.rail, .sidebar')) {
        const after = getComputedStyle(el, '::after');
        const box = el.getBoundingClientRect();
        if (after.content === 'none') continue;
        const top = box.top + Number.parseFloat(after.insetBlockStart || '0');
        if (top < inset) bad.push(`${el.className}: divider starts at ${top}px`);
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });

  test('each column header sits on the same glyph grid as its values', async ({ sample }) => {
    /*
     * A header set in the UI face over monospace data cannot line up with it:
     * the two have different side bearings, so every label sat a pixel or two
     * off the column it named, and an 11px label over 13px values read as a
     * different kind of thing rather than as that column's name.
     */
    await sample.locator('.sidebar__filter').first().fill('artist');
    await openTable(sample, 'artist');
    await sample.locator('.tabulator-row').first().waitFor({ timeout: 20_000 });

    const type = await sample.evaluate(() => {
      const header = document.querySelector<HTMLElement>(
        '.tabulator-col .tabulator-col-title'
      )!;
      const cell = document.querySelector<HTMLElement>('.tabulator-row .tabulator-cell')!;
      const headerStyle = getComputedStyle(header);
      const cellStyle = getComputedStyle(cell);
      return {
        headerText: header.getBoundingClientRect().left,
        // The cell pads its own box; the header's padding is on its parent.
        cellText: cell.getBoundingClientRect().left + Number.parseFloat(cellStyle.paddingLeft),
        headerFont: headerStyle.fontFamily,
        cellFont: cellStyle.fontFamily,
        headerSize: headerStyle.fontSize,
        cellSize: cellStyle.fontSize,
      };
    });

    expect(type.headerFont).toBe(type.cellFont);
    expect(type.headerSize).toBe(type.cellSize);
    expect(Math.abs(type.headerText - type.cellText)).toBeLessThanOrEqual(1);
  });

  test('the selection outline lands on the selected cell', async ({ sample }) => {
    /*
     * This stylesheet replaces Tabulator's rather than extending it, and the
     * range overlay's *positioning* rules were never carried across — only its
     * colours. So the overlay laid out in normal flow instead of over the
     * cells, and appeared as an empty outlined box below the last row.
     */
    await sample.locator('.sidebar__filter').first().fill('artist');
    await openTable(sample, 'artist');
    await sample.locator('.tabulator-row').first().waitFor({ timeout: 20_000 });

    const cell = sample.locator('.tabulator-row').last().locator('.tabulator-cell').nth(1);
    await cell.click();

    const [target, outline] = await Promise.all([
      cell.boundingBox(),
      sample.locator('.tabulator-range-overlay .tabulator-range').first().boundingBox(),
    ]);

    expect(outline, 'no selection outline was drawn').not.toBeNull();
    expect(Math.abs(outline!.x - target!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(outline!.y - target!.y)).toBeLessThanOrEqual(1);
  });

  test('the tree reserves the height its rows actually take', async ({ sample }) => {
    /*
     * The sidebar is virtualised: a spacer holds the scroll height while only
     * the visible rows exist. The spacer was sized from a hardcoded 24px while
     * a row is `--sidebar-row-h`, which floors at the 28px hit target — six
     * sevenths of the real height. Scrolling stopped short of the end and
     * snapped back, on every tree long enough to scroll.
     *
     * A short tree renders every row, so the spacer and the rows it stands in
     * for have to agree exactly.
     */
    await revealTables(sample);

    const geometry = await sample.evaluate(() => {
      const row = document.querySelector<HTMLElement>('.tree .row');
      const spacer = document.querySelector<HTMLElement>('.tree__spacer');
      if (!row || !spacer) return null;
      return {
        rows: document.querySelectorAll('.tree .row').length,
        rowHeight: row.offsetHeight,
        spacer: spacer.getBoundingClientRect().height,
      };
    });

    expect(geometry, 'the tree rendered no rows to measure').not.toBeNull();
    expect(geometry!.rowHeight).toBeGreaterThan(0);
    expect(geometry!.spacer).toBeCloseTo(geometry!.rows * geometry!.rowHeight, 0);
  });

  test('the grid header stays aligned with its body when scrolled', async ({ sample }) => {
    // Shipped broken, and the reason the whole gate exists: on any table wider
    // than the pane every column label sat over the wrong column, by exactly
    // the scroll distance.
    await sample.locator('.sidebar__filter').first().fill('daily_metrics');
    await openTable(sample, 'daily_metrics');
    await sample.locator('.tabulator-row').first().waitFor({ timeout: 20_000 });

    const holder = sample.locator('.tabulator-tableholder').first();
    const overflow = await holder.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(
      overflow,
      'the table has to be wider than the pane to test anything'
    ).toBeGreaterThan(40);

    await holder.evaluate((el) => {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    });

    await expect
      .poll(async () =>
        sample.evaluate(() => {
          const body = document.querySelector('.tabulator-tableholder');
          const header = document.querySelector('.tabulator-header');
          if (!body || !header) return -1;
          return Math.abs(body.scrollLeft - header.scrollLeft);
        })
      )
      .toBeLessThanOrEqual(1);

    /*
     * And the columns themselves, which is the thing the scroll offsets were
     * only ever standing in for. Equal offsets are not sufficient: the header
     * reserves no room for the body's vertical scrollbar, so it can run out of
     * scroll while agreeing about the number — which is a real misalignment
     * that this assertion catches and the one above cannot.
     */
    const drift = await sample.evaluate(() => {
      const row = document.querySelector('.tabulator-row');
      const cells = [...(row?.querySelectorAll('.tabulator-cell') ?? [])];
      const columns = [...document.querySelectorAll('.tabulator-col')];
      if (cells.length === 0 || cells.length !== columns.length) return -1;

      return Math.max(
        ...cells.map((cell, index) =>
          Math.abs(cell.getBoundingClientRect().x - columns[index]!.getBoundingClientRect().x)
        )
      );
    });

    expect(drift, 'a column label is not over its data').toBeLessThanOrEqual(1);
  });
});

test.describe('materials', () => {
  /*
   * On both appearances, because the failure is appearance-specific and this
   * only ever ran on one. The dark theme's panel tint had lost its selector and
   * merged into the rule below it, which handed the rail the *content* pane's
   * opaque colour while the sidebar beside it stayed pale glass — a hard seam
   * straight under the traffic lights, on the one theme nothing checked.
   */
  for (const appearance of ['light', 'dark'] as const) {
    test(`no surface boundary reads under the window controls (${appearance})`, async ({
      page,
    }) => {
      await setAppearance(page, appearance);
      await page
        .getByRole('button', { name: /sample/i })
        .first()
        .click();
      await page.locator('.workspace').waitFor({ timeout: 30_000 });

      /*
       * The controls are wider than the rail and overhang the sidebar, so a
       * shade change at that seam cuts each one in half.
       *
       * This used to demand the two sides be *identical*, which they were —
       * achieved with a banded gradient that gave the rail the sidebar's tone
       * for the height of the controls. That removed the vertical seam and
       * introduced a horizontal one directly above the first rail icon. The
       * rail is uniform again and the two columns are near-neighbours in tone
       * instead, so what matters is that the step is too small to read, not
       * that it is absent.
       */
      const step = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const luminance = (colour: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = colour;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };

        const strip = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--rail-top')
        );
        const y = Math.max(2, strip / 2);
        const railWidth = document.querySelector('.rail')!.getBoundingClientRect().width;

        const sample_ = (x: number) => {
          for (const el of document.elementsFromPoint(x, y)) {
            const background = getComputedStyle(el).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)') return luminance(background);
          }
          return 0;
        };

        return Math.abs(sample_(railWidth - 4) - sample_(railWidth + 4));
      });

      // A few points of luminance is a change in surface; more is a drawn line.
      expect(step).toBeLessThanOrEqual(5);
    });
  }

  test('the material sliders reach every glass surface', async ({ sample }) => {
    /*
     * Two settings, one job: make every translucent surface in the window go
     * solid, and switch the blur off. The point of the test is *coverage* —
     * the modal surfaces used to carry their own hardcoded alpha and blur in a
     * different stylesheet, so they were the two the sliders could not move.
     */
    const surfaces = ['.rail', '.sidebar', '.statusbar', '.surface-sheet'];
    /*
     * Everything takes the dial upward; only the window's own materials take it
     * down. A sheet thinned to a quarter came within a few points of the window
     * behind it and lost its edge entirely — at which point it is no longer
     * separating anything, which is the one thing a sheet is for.
     */
    const thinnable = ['.rail', '.sidebar', '.statusbar'];

    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    const read = () =>
      sample.evaluate((selectors) => {
        const alphaOf = (colour: string) => {
          const parts = colour.match(/[\d.]+/g) ?? [];
          // `rgba(r g b / a)` and `oklab(l a b / a)` both put alpha last, and a
          // colour with no alpha component is fully opaque.
          return colour.includes('/') || parts.length === 4
            ? Number(parts[parts.length - 1])
            : 1;
        };

        return selectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, found: false, alpha: 0, blurred: false };
          const style = getComputedStyle(element);
          const filter = style.backdropFilter || style.webkitBackdropFilter;
          return {
            selector,
            found: true,
            alpha: alphaOf(style.backgroundColor),
            blurred: /blur\((?!0px)/.test(filter),
          };
        });
      }, surfaces);

    for (const surface of await read()) {
      expect(surface.found, `${surface.selector} is missing`).toBe(true);
      expect(surface.alpha, `${surface.selector} starts opaque`).toBeLessThan(0.95);
      expect(surface.blurred, `${surface.selector} starts unblurred`).toBe(true);
    }

    await sample.getByLabel('Opacity').fill('100');
    await sample.getByLabel('Blur', { exact: true }).fill('0');

    for (const surface of await read()) {
      expect(surface.alpha, `${surface.selector} did not go solid`).toBeGreaterThan(0.99);
      expect(surface.blurred, `${surface.selector} kept its blur`).toBe(false);
    }

    // And the other way: the floor has to still be glass, or it is not a floor.
    await sample.getByLabel('Opacity').fill('20');

    for (const surface of await read()) {
      if (thinnable.includes(surface.selector)) {
        expect(surface.alpha, `${surface.selector} did not thin out`).toBeLessThan(0.6);
      } else {
        expect(surface.alpha, `${surface.selector} thinned past its floor`).toBeGreaterThan(
          0.6
        );
      }
    }

    // And back, so the setting is a preference rather than a one-way door.
    await sample.getByRole('button', { name: 'Reset materials' }).click();

    for (const surface of await read()) {
      expect(surface.alpha, `${surface.selector} did not come back`).toBeLessThan(0.95);
      expect(surface.blurred, `${surface.selector} did not get its blur back`).toBe(true);
    }

    await sample.keyboard.press('Escape');
  });

  test('the page leaves no unpainted gap', async ({ sample }) => {
    /*
     * A region the page does not paint is a hole through which the window's own
     * backdrop shows. On a translucent window that is the desktop, so it lands
     * as a bright line or patch over any light wallpaper — in either theme, and
     * unfixable by adjusting the colours around it, because the page is not
     * drawing it at all.
     *
     * The resize handle was exactly this: a one-pixel column of layout between
     * the sidebar and the content that painted nothing, which read as a bright
     * rule down the full height of the window.
     */
    const gaps = await sample.evaluate(() => {
      /*
       * The whole hit stack, not the ancestor chain: a transparent element may
       * sit over a painted *sibling* rather than a painted parent, which is
       * exactly how the resize handle overlaps the panes on either side of it.
       */
      const painted = (x: number, y: number) =>
        document.elementsFromPoint(x, y).some((el) => {
          if (el === document.body || el === document.documentElement) return false;
          const style = getComputedStyle(el);
          const colour = style.backgroundColor;
          if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return true;
          // The rail paints with a gradient rather than a flat colour, so the
          // window-controls strip can carry the sidebar's shade.
          return style.backgroundImage !== 'none';
        });

      const holes: string[] = [];
      const { clientWidth: w, clientHeight: h } = document.documentElement;
      // Every second pixel across the middle, which is where vertical seams
      // between panels fall, plus a coarse sweep of the rest.
      for (let x = 1; x < w - 1; x += 1) {
        if (!painted(x, Math.round(h / 2))) holes.push(`column ${x}`);
      }
      for (let y = 1; y < h - 1; y += 7) {
        for (const x of [4, Math.round(w / 2), w - 4]) {
          if (!painted(x, y)) holes.push(`point ${x},${y}`);
        }
      }
      return [...new Set(holes)].slice(0, 10);
    });

    expect(gaps).toEqual([]);
  });

  test('every screen paints a surface of its own', async ({ page }) => {
    /*
     * A screen that paints nothing borrows its contrast from whatever is behind
     * the window — which works only while that happens to be dark. The start
     * screen did exactly this: on the dark theme its text is light, so over a
     * bright desktop the title and the "new connection" card were light-on-light
     * and effectively invisible. The workspace was fine only because its content
     * pane is opaque.
     */
    const bare = await page.evaluate(() =>
      ['.manager', '.workspace']
        .map((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const background = getComputedStyle(el).backgroundColor;
          const painted = background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent';
          // A screen may delegate to a child that paints the full area.
          const child = el.querySelector('.panel-content, [class*="surface-"]');
          return painted || child ? null : selector;
        })
        .filter(Boolean)
    );
    expect(bare).toEqual([]);
  });

  test('the window is actually translucent', async ({ sample }) => {
    // Shipped broken: the OS was drawing vibrancy behind the window the whole
    // time, and daisyUI's opaque `--root-bg` painted straight over it.
    const opaqueRoots = await sample.evaluate(() =>
      ['html', 'body', '#app']
        .map((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const bg = getComputedStyle(el).backgroundColor;
          const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
          return transparent ? null : `${selector} is ${bg}`;
        })
        .filter(Boolean)
    );
    expect(opaqueRoots).toEqual([]);
  });

  test('no divider is brighter than the surface it separates', async ({ page }) => {
    /*
     * Dividers used to be a percentage of `--color-base-content`, which is
     * near-white on the dark theme, so an "8% hairline" was 8% white. Even once
     * that was fixed the replacement was still far too strong: it composited to
     * luminance 61 over a surface of 25.
     *
     * Colours are resolved by painting them into a canvas rather than by
     * parsing the computed string. An earlier version of this check did the
     * latter, read the components of `oklab(...)` as though they were RGB, and
     * therefore scored every colour in the app as pure black — which is why it
     * passed while a bright line ran down the middle of the window.
     */
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });

    const tooBright = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

      /**
       * Stacks colours over an opaque ground and returns the result's
       * luminance. The ground is not optional: reading the channels of a
       * translucent fill gives its *unblended* colour, so a 6% wash of
       * near-white measured as near-white and every translucent surface in the
       * app scored as though it were opaque.
       */
      const luminance = (...layers: string[]): number => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 1, 1);
        for (const layer of layers) {
          ctx.fillStyle = layer;
          ctx.fillRect(0, 0, 1, 1);
        }
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };

      /** The nearest ancestor that actually paints something. */
      const surfaceOf = (el: Element): string => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const background = getComputedStyle(node).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent')
            return background;
        }
        return 'rgb(0, 0, 0)';
      };

      // A hairline is a step away from its surface, not a light source on it.
      const MAX_STEP = 35;
      const bad: string[] = [];

      for (const el of document.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(el);
        const sides = [
          ['top', style.borderTopWidth, style.borderTopColor],
          ['bottom', style.borderBottomWidth, style.borderBottomColor],
          ['left', style.borderLeftWidth, style.borderLeftColor],
          ['right', style.borderRightWidth, style.borderRightColor],
        ] as const;

        const base = surfaceOf(el);
        const surfaceLum = luminance(base);

        for (const [side, width, colour] of sides) {
          if (!Number.parseFloat(width)) continue;
          const step = luminance(base, colour) - surfaceLum;
          if (step > MAX_STEP) {
            bad.push(
              `${el.className || el.tagName} border-${side} +${Math.round(step)}`.slice(0, 70)
            );
          }
        }

        // The rail and sidebar dividers are painted as pseudo-elements.
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo);
          if (ps.content === 'none' || ps.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
          // Something invisible at rest is not a divider — the drag grabber
          // only exists under the pointer.
          if (Number.parseFloat(ps.opacity) === 0) continue;
          const step = luminance(base, ps.backgroundColor) - surfaceLum;
          if (step > MAX_STEP) {
            bad.push(
              `${el.className || el.tagName}${pseudo} +${Math.round(step)}`.slice(0, 70)
            );
          }
        }
      }

      return [...new Set(bad)].slice(0, 8);
    });

    expect(tooBright).toEqual([]);
  });

  test('the glass panels stay translucent', async ({ sample }) => {
    /*
     * Guards against removing the translucency by increments while chasing
     * something else. It has happened once already: the dark panels were pushed
     * to 88% opacity to stop the sidebar photographing as washed-out grey, which
     * was an artifact of the screenshot compositing against white rather than
     * anything visible on screen — and it took the glass with it.
     */
    const panels = await sample.evaluate(() =>
      ['.rail', '.sidebar'].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        const paint = style.backgroundColor + style.backgroundImage;
        const alpha = paint.match(/\/\s*(0?\.\d+)/)?.[1];
        return {
          selector,
          alpha: alpha ? Number.parseFloat(alpha) : 1,
          blurred: (style.backdropFilter || style.webkitBackdropFilter) !== 'none',
        };
      })
    );

    for (const panel of panels) {
      expect(panel.alpha, `${panel.selector} is opaque`).toBeLessThan(0.9);
      expect(panel.blurred, `${panel.selector} has no blur`).toBe(true);
    }
  });

  test('the glass columns are one surface, distinct from the content', async ({ sample }) => {
    /*
     * Two depths, not three. The rail and the sidebar must match exactly — the
     * window controls straddle their boundary, so any difference between them
     * draws a line through the traffic lights over a light desktop. The
     * difference that carries the depth is between the glass columns and the
     * opaque pane beside them.
     */
    const [rail, sidebar, content] = await sample.evaluate(() =>
      ['.rail', '.sidebar', '.content'].map(
        (selector) => getComputedStyle(document.querySelector(selector)!).backgroundColor
      )
    );
    expect(rail).toBe(sidebar);
    expect(content).not.toBe(sidebar);
  });

  test('a scrim dims and the surface on it blurs, never both', async ({ sample }) => {
    /*
     * Blurring the scrim as well undoes the effect it is there for: a blurred
     * backdrop has already flattened everything behind it, so the glass on top
     * has nothing left to refract and reads as flat tint. It is also two
     * full-screen backdrop filters composited every frame for one result.
     */
    await sample.keyboard.press('Meta+k');
    await sample.getByRole('dialog').waitFor();

    const surfaces = await sample.evaluate(() => {
      const read = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          blur: style.backdropFilter || style.webkitBackdropFilter || 'none',
          background: style.backgroundColor,
        };
      };
      return { scrim: read('.scrim'), panel: read('.scrim [class*="surface-"]') };
    });

    expect(surfaces.scrim, 'the scrim must exist').not.toBeNull();
    expect(surfaces.panel, 'the panel must exist').not.toBeNull();
    expect(surfaces.scrim!.blur).toBe('none');
    expect(surfaces.scrim!.background).not.toBe('rgba(0, 0, 0, 0)');
    // Big enough to read as thick glass rather than a frosted pane.
    const radius = Number.parseFloat(surfaces.panel!.blur.replace(/^\D*/, ''));
    expect(radius).toBeGreaterThanOrEqual(24);
  });

  test('no translucent surface is stacked directly on another', async ({ sample }) => {
    /*
     * Legibility collapses when two blurs compose, and it is the single easiest
     * material rule to break by accident.
     *
     * With the sheet and a popover inside it open, because that is where it
     * actually happened: a select menu renders inline, so its glass sat on the
     * sheet's glass. An ancestor with a `backdrop-filter` is the backdrop root
     * for everything within it, so the popover was blurring the sheet's own
     * flat fill — a full compositing pass to produce a grey rectangle.
     */
    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();
    await sample.getByLabel('Language', { exact: true }).click();
    await expect(sample.getByRole('listbox')).toBeVisible();

    const stacked = await sample.evaluate(() => {
      const glass = (el: Element) => {
        const style = getComputedStyle(el);
        const filter = style.backdropFilter || style.webkitBackdropFilter;
        return filter !== 'none' && filter !== '';
      };
      const bad: string[] = [];
      for (const el of document.querySelectorAll('*')) {
        if (!glass(el)) continue;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (glass(p)) {
            bad.push(`${el.className || el.tagName} inside ${p.className || p.tagName}`);
            break;
          }
        }
      }
      return bad.slice(0, 10);
    });
    expect(stacked).toEqual([]);

    await sample.keyboard.press('Escape');
    await sample.keyboard.press('Escape');
  });
});

test.describe('controls', () => {
  test('every interactive element has an accessible name', async ({ sample }) => {
    const unnamed = await sample.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, [role="button"], a[href], input')]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const label =
            el.getAttribute('aria-label') ??
            el.getAttribute('title') ??
            el.getAttribute('placeholder') ??
            el.textContent?.trim() ??
            '';
          return label.length === 0;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
    );
    expect(unnamed).toEqual([]);
  });

  test('no component wears a framework component class', async ({ sample }) => {
    /*
     * daisyUI ships `.select`, `.input`, `.btn`, `.card` and friends. A
     * component of ours that takes one of those names inherits its border, its
     * fixed height, its width clamp and — for `.select` — a background-image
     * arrow, on top of whatever we drew. That is what produced a select with a
     * box inside a box and two chevrons in it.
     *
     * The sheets have to be open for this to see them. It only ever looked at
     * the bare workspace, so `.input` in the text field, `.select` in the
     * settings and connection forms and `.card` on a connection tile all sat
     * there passing — every one of them inside something modal.
     */
    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    const collisions = await sample.evaluate(() => {
      /*
       * The full set of daisyUI component names. Two of these had already been
       * taken by our own components before this list existed — `.select` drew a
       * box inside a box, and `.status` painted a grey pill the width of the
       * status bar — so it is deliberately the whole list rather than the ones
       * that have bitten so far.
       */
      const OWNED = [
        'alert',
        'avatar',
        'badge',
        'breadcrumbs',
        'btn',
        'card',
        'carousel',
        'chat',
        'checkbox',
        'collapse',
        'countdown',
        'diff',
        'divider',
        'dock',
        'drawer',
        'dropdown',
        'fieldset',
        'filter',
        'footer',
        'hero',
        'indicator',
        'input',
        'join',
        'kbd',
        'label',
        'link',
        'list',
        'loading',
        'mask',
        'menu',
        'mockup',
        'modal',
        'navbar',
        'progress',
        'radio',
        'range',
        'rating',
        'select',
        'skeleton',
        'stat',
        'status',
        'steps',
        'swap',
        'tab',
        'table',
        'tabs',
        'textarea',
        'timeline',
        'toast',
        'toggle',
        'tooltip',
        'validator',
      ];
      return OWNED.filter((name) => document.querySelector(`.${name}`) !== null);
    });
    expect(collisions).toEqual([]);
    await sample.keyboard.press('Escape');
  });

  test('no native control is left unstyled, on any pane', async ({ sample }) => {
    // A default checkbox next to hand-built controls is the loudest possible
    // signal that a screen was not finished, and the one that slipped through
    // was on a pane this gate never opened — so every pane gets opened.
    const panes = ['entities', 'queries', 'history'];
    for (const pane of panes) {
      await sample.locator(`.rail__item[aria-label]`).nth(panes.indexOf(pane)).click();
      const native = await sample.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('input, select, textarea')]
          .filter((el) => el.offsetParent !== null)
          .filter((el) => {
            const type = (el as HTMLInputElement).type;
            if (
              !['checkbox', 'radio', 'range', 'color'].includes(type) &&
              el.tagName === 'INPUT'
            ) {
              return false;
            }
            const style = getComputedStyle(el);
            // A control deliberately hidden behind a drawn one is not unstyled;
            // it is the real input the drawn one exists to keep.
            const box = el.getBoundingClientRect();
            if (style.opacity === '0' || box.width <= 2 || box.height <= 2) return false;
            return style.appearance !== 'none';
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
      );
      expect(native, `on the ${pane} pane`).toEqual([]);
    }
  });

  test('no native control is left unstyled', async ({ sample }) => {
    const native = await sample.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'input[type=checkbox], input[type=radio], select'
        ),
      ]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const appearance = getComputedStyle(el).appearance;
          return appearance !== 'none';
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
    );
    expect(native).toEqual([]);
  });

  test('every target clears the pointer minimum', async ({ sample }) => {
    // 28px, the desktop minimum. Grid cells are exempt by design — see the note
    // on `--row-h` in density.css.
    const small = await sample.evaluate(() => {
      const FLOOR = 28;
      return (
        [...document.querySelectorAll<HTMLElement>('button, [role="button"], input, select')]
          .filter((el) => el.offsetParent !== null && !el.closest('.tabulator'))
          // Inputs hidden behind a drawn control are reached through that
          // control, so their own box is not the target.
          .filter((el) => {
            const style = getComputedStyle(el);
            return style.opacity !== '0' && style.visibility !== 'hidden';
          })
          .map((el) => {
            const box = el.getBoundingClientRect();
            // A control can be small as long as its *hit* area is not, which is
            // what a label wrapping it provides.
            const target = el.closest('label') ?? el;
            const hit = target.getBoundingClientRect();
            return {
              el,
              w: Math.max(box.width, hit.width),
              h: Math.max(box.height, hit.height),
            };
          })
          .filter(({ w, h }) => w > 0 && (w < FLOOR || h < FLOOR))
          .map(({ el, w, h }) =>
            `${el.tagName.toLowerCase()}.${el.className} ${Math.round(w)}×${Math.round(h)}`.slice(
              0,
              90
            )
          )
      );
    });
    expect(small).toEqual([]);
  });

  test('buttons respond to being pressed', async ({ sample }) => {
    // Feedback on pointer-down is the foundation the rest of the motion sits
    // on; a button that does not move on press reads as broken regardless of
    // how fast it actually is.
    const inert = await sample.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.press')]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => !getComputedStyle(el).transitionProperty.includes('transform'))
        .map((el) => el.className.slice(0, 80))
    );
    expect(inert).toEqual([]);
  });
});

test.describe('motion', () => {
  test('nothing uses ease-in, and nothing runs longer than 400ms', async ({ sample }) => {
    const offenders = await sample.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(el);
        const timing = `${style.transitionTimingFunction} ${style.animationTimingFunction}`;
        // `ease-in` starts slow, which delays the exact moment the user is
        // watching most closely. `ease-in-out` is fine and contains the string.
        if (/(^|[ ,])ease-in([ ,]|$)/.test(timing)) {
          bad.push(`${el.className || el.tagName}: ${timing}`.slice(0, 80));
        }
        for (const duration of style.transitionDuration.split(',')) {
          const ms = duration.trim().endsWith('ms')
            ? Number.parseFloat(duration)
            : Number.parseFloat(duration) * 1000;
          if (ms > 400)
            bad.push(`${el.className || el.tagName}: ${duration.trim()}`.slice(0, 80));
        }
      }
      return [...new Set(bad)].slice(0, 10);
    });
    expect(offenders).toEqual([]);
  });

  test('reduced motion is honoured', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('*')]
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.transitionProperty.includes('transform');
        })
        .map((el) => el.className.slice(0, 60))
        .slice(0, 5)
    );
    expect(moving).toEqual([]);
  });
});

test.describe('typography and colour', () => {
  test('body text clears 4.5:1 against what it sits on', async ({ sample }) => {
    const failures = await contrastFailures(sample);
    expect(failures).toEqual([]);
  });

  test('the start screen clears 4.5:1 in dark mode', async ({ page }) => {
    // The screen a first run lands on, in the appearance nothing had checked.
    await setAppearance(page, 'dark');
    await stabilize(page);
    expect(await contrastFailures(page)).toEqual([]);
  });

  test('body text clears 4.5:1 in dark mode too', async ({ page }) => {
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample/i })
      .first()
      .click();
    await page.locator('.workspace').waitFor({ timeout: 30_000 });
    await stabilize(page);
    const failures = await contrastFailures(page);
    expect(failures).toEqual([]);
  });
});

/**
 * Walks up for the nearest painted ancestor, because text almost never sits on
 * an element that declares its own background.
 */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number] | null => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1]!.split(',').map((n) => Number.parseFloat(n));
      if (a !== undefined && a < 0.95) return null;
      return [r!, g!, b!];
    };

    const luminance = ([r, g, b]: [number, number, number]) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const backdrop = (el: Element): [number, number, number] | null => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const colour = parse(getComputedStyle(p).backgroundColor);
        if (colour) return colour;
      }
      return null;
    };

    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const text = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim().length > 1
      );
      if (!text || el.offsetParent === null) continue;

      const style = getComputedStyle(el);
      const fg = parse(style.color);
      const bg = backdrop(el);
      // A translucent foreground over a translucent surface cannot be measured
      // from computed styles; the screenshot tests cover those.
      if (!fg || !bg) continue;

      const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      const ratio = (lighter! + 0.05) / (darker! + 0.05);

      const size = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;

      if (ratio < required) {
        bad.push(
          `${el.className || el.tagName} ${ratio.toFixed(2)}:1 (needs ${required}) ${style.color} on ${style.backgroundColor}`.slice(
            0,
            110
          )
        );
      }
    }
    return [...new Set(bad)].slice(0, 10);
  });
}
