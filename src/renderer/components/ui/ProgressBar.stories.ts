import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ProgressBar from './ProgressBar.vue';

/**
 * A wait with no percentage to it. Used where the app genuinely cannot say how
 * far along it is — a query the server has not answered yet.
 */
const meta = {
  title: 'UI/ProgressBar',
  component: ProgressBar,
  args: { tone: 'primary' },
  argTypes: { tone: { control: 'inline-radio', options: ['primary', 'error'] } },
  render: (args) => ({
    components: { ProgressBar },
    setup: () => ({ args }),
    template: `<div style="width:20rem;"><ProgressBar v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Error: Story = { args: { tone: 'error' } };
