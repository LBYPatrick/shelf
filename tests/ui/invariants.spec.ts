/**
 * Design invariants.
 *
 * Each of these is a bug that shipped at least once and was found by eye. A
 * screenshot test would catch them too, but only by failing with "these pixels
 * differ" — these fail with the reason, which is the difference between a gate
 * that gets fixed and one that gets its snapshots regenerated.
 */
import { setAppearance, stabilize, test, expect } from './fixtures';
import { openTable, revealTables, typeQuery } from '../e2e/helpers';
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
    await revealTables(sample);
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
  });

  test('the columns begin below the bar the window controls sit on', async ({ sample }) => {
    // The clearance used to be padding inside the rail and the connection row,
    // measured separately and kept in agreement by hand. It is the bar's height
    // now, which is one number, but only for as long as nothing below the bar
    // is positioned back over it.
    const geometry = await sample.evaluate(() => {
      const bar = document.querySelector('.topbar')!.getBoundingClientRect();
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect();
      return {
        barBottom: bar.bottom,
        barLeft: bar.left,
        rail: box('.rail').top,
        sidebar: box('.sidebar').top,
        controls: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--controls-inset')
        ),
      };
    });

    expect(geometry.barLeft).toBe(0);
    // The controls need the bar to be tall enough to hold them, whatever the
    // density scale would make a row of tabs on its own.
    if (geometry.controls > 0) expect(geometry.barBottom).toBeGreaterThanOrEqual(38);
    expect(geometry.rail).toBeGreaterThanOrEqual(geometry.barBottom - 1);
    expect(geometry.sidebar).toBeGreaterThanOrEqual(geometry.barBottom - 1);
  });

  test('nothing sits under the window controls, collapsed or not', async ({ sample }) => {
    /*
     * The strip used to live inside the content pane, so collapsing the sidebar
     * brought its leading edge to the window edge and put the first tab under
     * the traffic lights — overlapping and unclickable. The bar spans the
     * window now and pads its own start, so the tabs are clear at either state;
     * the collapsed one is checked because it is the one that broke.
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

  test('the panes meet, with no column of layout for a divider to paint', async ({
    sample,
  }) => {
    /*
     * The resize handle used to take a pixel of layout between the sidebar and
     * the content, and that pixel had to be painted or the window's own backdrop
     * came up through it as a bright line down the full height. Painting it the
     * content pane's colour worked only while the pane's leading edge was
     * straight: once the pane took a rounded corner, the strip carried on past
     * the curve and stood clear of it as a light stub.
     */
    const gap = await sample.evaluate(() => {
      const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect();
      const content = document.querySelector('.content')!.getBoundingClientRect();
      return content.left - sidebar.right;
    });

    expect(Math.abs(gap)).toBeLessThanOrEqual(0.5);
  });

  test('one selection travels between the tabs, and none of them is raised', async ({
    sample,
  }) => {
    /*
     * The open tab used to be the raised white thumb of a segmented control,
     * and a thumb is only legible as raised against the recessed track it came
     * out of. There is no track on the top bar and there may not be one, so the
     * thumb was a card hovering over nothing — which is how it read.
     *
     * The measurement is the other half. The marker is positioned from the
     * active tab's own box, and it is a sibling of the tabs in the same list,
     * so counting children rather than tabs puts it one place to the left.
     */
    const strip = sample.locator('.strip');
    await strip.getByRole('button', { name: /new query tab/i }).click();
    await strip.getByRole('button', { name: /new query tab/i }).click();
    await expect(sample.locator('.striptab')).toHaveCount(2);

    const aligned = async () =>
      sample.evaluate(() => {
        const marker = document.querySelector('.strip__marker')!.getBoundingClientRect();
        const open = document
          .querySelector('.striptab[aria-selected="true"]')!
          .getBoundingClientRect();
        return {
          dx: Math.abs(marker.left - open.left),
          dw: Math.abs(marker.width - open.width),
        };
      });

    // Settled, not mid-travel: the marker springs to a new tab and takes its
    // width with it, and both are in flight for a few hundred milliseconds.
    await sample.waitForTimeout(400);
    expect(await aligned()).toEqual({ dx: 0, dw: 0 });

    await sample.locator('.striptab').first().click();
    await sample.waitForTimeout(400);
    expect(await aligned()).toEqual({ dx: 0, dw: 0 });

    const raised = await sample.evaluate(() =>
      [...document.querySelectorAll('.striptab')].map((el) => ({
        cls: el.className,
        shadow: getComputedStyle(el).boxShadow,
      }))
    );
    expect(raised.filter((tab) => tab.shadow !== 'none')).toEqual([]);
  });

  test('the strip survives more tabs than it has room for', async ({ sample }) => {
    /*
     * Two defects that only appear once the tabs stop fitting.
     *
     * The tablist could be *shrunk* by the strip while its tabs — a fixed width
     * each — carried on painting outside it, and the overflow landed on top of
     * the new-tab button. From about eleven tabs on, the control you press to
     * get another tab could not be clicked at all.
     *
     * And the marker was measured off the page while the tabs were animating to
     * their new width, so it chased a number that had already changed and came
     * to rest beside the open tab instead of on it.
     */
    const add = sample.locator('.strip').getByRole('button', { name: /new query tab/i });

    for (let index = 0; index < 14; index += 1) {
      // The click itself is the assertion for the first defect: a covered
      // button times out here rather than failing a measurement later.
      await add.click();
    }

    await sample.waitForTimeout(500);

    const overflow = await sample.evaluate(() => {
      const strip = document.querySelector('.strip') as HTMLElement;
      return strip.scrollWidth - strip.clientWidth;
    });
    expect(overflow, 'fourteen tabs still fit; the case is not being tested').toBeGreaterThan(
      0
    );

    const drift = await sample.evaluate(() => {
      const marker = document.querySelector('.strip__marker')!.getBoundingClientRect();
      const active = document.querySelector('.striptab--on')!.getBoundingClientRect();
      return {
        x: Math.abs(marker.left - active.left),
        w: Math.abs(marker.width - active.width),
      };
    });

    expect(drift.x, 'the marker is not on the open tab').toBeLessThanOrEqual(1);
    expect(drift.w, 'the marker is not the width of the open tab').toBeLessThanOrEqual(1);
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
      return {
        bar: region('.topbar'),
        strip: region('.strip'),
        tab: region('.striptab'),
        toggle: region('.topbar__toggle'),
      };
    });

    expect(regions.bar).toBe('drag');
    expect(regions.toggle).toBe('no-drag');
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
    await revealTables(sample);
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
    await revealTables(sample);
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

  test('every properties section renders, and its header sits over its data', async ({
    sample,
  }) => {
    /*
     * Three defects in one popup, and one cause between two of them.
     *
     * The table wore `class="grid"`, which Tailwind owns — a scoped rule that
     * set its width and `table-layout` but never its `display` did not outrank
     * `display: grid`, so head and body were blockified into two separate
     * anonymous tables that each sized their own columns. Every header label
     * sat a third of the pane away from the values under it.
     *
     * And switching to Indexes or Relations took the whole view down: the
     * Postgres driver returned `array_agg(name)` as the string `{id,name}`,
     * because `pg` has no parser for that type, and the first `.join()` in the
     * render threw. Both are checked here by walking every section, because a
     * section nobody opens is a section nobody sees break.
     */
    await revealTables(sample);
    await sample.getByRole('treeitem', { name: 'album' }).first().click({ button: 'right' });
    await sample.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(sample.locator('.structure')).toBeVisible();

    const segments = sample.locator('.structure .segmented__option');
    const count = await segments.count();
    expect(count, 'the properties popup has no sections').toBeGreaterThan(1);

    for (let index = 0; index < count; index += 1) {
      const name = (await segments.nth(index).textContent())?.trim() ?? `${index}`;
      await segments.nth(index).click();

      // Responding to the click at all: the switcher itself used to vanish with
      // the rest of the view when the section behind it threw.
      await expect(
        sample.locator('.structure .segmented__option').nth(index),
        `${name} did not take the selection`
      ).toHaveAttribute('aria-checked', 'true');

      const drift = await sample.evaluate(() => {
        const table = document.querySelector('.structure table');
        if (!table) return { columns: -1, worst: 0 };

        const headers = [...table.querySelectorAll('thead th')];
        const cells = [...(table.querySelector('tbody tr')?.querySelectorAll('td') ?? [])];
        if (cells.length === 0) return { columns: 0, worst: 0 };
        if (cells.length !== headers.length) return { columns: -1, worst: 0 };

        return {
          columns: headers.length,
          worst: Math.max(
            ...headers.map((header, index) =>
              Math.abs(
                header.getBoundingClientRect().x - cells[index]!.getBoundingClientRect().x
              )
            )
          ),
        };
      });

      expect(drift.columns, `${name} has a header row of a different width`).not.toBe(-1);
      expect(drift.worst, `${name} has a label off its column`).toBeLessThanOrEqual(1);
    }

    await sample.keyboard.press('Escape');
  });

  test('a popup is the size of what is in it, centred, and capped', async ({ sample }) => {
    /*
     * These used to be one fixed height apiece, so that a fetch landing could
     * not resize them — which meant a popup with six facts in it reserved the
     * room for forty and sat two thirds empty. It follows its content now, and
     * the objection is answered where it belongs: the change is animated on a
     * decelerating curve and the sheet stays centred, so a late answer reads as
     * the window settling rather than as the ground moving.
     *
     * Three things have to hold, and this is all three: different content is
     * different heights, nothing exceeds four fifths of the window, and the
     * sheet is centred at whatever size it lands on.
     */
    const dialog = sample.getByRole('dialog');
    const heights: Record<string, number> = {};

    const viewport = await sample.evaluate(() => window.innerHeight);
    const ceiling = Math.round(viewport * 0.8);

    const measure = async (label: string, open: () => Promise<void>) => {
      await open();
      await expect(dialog).toBeVisible();
      // Past the enter transition and the resize that follows the first
      // measurement; a box read mid-flight is neither size.
      await sample.waitForTimeout(700);

      const box = (await dialog.boundingBox())!;
      heights[label] = Math.round(box.height);

      expect(heights[label], `${label} exceeds the ceiling`).toBeLessThanOrEqual(ceiling + 1);

      /*
       * And no shorter than what it holds. A popup that settles a few pixels
       * under its content puts a scrollbar down the side of a panel with room
       * to spare — which is how both halves of the measurement went wrong, and
       * neither showed up as a height that was obviously silly.
       */
      const short = await sample.evaluate(() => {
        const body = document.querySelector('.panel__body')!;
        return body.scrollHeight - body.clientHeight;
      });
      expect(short, `${label} is shorter than its content`).toBeLessThanOrEqual(0);
      expect(
        Math.abs(box.y + box.height / 2 - viewport / 2),
        `${label} is not centred`
      ).toBeLessThan(30);

      await sample.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    };

    await revealTables(sample);

    await measure('database', async () => {
      await sample.locator('.row--database').first().click({ button: 'right' });
      await sample.getByRole('menuitem', { name: 'Properties' }).click();
    });
    await measure('table', async () => {
      await sample.getByRole('treeitem', { name: 'album' }).first().click({ button: 'right' });
      await sample.getByRole('menuitem', { name: 'Properties' }).click();
    });

    // The point of the change: a short popup is short. Asserted as a real gap
    // rather than "not equal", so a one-pixel difference cannot pass for it.
    expect(
      heights['database'],
      `both popups took the same room: ${JSON.stringify(heights)}`
    ).toBeLessThan(heights['table']! - 20);
  });

  test('a popup that loses content gets shorter, and travels there', async ({ sample }) => {
    /*
     * `scrollHeight` is never smaller than the box it is read from, so a panel
     * already holding a height reports that height as its content's. Every
     * sheet could therefore grow and none could shrink: switching settings from
     * its long list of sections to its short JSON editor left the editor above
     * a third of a window of nothing, and it stayed that way until the popup
     * was closed and opened again.
     */
    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = sample.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await sample.waitForTimeout(700);
    const long = (await dialog.boundingBox())!.height;

    /*
     * Sampled every frame across the change, because *how* it gets there is
     * half the rule. Measuring the content by taking the imposed height off the
     * panel and putting it straight back fixed the shrinking and broke this:
     * reading a layout property flushes style, so the browser took the natural
     * height as the one the transition started from, and the sheet jumped to
     * its new size with an animation from that size to itself.
     */
    const frames = await sample.evaluate(async () => {
      const panel = document.querySelector('.panel') as HTMLElement;
      const heights: number[] = [];
      const until = performance.now() + 500;
      [...document.querySelectorAll('label, button')]
        .find((node) => node.textContent?.trim() === 'JSON')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      while (performance.now() < until) {
        heights.push(panel.getBoundingClientRect().height);
        await new Promise((settle) => requestAnimationFrame(settle));
      }
      return heights;
    });

    const short = frames.at(-1)!;
    expect(
      short,
      `the popup kept the taller view's height: ${long} then ${short}`
    ).toBeLessThan(long - 20);

    const between = frames.filter((height) => height < long - 5 && height > short + 5);
    expect(
      between.length,
      `the height jumped rather than animating: ${JSON.stringify([...new Set(frames.map(Math.round))])}`
    ).toBeGreaterThan(3);

    await sample.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('no chart sizes itself from the width of its pane', async ({ sample }) => {
    /*
     * An SVG given `width: 100%` and no height takes its height from the ratio
     * of its own `viewBox`. The statement trend was drawn in a 100 × 64 box, so
     * in a sheet a thousand pixels wide it came out six hundred pixels tall —
     * a panel of empty plot area that pushed everything worth reading below the
     * fold, and which read as a chart that had failed to draw.
     *
     * Every chart in the app is checked, not only that one: the mistake is a
     * property of how an SVG is sized and not of any one drawing.
     */
    await sample.locator('.row--database').first().click({ button: 'right' });
    await sample.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    const oversized: string[] = [];
    for (const section of ['Overview', 'Queries', 'Server']) {
      await sample.getByRole('radio', { name: section }).click();
      await sample.waitForTimeout(600);

      oversized.push(
        ...(await sample.evaluate((where) => {
          const limit = window.innerHeight * 0.55;
          return [...document.querySelectorAll('svg')]
            .filter((svg) => svg.getBoundingClientRect().height > limit)
            .map(
              (svg) =>
                `${where}: svg.${svg.getAttribute('class') ?? '?'} is ` +
                `${Math.round(svg.getBoundingClientRect().height)}px tall`
            );
        }, section))
      );
    }

    expect(oversized).toEqual([]);
    await sample.keyboard.press('Escape');
  });

  test('a schema and a database can describe themselves', async ({ sample }) => {
    // Tables had a Properties item and the folders above them did not, so
    // right-clicking a schema did nothing at all — which reads as the app being
    // broken rather than as a folder having no actions.
    await sample.locator('.row--database').first().click({ button: 'right' });
    await sample.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();
    await expect(sample.locator('.facts__item').first()).toBeVisible();
    await sample.keyboard.press('Escape');

    await revealTables(sample);
    await sample.locator('.row--schema').first().click({ button: 'right' });
    await sample.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();
    await expect(sample.locator('.facts__item').first()).toBeVisible();
    await sample.keyboard.press('Escape');
  });

  test('the grid header stays aligned with its body when scrolled', async ({ sample }) => {
    // Shipped broken, and the reason the whole gate exists: on any table wider
    // than the pane every column label sat over the wrong column, by exactly
    // the scroll distance.
    await revealTables(sample);
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
   *
   * The top bar spans the window now, so no column boundary reaches the
   * controls by construction — which is the point of the arrangement and
   * exactly the kind of thing that regresses the moment someone puts a shade
   * back inside that bar. The sweep is across the bar's whole width rather than
   * at one boundary, so it also catches the tab strip reclaiming a tint.
   */
  for (const appearance of ['light', 'dark'] as const) {
    test(`no surface boundary reads under the window controls (${appearance})`, async ({
      page,
    }) => {
      await setAppearance(page, appearance);
      await page
        .getByRole('button', { name: /sample database/i })
        .first()
        .click();
      await page.locator('.workspace').waitFor({ timeout: 30_000 });

      /*
       * This used to demand the rail and the sidebar be *identical*, which they
       * were — achieved with a banded gradient that gave the rail the sidebar's
       * tone for the height of the controls, which removed a vertical seam and
       * introduced a horizontal one directly above the first rail icon. The bar
       * replaced the whole argument: there is one surface under the controls,
       * and what is checked is that it stays one.
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

        const bar = document.querySelector('.topbar')!.getBoundingClientRect();
        const y = bar.top + bar.height / 2;

        const sample_ = (x: number) => {
          for (const el of document.elementsFromPoint(x, y)) {
            const background = getComputedStyle(el).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)') return luminance(background);
          }
          return 0;
        };

        // Every fourth pixel across the bar, skipping the raised tab that marks
        // which one is open — it is meant to be a different shade.
        let worst = 0;
        let previous: number | undefined;
        for (let x = 2; x < bar.width - 2; x += 4) {
          if (document.elementFromPoint(x, y)?.closest('.striptab')) {
            previous = undefined;
            continue;
          }
          const here = sample_(x);
          if (previous !== undefined) worst = Math.max(worst, Math.abs(here - previous));
          previous = here;
        }

        return worst;
      });

      // A few points of luminance is a change in surface; more is a drawn line.
      expect(step).toBeLessThanOrEqual(5);
    });
  }

  test('the opacity dial paints the number it shows', async ({ sample }) => {
    /*
     * One setting, one job: move every translucent surface the *window* is made
     * of. It used to sit at 0.5 for "as designed", which made every reading of
     * it a lie — the content pane is designed at 90%, so a slider showing 20%
     * painted 36%, and over the material the OS puts behind the window that
     * reads as better than half.
     *
     * And it *scaled*, which closes the gaps between the surfaces as it thins
     * them: at the bottom of the range the working pane and the glass columns
     * beside it converged on one colour and the window read as a single flat
     * sheet. It subtracts a constant now.
     */
    const windowSurfaces = ['.rail', '.sidebar', '.statusbar', '.content'];

    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    const read = (selectors: string[]) =>
      sample.evaluate((list) => {
        const alphaOf = (colour: string) => {
          const parts = colour.match(/[\d.]+/g) ?? [];
          // `rgba(r g b / a)` and `oklab(l a b / a)` both put alpha last, and a
          // colour with no alpha component is fully opaque.
          return colour.includes('/') || parts.length === 4
            ? Number(parts[parts.length - 1])
            : 1;
        };

        return list.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, found: false, alpha: 0 };
          return {
            selector,
            found: true,
            alpha: alphaOf(getComputedStyle(element).backgroundColor),
          };
        });
      }, selectors);

    for (const surface of await read(windowSurfaces)) {
      expect(surface.found, `${surface.selector} is missing`).toBe(true);
      expect(surface.alpha, `${surface.selector} starts opaque`).toBeLessThan(0.95);
    }

    await sample.getByLabel('Opacity').fill('100');
    for (const surface of await read(windowSurfaces)) {
      expect(surface.alpha, `${surface.selector} did not go solid`).toBeGreaterThan(0.99);
    }

    await sample.getByLabel('Opacity').fill('20');
    for (const surface of await read(windowSurfaces)) {
      expect(surface.alpha, `${surface.selector} did not thin out`).toBeLessThan(0.4);
    }

    /*
     * At the floor the working surface is at the floor's own number, and the
     * columns beside it are still visibly thinner.
     */
    const [pane, sidebar] = await read(['.content', '.sidebar']);
    expect(pane!.alpha, 'the pane at the floor').toBeCloseTo(0.2, 2);
    expect(pane!.alpha - sidebar!.alpha, 'the pane and the sidebar converged').toBeGreaterThan(
      0.1
    );

    // The sheet the slider is on has not moved through any of it: a menu is not
    // part of the window's material, it is a thing that appears in front of it.
    for (const position of [20, 50, 100]) {
      await sample.getByLabel('Opacity').fill(String(position));
      const [sheet] = await read(['.panel.surface-sheet']);
      expect(sheet!.alpha, `the sheet at ${position}%`).toBeGreaterThan(0.99);
    }

    // And back, so the setting is a preference rather than a one-way door.
    await sample.getByRole('button', { name: 'Reset materials' }).click();
    for (const surface of await read(windowSurfaces)) {
      expect(surface.alpha, `${surface.selector} did not come back`).toBeLessThan(0.95);
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
      .getByRole('button', { name: /sample database/i })
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
     *
     * The blur is not asserted here and belongs to a different surface. The
     * panels have nothing painted behind them — the root is transparent, and
     * the blurred desktop is the OS's own material behind the whole window,
     * which no in-page filter can reach — so a `backdrop-filter` on a panel is
     * a full-screen compositing pass a frame producing exactly what not running
     * it produces.
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
      expect(panel.blurred, `${panel.selector} blurs nothing, expensively`).toBe(false);
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

  test('a menu and a sheet are solid, whatever the window is made of', async ({ sample }) => {
    /*
     * The material rule at the top of `materials.css` taken to its conclusion:
     * a menu opens over the sidebar and a sheet over the workspace, and both of
     * those are glass — so a translucent menu is one glass surface on another.
     *
     * It is also the only honest answer to what a blur could do here.
     * `backdrop-filter` filters what the *page* has painted, and the app's own
     * glass is the OS's material behind the whole window, which no in-page
     * filter can reach. Measured on screen the filter ran correctly and the
     * result was invisible — a full-screen compositing pass a frame for a
     * surface that still read as flat. Asserted rather than described, because
     * "let's put a little glass back on the menu" is a one-line change.
     */
    await revealTables(sample);
    await sample.getByRole('treeitem', { name: 'album' }).first().click({ button: 'right' });
    await expect(sample.locator('.popmenu')).toBeVisible();

    await sample.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    const surfaces = await sample.evaluate(() =>
      ['.popmenu', '.panel.surface-sheet'].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, found: false, alpha: 0, blurred: true };
        const style = getComputedStyle(element);
        const parts = style.backgroundColor.match(/[\d.]+/g) ?? [];
        const alpha =
          style.backgroundColor.includes('/') || parts.length === 4
            ? Number(parts[parts.length - 1])
            : 1;
        const filter = style.backdropFilter || style.webkitBackdropFilter;
        return { selector, found: true, alpha, blurred: /blur\((?!0px)/.test(filter) };
      })
    );

    for (const surface of surfaces) {
      expect(surface.found, `${surface.selector} is missing`).toBe(true);
      expect(surface.alpha, `${surface.selector} is translucent`).toBeGreaterThan(0.99);
      expect(surface.blurred, `${surface.selector} blurs nothing, expensively`).toBe(false);
    }

    await sample.keyboard.press('Escape');
  });

  test('the scrim dims, and nothing anywhere blurs it', async ({ sample }) => {
    /*
     * The scrim carries all of the separation between a modal and the window
     * now, so it has to be a dimming rather than a wash — and it must not be
     * blurred itself. Blurring a scrim flattens everything behind it, which is
     * a full-screen compositing pass a frame in exchange for making the window
     * unrecognisable as the thing you will return to.
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
    expect(surfaces.panel!.blur, 'the surface on the scrim blurs nothing').toBe('none');
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

  test('no component wears a framework component class', async ({ page, sample }) => {
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
     *
     * A toast has to be *raised* for the same reason, and it is the case that
     * proves the point: a component called `.toast` inherited daisyUI's fixed
     * position and column layout, and no amount of looking at a workspace with
     * no toast in it would have found that.
     *
     * The start screen is checked on its own window, and it is the newest case:
     * it is the one screen that is gone the moment a database is open, and it
     * took `.hero` — a daisyUI component that centres its contents in a
     * full-width grid — for as long as this gate looked only at a workspace.
     */
    expect(await frameworkClassesOn(page)).toEqual([]);

    await revealTables(sample);
    await sample.getByRole('treeitem', { name: 'album' }).first().click({ button: 'right' });
    await sample.getByRole('menuitem', { name: 'Copy table name' }).click();
    await expect(sample.locator('.notices [role="status"]')).toBeVisible();

    await sample.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sample.getByRole('dialog')).toBeVisible();

    expect(await frameworkClassesOn(sample)).toEqual([]);
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

  test('the rail names its icons, and does not make you wait twice', async ({ sample }) => {
    /*
     * A rail of icons is legible only to someone who already knows what they
     * mean, and `title` is not the answer: the OS tooltip arrives after a
     * second and a half, in a corner of its own choosing, styled by the
     * platform rather than by the app.
     *
     * The second half is the part that is easy to lose. Moving along a row of
     * icons is one gesture; making the reader wait again at every stop is what
     * makes a toolbar feel slow, so once a label is up the next one is
     * immediate.
     */
    const tip = sample.locator('.hovertip');
    await expect(tip).toHaveCount(0);

    await sample.locator('.rail__item').nth(1).hover();
    await expect(tip).toBeVisible({ timeout: 3000 });
    await expect(tip).not.toBeEmpty();

    const started = Date.now();
    await sample.locator('.rail__item').nth(2).hover();
    await expect(tip).toContainText(/\w/, { timeout: 1500 });
    expect(Date.now() - started, 'the second label waited again').toBeLessThan(250);

    // And it goes away rather than following the pointer around.
    await sample.locator('.tree').hover();
    await expect(tip).toBeHidden({ timeout: 2000 });

    /*
     * Repeating the accessible name aloud is the same word twice, so the bubble
     * is hidden from assistive technology and the button keeps the label.
     */
    const named = await sample.evaluate(() =>
      [...document.querySelectorAll('.rail__item')].every((el) => el.getAttribute('aria-label'))
    );
    expect(named, 'a rail button has no accessible name of its own').toBe(true);
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

  /*
   * A diagram's boxes stand *on* its canvas, and which direction "up" is
   * depends on the theme.
   *
   * A fill is mixed toward the mid grey, so the same recessed field darkens on
   * the light theme and lightens on the dark one — and a node painted
   * `--color-base-100` therefore rose off the field in one theme and sank into
   * a hole in it in the other. It shipped that way: on the dark theme the
   * tables read as cut-outs in the pane rather than as objects on it.
   */
  for (const mode of ['light', 'dark'] as const) {
    test(`a diagram's tables stand above its canvas in ${mode} mode`, async ({ page }) => {
      await setAppearance(page, mode);
      await page
        .getByRole('button', { name: /sample database/i })
        .first()
        .click();
      await page.locator('.workspace').waitFor({ timeout: 30_000 });
      await revealTables(page);

      await page.locator('.row--database').first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Diagram/ }).click();
      await expect(page.locator('.erd')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.erd-node').first()).toBeVisible({ timeout: 30_000 });

      const luminance = await page.evaluate(() => {
        const channel = (value: number) =>
          value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        const of = (colour: string) => {
          const [r, g, b] = colour.match(/[\d.]+/g)!.map(Number) as [number, number, number];
          return (
            0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255)
          );
        };
        return {
          canvas: of(getComputedStyle(document.querySelector('.erd')!).backgroundColor),
          box: of(getComputedStyle(document.querySelector('.erd-node__box')!).fill),
        };
      });

      const ratio =
        (Math.max(luminance.box, luminance.canvas) + 0.05) /
        (Math.min(luminance.box, luminance.canvas) + 0.05);

      expect(
        luminance.box,
        `the tables are darker than the canvas they stand on: ${JSON.stringify(luminance)}`
      ).toBeGreaterThan(luminance.canvas);
      expect(ratio, `the step is too small to see: ${ratio}`).toBeGreaterThan(1.08);
    });
  }

  test('the start screen clears 4.5:1 in dark mode', async ({ page }) => {
    // The screen a first run lands on, in the appearance nothing had checked.
    await setAppearance(page, 'dark');
    await stabilize(page);
    expect(await contrastFailures(page)).toEqual([]);
  });

  test('body text clears 4.5:1 in dark mode too', async ({ page }) => {
    await setAppearance(page, 'dark');
    await page
      .getByRole('button', { name: /sample database/i })
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

test.describe('cost', () => {
  test('switching back to a tab does not redraw its grid', async ({ sample }) => {
    /*
     * The layout is `fitDataStretch`, so a full redraw measures the widest
     * content in every column across every loaded row. Hiding a pane takes its
     * box to zero and showing it brings back exactly the box it had, and the
     * container's observer fired on both edges — so returning to a tab did that
     * measurement over the whole table, twice, having changed nothing. On a
     * table with a lot of data in it the window stopped for as long as it took.
     */
    await openTable(sample, 'album');
    await sample.locator('.tabulator-row').first().waitFor();

    const redraws = () => sample.locator('.datagrid').first().getAttribute('data-redraws');

    /*
     * Settled first, and settled means several reads apart rather than two in a
     * row: the pane is still finding its size for a moment after the first rows
     * arrive, and one matching pair during that is a coin toss, not quiet.
     */
    let before = '';
    let quiet = 0;
    await expect
      .poll(
        async () => {
          const now = (await redraws()) ?? '';
          quiet = now === before ? quiet + 1 : 0;
          before = now;
          return quiet;
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThanOrEqual(3);

    expect(Number(before)).toBeGreaterThan(0);

    await sample
      .locator('.strip')
      .getByRole('button', { name: /new query tab/i })
      .click();
    await sample.locator('.monaco-editor').waitFor();
    await sample.locator('.striptab').first().click();
    await sample.locator('.tabulator-row').first().waitFor();
    await sample.waitForTimeout(400);

    expect(await redraws()).toBe(before);
  });
});

test.describe('cost', () => {
  test('collapsing the sidebar does not stall the window', async ({ sample }) => {
    /*
     * The panel animates a width for a quarter of a second, and every frame of
     * it resizes the pane the grid is in. Three things answered each of those
     * frames: Tabulator's own resize observer, ours, and a forced redraw that
     * refits every column by clearing its width and reading `offsetWidth` back
     * off every cell. On the widest sample table that came to about a fifth of
     * a second per frame — sixteen frames drawn in seven hundred milliseconds,
     * which is what "janky" means when it is measured.
     *
     * The number below has a lot of room in it. It is not a frame-rate target,
     * it is the difference between answering a resize and sitting it out.
     */
    await openTable(sample, 'daily_metrics');
    await sample.locator('.tabulator-row').first().waitFor();
    await sample.waitForTimeout(600);

    const redraws = () => sample.locator('.datagrid').first().getAttribute('data-redraws');
    const before = await redraws();

    const frames = await sample.evaluate(async () => {
      let count = 0;
      let running = true;
      const tick = () => {
        count += 1;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      document.querySelector<HTMLElement>('.topbar__toggle')!.click();
      await new Promise((resolve) => setTimeout(resolve, 700));
      running = false;
      return count;
    });

    expect(frames).toBeGreaterThan(40);
    // Nothing at all: the pane came back the width it left, and a width is the
    // only thing a collapse changes.
    expect(await redraws()).toBe(before);
  });
});

test.describe('corner', () => {
  test('the notch fills the cut corner and nothing behind the pane', async ({ sample }) => {
    /*
     * It was a full square sitting behind the pane's cut corner, and the pane is
     * glass — so across the quarter-disc the two surfaces stacked and
     * composited to a shade darker than either. A small dark rectangle pinned
     * to the corner of the working pane, on every theme, for as long as the
     * element has existed.
     *
     * Asserted by hiding the notch and comparing the pixels rather than by
     * looking at the mask, because the mask is one way to fix it and the rule
     * is that the notch contributes nothing where the pane is drawn. The corner
     * is eight pixels across, which is far under the screenshot threshold —
     * this is invisible to the snapshot that exists to guard this very corner.
     */
    const box = (await sample.locator('.content').boundingBox())!;
    // Inside the pane and inside the arc: comfortably within the square the
    // notch occupies, and comfortably covered by the pane.
    const clip = { x: box.x + 4, y: box.y + 4, width: 4, height: 4 };

    const withNotch = await sample.screenshot({ clip });
    await sample.addStyleTag({ content: '.notch { display: none !important }' });
    const without = await sample.screenshot({ clip });

    expect(
      withNotch.equals(without),
      'the notch is painting under the content pane and darkening it'
    ).toBe(true);
  });

  test('the notch is backed by the same surface as the column beside it', async ({
    sample,
  }) => {
    /*
     * The content pane cuts a corner out of itself where it meets the glass,
     * and nothing under it painted anything — so the arc showed the material
     * the OS draws outside the window, raw, while the sidebar beside it showed
     * that material blurred, saturated and tinted. Two surfaces meeting along
     * an eight-pixel curve is exactly where a difference reads as a drawn edge.
     *
     * Compared rather than photographed: a test window has no vibrancy behind
     * it, so both sides come out identical however wrong they are.
     */
    const corner = await sample.evaluate(() => {
      const surface = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { bg: style.backgroundColor, filter: style.backdropFilter };
      };

      const notch = document.querySelector('.notch')!.getBoundingClientRect();
      const pane = document.querySelector('.content')!;
      const content = pane.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(pane).borderStartStartRadius);

      return {
        notch: surface('.notch'),
        sidebar: surface('.sidebar'),
        // Under the arc, or it is backing nothing.
        covers:
          Math.abs(notch.left - content.left) < 1 &&
          Math.abs(notch.top - content.top) < 1 &&
          notch.width >= radius &&
          notch.height >= radius,
      };
    });

    expect(corner.covers).toBe(true);
    expect(corner.notch).toEqual(corner.sidebar);
  });
});

test.describe('grid', () => {
  test('the selection travels with the rows it is drawn on', async ({ sample }) => {
    /*
     * The range overlay is positioned against the box it is a child of, and
     * that box was `static` — so it resolved against the outer table, which
     * does not scroll, while its ranges are placed in the scrolling table's
     * coordinates. The highlight stayed where it was drawn as the rows moved
     * under it: after a third of a row of scrolling its edges ran through the
     * middle of two lines of text, which reads as a strikethrough rather than
     * as a selection in the wrong place.
     */
    await revealTables(sample);
    await openTable(sample, 'album');
    await expect(sample.locator('.tabulator-row').first()).toBeVisible({ timeout: 20_000 });
    await stabilize(sample);

    const row = sample.locator('.tabulator-row').nth(3);
    await row.locator('.tabulator-cell').nth(1).click();
    await expect(sample.locator('.tabulator-range')).toBeVisible();

    await sample.locator('.tabulator-tableholder').hover();
    await sample.mouse.wheel(0, 37);
    await stabilize(sample);

    const [range, cell] = await Promise.all([
      sample.locator('.tabulator-range').boundingBox(),
      row.locator('.tabulator-cell').nth(1).boundingBox(),
    ]);

    expect(
      Math.abs(range!.y - cell!.y),
      `the selection is ${Math.round(range!.y - cell!.y)}px from the cell it belongs to`
    ).toBeLessThan(2);
  });
});

test.describe('tree', () => {
  test('the open tabs are actually written to the session', async ({ sample }) => {
    /*
     * They did not, and nothing said so. The session is assembled from Vue
     * state, and a tab's entity reference is a reactive Proxy — which the
     * context bridge refuses to clone, asynchronously, into a promise nobody
     * awaited. Every launch opened an empty workspace and every write failed in
     * silence, which is why this asserts the round trip rather than the call.
     */
    await revealTables(sample);
    await openTable(sample, 'album');
    await expect(sample.locator('.striptab')).toHaveCount(1);

    // Read back out of the application database rather than reloading the
    // window: a reload also drops the connection, which would fail this for a
    // reason that has nothing to do with what it is asking.
    await expect
      .poll(
        async () =>
          sample.evaluate(async () => {
            const keys = ['sample', 'mock'];
            for (const key of keys) {
              const session = await window.shelf.db.getSetting<{
                tabs?: { title?: string }[];
              } | null>(`session:${key}`, null);
              if (session?.tabs?.length) return session.tabs.map((tab) => tab.title).join(',');
            }
            return '';
          }),
        { timeout: 10_000, message: 'the session was never written' }
      )
      .toContain('album');
  });

  test('two entities that share a name expand independently', async ({ sample }) => {
    /*
     * Postgres overloads a function by its signature, so a schema holds several
     * routines called the same thing — pgcrypto ships seven `pgp_pub_decrypt`.
     * The sidebar keyed a row by its path, which is the same string for every
     * one of them, so expanding either twin expanded both, they shared one set
     * of loaded columns, and Vue was handed a list with duplicate keys.
     */
    await revealTables(sample);

    const twins = sample.getByRole('treeitem', { name: 'listener_growth', exact: true });
    await expect(twins).toHaveCount(2);

    await twins.first().click();
    await expect(twins.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(twins.nth(1)).toHaveAttribute('aria-expanded', 'false');

    // And a table still puts its columns directly beneath itself.
    await sample.getByRole('treeitem', { name: 'audit_log', exact: true }).click();
    await expect(sample.getByRole('treeitem', { name: /^actor/ })).toBeVisible();

    const below = await sample.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('.row')];
      const at = rows.findIndex((row) => row.getAttribute('aria-label') === 'audit_log');
      return rows.slice(at + 1, at + 3).map((row) => row.className);
    });

    expect(below.every((cls) => cls.includes('row--column'))).toBe(true);
  });
});

/**
 * Names our own components must not take, on whatever page is passed.
 *
 * A function rather than an inline evaluate because the collision that got
 * through was on a screen the workspace fixture never shows, and a check that
 * can only run in one place is a check with a blind spot.
 */
async function frameworkClassesOn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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
      'stack',
      'validator',
    ];

    /*
     * Tailwind's own utilities, which are not components and bite harder for
     * it. `.grid` is one declaration — `display: grid` — so a scoped rule
     * that sets a table's width and `table-layout` but never its `display`
     * does not outrank it: the structure view's table was a grid container,
     * its head and body were blockified into two separate anonymous tables,
     * and each sized its own columns. The header sat at two thirds the width
     * of the rows under it for as long as this list held only daisyUI's names.
     */
    const UTILITIES = [
      'block',
      'contents',
      'flex',
      'grid',
      'hidden',
      'inline',
      'isolate',
      'relative',
      'absolute',
      'fixed',
      'sticky',
      'static',
      'visible',
    ];

    /*
     * Ours only. Monaco and Tabulator bring their own DOM and their own class
     * names — Monaco's scrollbars are literally `.visible` — and neither is a
     * component of ours that could have inherited a daisyUI rule by accident.
     * Their subtrees are skipped rather than the names being struck off the
     * list, so a component of *ours* called `.visible` would still be caught.
     */
    const theirs = (element: Element) => element.closest('.monaco-editor, .tabulator') !== null;

    return [...OWNED, ...UTILITIES].filter((name) =>
      [...document.querySelectorAll(`.${name}`)].some((element) => !theirs(element))
    );
  });
}

test.describe('the jobs rail', () => {
  test('a job card is the same container as a tab, and does not grow under the pointer', async ({
    sample,
  }) => {
    await sample
      .getByRole('button', { name: /new query tab/i })
      .first()
      .click();
    await typeQuery(sample, 'select id, name from music.artist');
    await sample.getByRole('button', { name: 'What Run performs' }).click();
    await sample.getByRole('menuitem', { name: 'Dispatch' }).click();
    await sample.getByRole('button', { name: 'Jobs' }).click();

    const card = sample.locator('.job').first();
    await expect(card.locator('.job__status')).toHaveText(/Done/, { timeout: 20_000 });

    /*
     * Shipped as an outlined box in a column of outlined boxes, while the tabs
     * above it — the same kind of object, a thing you click to open — were
     * borderless tonal tiles. Two treatments for one idea is the thing that
     * makes an interface read as assembled rather than designed.
     */
    const shapes = await sample.evaluate(() => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { radius: style.borderTopLeftRadius, border: style.borderTopWidth };
      };
      return { card: read('.job'), tab: read('.striptab') };
    });
    expect(shapes.card).toEqual(shapes.tab);
    expect(shapes.card.border).toBe('0px');

    // The tools open into the row on hover, which narrows the name and can
    // re-wrap it. The name may reflow; the card may not move under the pointer
    // that is reaching for it.
    const height = async () => (await card.boundingBox())!.height;
    const resting = await height();
    await card.hover();
    await sample.waitForTimeout(300);
    expect(await height()).toBe(resting);
  });
});
