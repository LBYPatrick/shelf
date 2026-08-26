import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import EntityStructure from './EntityStructure.vue';

/**
 * Columns, indexes, relations, triggers and partitions — each shown only where
 * the engine has them, read from `Capabilities` rather than from a `try`.
 *
 * Its table sets `display: table` explicitly. Tailwind's `.grid` is one
 * declaration and outranks a scoped rule that sets width and layout but not
 * display, which turned the head and body into two independently sized tables.
 */
const meta = {
  title: 'Tabs/EntityStructure',
  component: EntityStructure,
  args: { entity: { name: 'album', schema: 'music' } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { EntityStructure },
    setup: () => {
      connected();
      return { args };
    },
    template: `<div style="width:52rem; height:28rem; overflow:auto;"><EntityStructure v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof EntityStructure>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A table with indexes, a relation in each direction, and a trigger. */
export const Album: Story = {};

/** One with none of those — the sections are omitted, not shown empty. */
export const Bare: Story = { args: { entity: { name: 'daily_metrics', schema: 'ops' } } };
