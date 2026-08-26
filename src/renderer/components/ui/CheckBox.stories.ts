import type { Meta, StoryObj } from '@storybook/vue3-vite';
import CheckBox from './CheckBox.vue';

const meta = {
  title: 'UI/CheckBox',
  component: CheckBox,
  args: { modelValue: false, label: 'Remember the password', disabled: false },
} satisfies Meta<typeof CheckBox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { modelValue: true } };

/** The hint sits under the label and is what the row is actually explaining. */
export const WithHint: Story = {
  args: {
    modelValue: true,
    hint: 'Stored in the system keyring, never in the application database.',
  },
};

export const Disabled: Story = { args: { disabled: true, modelValue: true } };
