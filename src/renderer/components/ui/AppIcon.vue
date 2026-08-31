<script setup lang="ts">
/**
 * The icon set.
 *
 * Drawn rather than typed. Text glyphs borrowed from a font are the fastest way
 * to make an interface look unfinished: they sit on a baseline instead of an
 * optical centre, their weights disagree with each other, and they change shape
 * on a machine with different fonts installed.
 *
 * Every path is on a 16-unit grid with a 1.5 stroke, so they hold together at
 * the sizes the interface actually uses.
 */
const PATHS: Record<string, string> = {
  tables: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M6 4.5v7',
  star: 'M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8L2.5 6.5l3.8-.5z',
  history: 'M8 4.5v3.5l2.5 1.5M2.8 8a5.2 5.2 0 1 0 1.6-3.8M4.4 2.6v2.2h2.2',
  /*
   * A cog with eight teeth and a hub, the same shape the sibling project uses.
   * What was here was an eight-lobed blob with a circle inside it — recognisable
   * as "settings" only by where it sat, which is not recognisable.
   *
   * Generated on the 16-unit grid rather than lifted from an icon font at
   * another size: a 24-unit path scaled down carries a stroke weight that
   * disagrees with every other glyph in this set.
   */
  settings:
    'M6.72 1.98A6.15 6.15 0 0 1 9.28 1.98L9.44 3.58A4.65 4.65 0 0 1 10.11 3.86L11.35 2.84A6.15 6.15 0 0 1 13.16 4.65L12.14 5.89A4.65 4.65 0 0 1 12.42 6.56L14.02 6.72A6.15 6.15 0 0 1 14.02 9.28L12.42 9.44A4.65 4.65 0 0 1 12.14 10.11L13.16 11.35A6.15 6.15 0 0 1 11.35 13.16L10.11 12.14A4.65 4.65 0 0 1 9.44 12.42L9.28 14.02A6.15 6.15 0 0 1 6.72 14.02L6.56 12.42A4.65 4.65 0 0 1 5.89 12.14L4.65 13.16A6.15 6.15 0 0 1 2.84 11.35L3.86 10.11A4.65 4.65 0 0 1 3.58 9.44L1.98 9.28A6.15 6.15 0 0 1 1.98 6.72L3.58 6.56A4.65 4.65 0 0 1 3.86 5.89L2.84 4.65A6.15 6.15 0 0 1 4.65 2.84L5.89 3.86A4.65 4.65 0 0 1 6.56 3.58L6.72 1.98ZM10.15 8A2.15 2.15 0 1 1 5.85 8A2.15 2.15 0 1 1 10.15 8Z',
  refresh: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.8M13.5 2.4v2.9h-2.9',
  /* A board and a space bar. Four keys and a long one reads as a keyboard at
     16 units; a full row of them reads as a grid. */
  keyboard: 'M1.5 4h13v8h-13zM4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M5 9.5h6',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5L14 14',
  /* A window with a prompt in it: the chevron and the caret line, which is
     what a terminal is drawn as everywhere and is legible at 13 units. */
  terminal: 'M1.5 3h13v10h-13zM4.5 7L6.5 9L4.5 11M8.5 11.2h3.5',
  close: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3.5v9M3.5 8h9',
  minus: 'M3.5 8h9',
  wrap: 'M2.5 4h11M2.5 8h8a2.5 2.5 0 0 1 0 5H6.5M8.5 11l-2 2 2 2M2.5 12h2',
  chevron: 'M6 3.5L10.5 8L6 12.5',
  table: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M6 6.5v6',
  view: 'M2.5 3.5h11v9h-11zM2.5 6.5h11',
  routine: 'M6 12.5V5a2 2 0 0 1 2-2h1M4.5 7.5h5',
  /*
   * Layers, for the jobs list: a set of answers stacked up, which is what a
   * queue of dispatched queries is. `routine` was standing in for it and drew
   * something that reads as a lower-case f at rail size.
   */
  jobs: 'M8 2.2L14 5.4L8 8.6L2 5.4ZM2 8.4L8 11.6L14 8.4M2 11.2L8 14.4L14 11.2',
  query: 'M3.5 5L6 8l-2.5 3M8 11.5h4.5',
  sidebar: 'M2.5 3.5h11v9h-11zM6.5 3.5v9',
  structure: 'M3.5 3.5h9v3h-9zM3.5 9.5h9v3h-9z',
  diagram: 'M3 3h4v4H3zM9 9h4v4H9zM7 5h2v4h4',
  download: 'M8 3v7M5 7.5L8 10.5l3-3M3.5 13h9',
  play: 'M5 3.5l7 4.5-7 4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  check: 'M3.5 8.5L6.5 11.5L12.5 4.5',
  warning: 'M8 2.8L14 13H2zM8 6.5v3M8 11.2v.1',
  // Import mirrors export: the same tray, the arrow going the other way.
  upload: 'M8 10.5v-7M5 6.5L8 3.5l3 3M3.5 13h9',
  pencil: 'M11.5 2.5l2 2-7.5 7.5-2.5.5.5-2.5zM10 4l2 2',
  // A funnel: three rules narrowing to the stem, which is what a filter does.
  filter: 'M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z',
  // Three dots. Vertical, because it sits at the end of a row and a horizontal
  // one would read as an ellipsis in the label rather than as a control.
  more: 'M8 3.6v.1M8 8v.1M8 12.4v.1',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  // A cylinder, seen from slightly above: the shape a database has had since
  // before any of this, and the one nobody has to be taught.
  database:
    'M8 2.5c2.8 0 5 .8 5 1.8S10.8 6 8 6 3 5.2 3 4.2 5.2 2.5 8 2.5zM3 4.2v7.6c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4.2M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8',
  // A tab and a body, which is what every folder has been for forty years.
  folder:
    'M2.5 5.5V4a1 1 0 0 1 1-1h2.3l1.2 1.5h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z',
  info: 'M8 7.5v4M8 4.6v.1M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  // Bars on a baseline: the shape of the thing the Analyze tab opens onto.
  chart: 'M2.5 13.5h11M4.5 13.5v-4M7.5 13.5v-8M10.5 13.5v-5.5M13 13.5v-9',
  // An eye, and the same eye struck through: revealing a secret and hiding it
  // again are one control, so they are one shape with one difference.
  eye: 'M1.8 8s2.5-4 6.2-4 6.2 4 6.2 4-2.5 4-6.2 4-6.2-4-6.2-4zM8 9.9a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z',
  eyeOff:
    'M1.8 8s2.5-4 6.2-4c1 0 1.9.3 2.7.7M14.2 8s-2.5 4-6.2 4c-1 0-1.9-.3-2.7-.7M6.7 6.7a1.9 1.9 0 0 0 2.6 2.6M2.5 2.5l11 11',
  /*
   * A four-pointed star with a smaller one beside it: the shape that has come
   * to mean "a model wrote this", which is exactly the thing an icon here has
   * to say without a label. Concave sides rather than a diamond — a diamond at
   * this size reads as a warning marker.
   *
   * Filled, unlike everything else in the set, because a 1.5 stroke around a
   * shape with four cusps closes up at 12px and turns into a blob. It is drawn
   * with `filled` in the places it appears.
   */
  assistant:
    'M7 1.6c.45 3.2 1.75 4.5 4.95 4.95-3.2.45-4.5 1.75-4.95 4.95-.45-3.2-1.75-4.5-4.95-4.95C5.25 6.1 6.55 4.8 7 1.6ZM12.3 9.4c.24 1.55.85 2.16 2.4 2.4-1.55.24-2.16.85-2.4 2.4-.24-1.55-.85-2.16-2.4-2.4 1.55-.24 2.16-.85 2.4-2.4Z',
  // A paper plane, pointing where the message is going.
  send: 'M13.8 2.2L7.2 9M13.8 2.2L9.6 13.8l-2.4-4.8-4.8-2.4z',
  // Straight up, with a chevron head: "send this". The same shape every
  // composer in every messaging app has settled on, which is the argument for
  // it — a control nobody has to be taught.
  arrowUp: 'M8 13V3.5M4 7.5L8 3.5l4 4',
  // A bin with a lid and a handle. Three lines, no hatching: the shape is
  // recognisable at 12px and the detail is not.
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5',
  /*
   * Two arrows and the line they close onto, or open away from.
   *
   * A pair, because the two ends of an outline are two actions rather than one
   * button that quietly changes meaning — and one drawing mirrored is a shape
   * the eye reads as a pair without being told.
   *
   * Two chevrons and nothing else, held well apart.
   *
   * Both of the obvious extra parts were tried at the size this is actually
   * drawn — 14px — and both cost more than they gave. A shaft behind each head
   * makes five strokes that resolve into a smudge. The line they close onto has
   * to sit within two units of the tips, which is under a pixel of clearance and
   * reads as one mark rather than three.
   *
   * The gap is the part that had to be measured rather than guessed: at three
   * units the two heads of `arrowsIn` all but touch and the icon reads as a
   * cross, which beside a list means clear or close — the one meaning it must
   * not have. Five units leaves three pixels of daylight, which is enough for
   * two marks to stay two. Converging is closing; apart is opening.
   */
  arrowsIn: 'M4.3 2.5L8 5.5l3.7-3M4.3 13.5L8 10.5l3.7 3',
  arrowsOut: 'M4.3 5.5L8 2.5l3.7 3M4.3 10.5L8 13.5l3.7-3',
};

withDefaults(
  defineProps<{ name: keyof typeof PATHS | string; size?: number; filled?: boolean }>(),
  {
    size: 16,
    filled: false,
  }
);
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    :fill="filled ? 'currentColor' : 'none'"
    aria-hidden="true"
    focusable="false"
  >
    <path
      :d="PATHS[name] ?? ''"
      :stroke="filled ? 'none' : 'currentColor'"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.icon {
  flex: 0 0 auto;
  /* Optical centring: a stroked glyph sits slightly high against text. */
  vertical-align: -0.125em;
}
</style>
