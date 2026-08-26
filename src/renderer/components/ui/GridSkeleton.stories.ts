import type { Meta, StoryObj } from '@storybook/vue3-vite';
import GridSkeleton from './GridSkeleton.vue';

/**
 * What the grid shows while the first page is on its way.
 *
 * The shape of the answer, drawn before the answer — which is what stops the
 * pane collapsing to nothing and then jumping back to full height.
 */
const meta = {
  title: 'UI/GridSkeleton',
  component: GridSkeleton,
  args: { rows: 10, columns: 5 },
  render: (args) => ({
    components: { GridSkeleton },
    setup: () => ({ args }),
    template: `<div style="width:40rem; height:20rem;"><GridSkeleton v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof GridSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Narrow: Story = { args: { columns: 2, rows: 6 } };
export const Wide: Story = { args: { columns: 9, rows: 14 } };
