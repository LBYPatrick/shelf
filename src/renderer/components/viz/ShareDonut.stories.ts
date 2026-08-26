import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ShareDonut from './ShareDonut.vue';

/** Where the time went, as a share of the window rather than as raw numbers. */
const meta = {
  title: 'Visualisation/ShareDonut',
  component: ShareDonut,
  args: {
    total: '74.7 s',
    caption: 'Total time this hour',
    size: 116,
    slices: [
      { id: 'a', label: 'music.track', value: 42_180 },
      { id: 'b', label: 'ops.daily_metrics', value: 18_940 },
      { id: 'c', label: 'music.album', value: 9_310 },
      { id: 'd', label: 'everything else', value: 4_360 },
    ],
  },
} satisfies Meta<typeof ShareDonut>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A single slice, which must still read as a ring and not as a bug. */
export const OneSlice: Story = {
  args: { slices: [{ id: 'a', label: 'music.track', value: 1 }], total: '12 ms' },
};

export const Large: Story = { args: { size: 200 } };

export const Empty: Story = { args: { slices: [], total: '0 ms' } };
