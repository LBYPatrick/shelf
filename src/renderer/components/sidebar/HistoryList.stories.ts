import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useQueries } from '@renderer/stores/queries';
import { connected, withQueries } from '../../../../.storybook/seed';
import HistoryList from './HistoryList.vue';

/**
 * Everything that has been run, failures included.
 *
 * A history that only kept the statements that worked would be missing the ones
 * you most want back.
 */
const frame = `<div style="width:17rem; height:24rem; display:flex;"><HistoryList /></div>`;

const meta = {
  title: 'Sidebar/HistoryList',
  component: HistoryList,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { HistoryList },
    setup: () => {
      withQueries();
      return {};
    },
    template: frame,
  }),
} satisfies Meta<typeof HistoryList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Successes and a failure together. */
export const Recent: Story = {};

export const Empty: Story = {
  render: () => ({
    components: { HistoryList },
    setup: () => {
      connected();
      useQueries().history = [];
      return {};
    },
    template: frame,
  }),
};

/** Narrowed by the field in the sidebar's head. */
export const Filtered: Story = {
  render: () => ({
    components: { HistoryList },
    setup: () => {
      withQueries();
      useQueries().filter = 'album';
      return {};
    },
    template: frame,
  }),
};
