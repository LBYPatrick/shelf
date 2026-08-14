/**
 * Monaco, assembled from the parts this app actually uses.
 *
 * The package's default entry registers eighty languages and their services.
 * Importing the three pieces below instead gives the editor, every editor
 * contribution — find and replace, folding, multi-cursor, the command palette —
 * and SQL, and nothing else.
 *
 * The specifiers go through the package's `exports` map, which already points
 * at `esm/vs`: `monaco-editor/editor.js`, not `monaco-editor/esm/vs/editor.js`,
 * which resolves to `esm/vs/esm/vs/...` and fails.
 *
 * Everything is bundled from `node_modules`. Monaco's own documentation leads
 * with a CDN loader; a database client is used on machines with no route to the
 * internet and must not have a text editor that only works online.
 */
import * as monaco from 'monaco-editor/editor.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/sql/register.js';

/*
 * The worker is imported, so the bundler emits it as one of our own assets and
 * the path in the build points at the app. Monaco's documented setup fetches
 * the whole editor from a CDN — a database client is used on machines with no
 * route to the internet, and must not have a text editor that only works
 * online.
 */
const environment = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};

environment.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };

/**
 * A colour the theme resolved, as the hex Monaco insists on — alpha included.
 *
 * Monaco themes are plain data: no custom properties, no `color-mix`, no
 * `oklch`. Reading the custom property gives back the unevaluated token stream,
 * `var()` calls and all, so every colour has to be resolved on a real element
 * first and then converted.
 *
 * The conversion is the interesting part. A single canvas read cannot do it:
 * the pixel is stored premultiplied, so at five per cent alpha the recovered
 * channels are almost entirely rounding error. Painting the colour over black
 * and over white instead gives two opaque readings, and the pair determines
 * both the alpha and the underlying channels exactly.
 *
 *   over black  cb = a·C
 *   over white  cw = a·C + (1 − a)·255
 *   so          a  = 1 − (cw − cb)/255      and      C = cb/a
 *
 * Alpha is kept rather than flattened, and that is the whole point. Flattening
 * needs to know what is behind the surface, and behind this one is the material
 * the OS paints outside the window — which nothing in the page can sample. Two
 * attempts to guess it put a stripe across the editor. Handing Monaco a
 * translucent colour lets the compositor do the one part it cannot get wrong.
 */
let probeElement: HTMLElement | undefined;
let probeContext: CanvasRenderingContext2D | null | undefined;

function usedColour(value: string): string | undefined {
  if (!probeElement) {
    probeElement = document.createElement('span');
    probeElement.style.display = 'none';
    document.body.append(probeElement);
  }

  probeElement.style.color = '';
  probeElement.style.color = value.startsWith('--') ? `var(${value})` : value;
  return getComputedStyle(probeElement).color || undefined;
}

export function resolveColour(token: string, fallback: string): string {
  if (probeContext === undefined) {
    probeContext = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
  }

  const context = probeContext;
  if (!context) return fallback;

  const colour = usedColour(token);
  if (!colour) return fallback;

  const over = (backdrop: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = backdrop;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = colour;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data;
  };

  const onBlack = over('#000000');
  const onWhite = over('#ffffff');

  // Averaged across the channels: each yields the same alpha, and averaging
  // absorbs the one-unit rounding each of them can carry.
  const alpha = Math.min(
    1,
    Math.max(
      0,
      1 -
        [0, 1, 2].reduce((sum, i) => sum + ((onWhite[i] ?? 0) - (onBlack[i] ?? 0)), 0) / 3 / 255
    )
  );

  if (alpha < 0.004) return '#00000000';

  const hex = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  const channel = (index: number) => hex((onBlack[index] ?? 0) / alpha);

  return `#${channel(0)}${channel(1)}${channel(2)}${hex(alpha * 255)}`;
}
