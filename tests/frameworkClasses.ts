/**
 * Names our own components must not take.
 *
 * Read twice, from two directions, because neither reading is enough alone.
 * `tests/ui/invariants.spec.ts` looks at what is *on screen*, which is the only
 * way to catch a name that arrives from a framework at runtime — and it can only
 * see a surface something has opened. `tests/unit/classNames.test.ts` reads every
 * template on disk, which sees the sheets nothing in the gate opens, and cannot
 * see a class put on by script.
 *
 * One list rather than two, because two lists is one list that falls behind.
 */

/*
 * The full set of daisyUI component names. Two of these had already been
 * taken by our own components before this list existed — `.select` drew a
 * box inside a box, and `.status` painted a grey pill the width of the
 * status bar — so it is deliberately the whole list rather than the ones
 * that have bitten so far.
 */
export const FRAMEWORK_COMPONENTS: readonly string[] = [
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
export const FRAMEWORK_UTILITIES: readonly string[] = [
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
