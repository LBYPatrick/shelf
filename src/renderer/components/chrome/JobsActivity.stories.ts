import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useJobs } from '@renderer/stores/jobs';
import { withJobs } from '../../../../.storybook/seed';
import JobsActivity from './JobsActivity.vue';

const meta = { title: 'Chrome/JobsActivity', component: JobsActivity } satisfies Meta<
  typeof JobsActivity
>;
export default meta;
type Story = StoryObj<typeof meta>;
const render = (count: number, controls = false) => ({
  components: { JobsActivity },
  setup() {
    withJobs();
    const jobs = useJobs();
    const job = jobs.jobs.find((job) => job.status === 'running')!;
    jobs.jobs = Array.from({ length: count }, (_, index) => ({
      ...job,
      id: `activity-${index}`,
    }));
    const finish = (failed: boolean) => {
      jobs.jobs = jobs.jobs.map((job, index) => ({
        ...job,
        status: failed && index === 0 ? 'failed' : 'done',
        finishedAt: Date.now(),
      }));
    };
    const restart = () => {
      jobs.jobs = [{ ...job, status: 'running' }];
    };
    return { controls, finish, restart };
  },
  template: `<div style="display:flex; align-items:center; gap:var(--gap); padding:var(--gap-section)"><JobsActivity /><template v-if="controls"><button @click="finish(false)">Finish successfully</button><button @click="finish(true)">Fail a job</button><button @click="restart">Start again</button></template></div>`,
});
export const Idle: Story = { render: () => render(0) };
export const Running: Story = { render: () => render(3) };
export const ManyRunning: Story = { render: () => render(120) };
/** Exercise running → completion → restart, including interruption of feedback. */
export const Lifecycle: Story = { render: () => render(3, true) };
