import type { Meta, StoryObj } from '@storybook/vue3-vite';
import TextInput from './TextInput.vue';

/**
 * The one text field in the app.
 *
 * It does not take daisyUI's `.input` class — a component of ours wearing a
 * framework's name inherits its border, height and width clamp on top of
 * whatever we drew. It is `.textfield`, defined once in `controls.css`.
 */
const meta = {
  title: 'UI/TextInput',
  component: TextInput,
  args: { modelValue: '', placeholder: 'localhost', invalid: false, disabled: false },
  argTypes: { type: { control: 'inline-radio', options: ['text', 'password', 'number'] } },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { args: { modelValue: 'analytics.internal' } };

/** Invalid says so on the field, not only in a message under it. */
export const Invalid: Story = { args: { modelValue: 'not a port', invalid: true } };

export const Disabled: Story = { args: { modelValue: 'read only', disabled: true } };

/** For anything the reader will compare character by character. */
export const Monospace: Story = {
  args: { modelValue: 'postgres://user@localhost:5432/records', monospace: true },
};

export const Password: Story = { args: { type: 'password', modelValue: 'hunter2' } };
