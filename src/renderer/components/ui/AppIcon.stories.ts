import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppIcon from './AppIcon.vue';

/**
 * The icon set, all of it, at the sizes the interface actually uses.
 *
 * Every path is drawn on a 16-unit grid with a 1.5 stroke. That is the only
 * thing holding the set together, and it is invisible one glyph at a time —
 * a borrowed path at another scale looks fine alone and wrong in a row. The
 * sheet below is the check.
 */
const meta = {
  title: 'UI/AppIcon',
  component: AppIcon,
  args: { name: 'table', size: 16, filled: false },
} satisfies Meta<typeof AppIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = {};

/** Filled, for the two shapes that close up at a stroke this thin. */
export const Filled: Story = { args: { name: 'assistant', filled: true, size: 24 } };

/** The whole set. A glyph that does not belong shows up here and nowhere else. */
export const EveryIcon: Story = {
  render: () => ({
    components: { AppIcon },
    setup: () => ({
      names: [
        'tables',
        'star',
        'history',
        'settings',
        'refresh',
        'search',
        'close',
        'plus',
        'minus',
        'wrap',
        'chevron',
        'table',
        'view',
        'routine',
        'jobs',
        'query',
        'sidebar',
        'structure',
        'diagram',
        'download',
        'play',
        'stop',
        'check',
        'warning',
        'upload',
        'pencil',
        'filter',
        'more',
        'copy',
        'database',
        'folder',
        'info',
        'chart',
        'eye',
        'eyeOff',
        'assistant',
        'send',
        'trash',
        'arrowUp',
      ],
    }),
    template: `
      <div style="display:grid; grid-template-columns:repeat(8, 5.5rem); gap:0.75rem;">
        <div v-for="name in names" :key="name"
             style="display:flex; flex-direction:column; align-items:center; gap:0.35rem;">
          <AppIcon :name="name" :size="20" :filled="name === 'assistant'" />
          <span style="font-size:0.625rem; opacity:0.6;">{{ name }}</span>
        </div>
      </div>
    `,
  }),
};

/** The sizes they are drawn at, so a mismatched weight is visible. */
export const EverySize: Story = {
  render: () => ({
    components: { AppIcon },
    template: `
      <div style="display:flex; align-items:center; gap:1rem;">
        <AppIcon name="database" :size="11" />
        <AppIcon name="database" :size="13" />
        <AppIcon name="database" :size="16" />
        <AppIcon name="database" :size="24" />
        <AppIcon name="database" :size="40" />
      </div>
    `,
  }),
};
