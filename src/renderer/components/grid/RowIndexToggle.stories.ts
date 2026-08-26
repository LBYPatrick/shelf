import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RowIndexToggle from './RowIndexToggle.vue';

/**
 * Where the grid's row numbers start.
 *
 * A database person counting rows and a programmer indexing an array want
 * different answers, and both are right — so it is a control rather than a
 * decision the app makes for them.
 */
const meta = {
  title: 'Grid/RowIndexToggle',
  component: RowIndexToggle,
} satisfies Meta<typeof RowIndexToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
