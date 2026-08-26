import type { Meta, StoryObj } from '@storybook/vue3-vite';
import InlinePicker from './InlinePicker.vue';

/**
 * A choice that reads as a word, not as a form field.
 *
 * The scope and the provider used to be two selects in a bar of their own —
 * half a window spent on two settings that are set once and then read. Quiet
 * until pointed at is the right loudness for something you check.
 */
const meta = {
  title: 'Assistant/InlinePicker',
  component: InlinePicker,
  args: {
    modelValue: 'a',
    ariaLabel: 'Provider',
    icon: 'assistant',
    options: [
      { id: 'a', label: 'Claude Code · default' },
      { id: 'b', label: 'Anthropic · claude-opus-5' },
      { id: 'manage', label: 'Manage providers', icon: 'settings', startsGroup: true },
    ],
  },
  render: (args) => ({
    components: { InlinePicker },
    setup: () => ({ args }),
    // Room below, because the menu opens upward out of the control.
    template: `<div style="padding:8rem 1rem 1rem;"><InlinePicker v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof InlinePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Provider: Story = {};

export const Scope: Story = {
  args: {
    modelValue: 'connection',
    ariaLabel: 'What it can see',
    icon: 'database',
    options: [
      { id: 'connection', label: 'The whole connection', icon: 'database' },
      { id: 'music', label: 'music', icon: 'folder' },
      { id: 'ops', label: 'ops', icon: 'folder' },
    ],
  },
};

/** Nothing chosen yet, which is what an unconfigured assistant looks like. */
export const Placeholder: Story = {
  args: { modelValue: '', placeholder: 'Choose a provider', options: [] },
};

/** A name long enough to prove the control truncates rather than growing. */
export const LongName: Story = {
  args: {
    modelValue: 'a',
    options: [
      { id: 'a', label: 'A provider with a very long configured name · a-long-model-id' },
    ],
  },
};
