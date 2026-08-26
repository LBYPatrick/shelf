import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ZoomControl from './ZoomControl.vue';

/**
 * Zoom, as three targets rather than a slider.
 *
 * Each press is a *ratio*, so every notch moves the same visual distance —
 * which a linear step does not, and which is why linear zoom feels fast at the
 * bottom and stuck at the top.
 */
const meta = {
  title: 'Visualisation/ZoomControl',
  component: ZoomControl,
  args: { scale: 1 },
} satisfies Meta<typeof ZoomControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Actual: Story = {};
export const ZoomedOut: Story = { args: { scale: 0.35 } };
export const ZoomedIn: Story = { args: { scale: 3.2 } };
