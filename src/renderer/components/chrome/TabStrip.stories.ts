import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useTabs } from '@renderer/stores/tabs';
import { connected } from '../../../../.storybook/seed';
import TabStrip from './TabStrip.vue';

/**
 * The tab strip.
 *
 * One selection that travels, rather than a surface each tab paints for itself
 * — the bar may not carry a tint of its own, so a raised thumb would be a card
 * hovering over nothing. Loudness carries the difference instead.
 */
const meta = {
  title: 'Chrome/TabStrip',
  component: TabStrip,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

const strip = (build: (tabs: ReturnType<typeof useTabs>) => void) => ({
  components: { TabStrip },
  setup: () => {
    connected();
    build(useTabs());
    return {};
  },
  template: `
    <div class="topbar" style="display:flex; align-items:center; height:var(--tab-h); width:56rem;">
      <TabStrip />
    </div>
  `,
});

export const Empty: Story = { render: () => strip(() => undefined) };

export const AFew: Story = {
  render: () =>
    strip((tabs) => {
      tabs.openEntity('table', { name: 'album', schema: 'music' });
      tabs.openQuery('select 1');
      tabs.openChat();
    }),
};

/** More than it has room for, which is what the strip has to survive. */
export const Crowded: Story = {
  render: () =>
    strip((tabs) => {
      for (const name of [
        'artist',
        'album',
        'track',
        'catalogue',
        'daily_metrics',
        'audit_log',
      ]) {
        tabs.openEntity('table', { name, schema: 'music' });
      }
      tabs.openQuery('select 1');
      tabs.openQuery('select 2');
    }),
};

/** Every kind, so each one's glyph is checked. */
export const EveryKind: Story = {
  render: () =>
    strip((tabs) => {
      tabs.openEntity('table', { name: 'album', schema: 'music' });
      tabs.openQuery('select 1');
      tabs.openErd({ kind: 'schema', name: 'music' });
      tabs.openJob('j1', 'june refunds');
      tabs.openChat();
    }),
};
