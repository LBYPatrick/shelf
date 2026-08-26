import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { withJobs } from '../../../../.storybook/seed';
import JobTab from './JobTab.vue';

/**
 * A dispatched job's rows, read back out of the spool.
 *
 * The rows never entered this process on the way in — they went from the cursor
 * to disk — and they do not on the way out either: the tab pages the file.
 */
const meta = {
  title: 'Tabs/JobTab',
  component: JobTab,
  args: { jobId: 'j1', active: true },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { JobTab },
    setup: () => {
      withJobs();
      return { args };
    },
    template: `<div style="width:60rem; height:30rem; display:flex;"><JobTab v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof JobTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Finished: Story = {};

/** Still running: there is nothing to page yet, and it says so. */
export const StillRunning: Story = { args: { jobId: 'j2' } };

/** Failed, which is a job with an error rather than a job with no rows. */
export const Failed: Story = { args: { jobId: 'j3' } };

/** A job that is no longer in the list — its spool was swept. */
export const Missing: Story = { args: { jobId: 'gone' } };
