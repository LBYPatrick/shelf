import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StatusChip from './StatusChip.vue';

/** How a job says what happened to it, in four states. */
const meta = {
  title: 'UI/StatusChip',
  component: StatusChip,
  args: { tone: 'done', label: 'Done' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['pending', 'running', 'done', 'failed'] },
  },
} satisfies Meta<typeof StatusChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Done: Story = {};
export const Running: Story = { args: { tone: 'running', label: 'Running' } };
export const Pending: Story = { args: { tone: 'pending', label: 'Queued' } };
export const Failed: Story = { args: { tone: 'failed', label: 'Failed' } };

/**
 * All four together — the only way to check that colour is not the *only*
 * thing telling them apart, which is what the glyphs are for.
 */
export const EveryTone: Story = {
  render: () => ({
    components: { StatusChip },
    template: `
      <div style="display:flex; gap:0.5rem;">
        <StatusChip tone="pending" label="Queued" />
        <StatusChip tone="running" label="Running" />
        <StatusChip tone="done" label="Done" />
        <StatusChip tone="failed" label="Failed" />
      </div>
    `,
  }),
};
