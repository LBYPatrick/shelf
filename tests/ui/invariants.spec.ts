/**
 * Design invariants.
 *
 * Each of these is a bug that shipped at least once and was found by eye. A
 * screenshot test would catch them too, but only by failing with "these pixels
 * differ" — these fail with the reason, which is the difference between a gate
 * that gets fixed and one that gets its snapshots regenerated.
 */
import { setAppearance, stabilize, test, expect } from './fixtures';
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
    await sample.getByRole('treeitem', { name: 'daily_metrics' }).first().dblclick();
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

  test('the grid header stays aligned with its body when scrolled', async ({ sample }) => {
    // Shipped broken, and the reason the whole gate exists: on any table wider
    // than the pane every column label sat over the wrong column, by exactly
    // the scroll distance.
    await sample.locator('.sidebar__filter').first().fill('daily_metrics');
    await sample.getByRole('treeitem', { name: 'daily_metrics' }).first().dblclick();
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
  });
});

test.describe('materials', () => {
  test('no surface boundary runs under the window controls', async ({ sample }) => {
    // The controls are wider than the rail and overhang the sidebar, so a shade
    // change at that seam cuts each control in half — half on one surface, half
    // on the next.
    const seam = await sample.evaluate(() => {
      const strip = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--rail-top')
      );
      const sample_ = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return el ? getComputedStyle(el).backgroundColor : 'none';
      };
      // Either side of the rail/sidebar boundary, within the controls' band.
      const y = Math.max(2, strip / 2);
      const railWidth = document.querySelector('.rail')!.getBoundingClientRect().width;
      return { left: sample_(railWidth - 4, y), right: sample_(railWidth + 4, y) };
    });
    expect(seam.left).toBe(seam.right);
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

  test('the three vertical panels read as three different surfaces', async ({ sample }) => {
    const shades = await sample.evaluate(() =>
      ['.rail', '.sidebar', '.content'].map(
        (selector) => getComputedStyle(document.querySelector(selector)!).backgroundColor
      )
    );
    expect(new Set(shades).size).toBe(3);
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
    // Legibility collapses when two blurs compose, and it is the single easiest
    // material rule to break by accident.
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
     */
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
