import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import ErdTab from './ErdTab.vue';

/**
 * The diagram, scoped to what it is a diagram of.
 *
 * A whole connection at once is a hairball; it is opened from a database or a
 * schema and shows that.
 */
const meta = {
  title: 'Tabs/ErdTab',
  component: ErdTab,
  args: { active: true, scope: { kind: 'schema', name: 'music' } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ErdTab },
    setup: () => {
      connected();
      return { args };
    },
    template: `<div style="width:60rem; height:32rem; display:flex;"><ErdTab v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ErdTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Schema: Story = {};

/** Opened on a whole database rather than one schema. */
export const Database: Story = { args: { scope: { kind: 'database', name: 'records' } } };

/** No scope at all, which is the state before one is chosen. */
export const Unscoped: Story = { args: { scope: null } };
