import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { NO_FILTER, addCriterion } from '@shared/jobFilter';
import { useJobs } from '@renderer/stores/jobs';
import { withJobs } from '../../../../.storybook/seed';
import JobList from './JobList.vue';

/**
 * Dispatched queries, newest first.
 *
 * A hundred are kept, so the list is also a log — and a log is read by
 * searching it. The card is the same container a tab is, because they are the
 * same kind of object: a thing you click to open.
 */
const frame = `<div style="width:17rem; height:26rem; display:flex;"><JobList /></div>`;

const meta = {
  title: 'Sidebar/JobList',
  component: JobList,
  render: () => ({
    components: { JobList },
    setup: () => {
      withJobs();
      return {};
    },
    template: frame,
  }),
} satisfies Meta<typeof JobList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Done, running and failed together — every state a card can be in. */
export const EveryState: Story = {};

export const Empty: Story = {
  render: () => ({
    components: { JobList },
    setup: () => {
      useJobs().jobs = [];
      return {};
    },
    template: frame,
  }),
};

/** Narrowed by two chips. */
export const Filtered: Story = {
  render: () => ({
    components: { JobList },
    setup: () => {
      withJobs();
      useJobs().filter = addCriterion(
        addCriterion(NO_FILTER, 'status', 'done'),
        'took',
        'long'
      );
      return {};
    },
    template: frame,
  }),
};

/** Narrowed to nothing, which is a different fact from nothing existing. */
export const NothingMatches: Story = {
  render: () => ({
    components: { JobList },
    setup: () => {
      withJobs();
      useJobs().filter = { ...NO_FILTER, text: 'nothing has this name' };
      return {};
    },
    template: frame,
  }),
};
