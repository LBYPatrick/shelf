import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ToggleSwitch from './ToggleSwitch.vue';

/**
 * A switch, not a checkbox: it takes effect the moment it is moved, where a
 * checkbox waits for a form to be submitted.
 */
const meta = {
  title: 'UI/ToggleSwitch',
  component: ToggleSwitch,
  args: { modelValue: false, ariaLabel: 'Wrap long lines', disabled: false },
} satisfies Meta<typeof ToggleSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { modelValue: true } };
export const Disabled: Story = { args: { disabled: true } };

/** Both, so the travel of the knob is legible as one movement. */
export const Both: Story = {
  render: () => ({
    components: { ToggleSwitch },
    setup: () => ({ off: false, on: true }),
    template: `
      <div style="display:flex; gap:1rem;">
        <ToggleSwitch :model-value="false" aria-label="Off" />
        <ToggleSwitch :model-value="true" aria-label="On" />
      </div>
    `,
  }),
};
