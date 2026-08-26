import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RangeSlider from './RangeSlider.vue';

/**
 * The one continuous control in the app — the opacity of the window's glass.
 *
 * The dial *subtracts*; it does not scale. Scaling every alpha toward zero
 * closes the gaps between the surfaces as it thins them, and at the bottom of
 * the range the whole window converges on one flat sheet.
 */
const meta = {
  title: 'UI/RangeSlider',
  component: RangeSlider,
  args: { modelValue: 0.6, min: 0.2, max: 1, step: 0.01, ariaLabel: 'Opacity' },
  render: (args) => ({
    components: { RangeSlider },
    setup: () => ({ args }),
    template: `<div style="width:18rem;"><RangeSlider v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof RangeSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Middle: Story = {};
export const AtTheFloor: Story = { args: { modelValue: 0.2 } };
export const AtTheCeiling: Story = { args: { modelValue: 1 } };
