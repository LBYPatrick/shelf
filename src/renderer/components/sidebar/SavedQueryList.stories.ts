import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useQueries } from '@renderer/stores/queries';
import { connected, withQueries } from '../../../../.storybook/seed';
import SavedQueryList from './SavedQueryList.vue';

/** Queries worth keeping, per connection and across all of them. */
const frame = `<div style="width:17rem; height:24rem; display:flex;"><SavedQueryList /></div>`;

const meta = {
  title: 'Sidebar/SavedQueryList',
  component: SavedQueryList,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { SavedQueryList },
    setup: () => {
      withQueries();
      return {};
    },
    template: frame,
  }),
} satisfies Meta<typeof SavedQueryList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = {};

export const Empty: Story = {
  render: () => ({
    components: { SavedQueryList },
    setup: () => {
      connected();
      useQueries().saved = [];
      return {};
    },
    template: frame,
  }),
};
