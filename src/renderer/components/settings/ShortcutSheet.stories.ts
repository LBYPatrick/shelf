import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { setBinding } from '@renderer/lib/keybindings';
import { connected } from '../../../../.storybook/seed';
import ShortcutSheet from './ShortcutSheet.vue';

/**
 * The keymap.
 *
 * Live: clicking a chord arms the row and the next keystroke is captured rather
 * than obeyed. The JSON view is the same state as a document.
 */
const meta = {
  title: 'Settings/ShortcutSheet',
  component: ShortcutSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ShortcutSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => ({
    components: { ShortcutSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<ShortcutSheet v-bind="args" />`,
  }),
};

/**
 * A rebound chord that collides with another action — the state the warning
 * exists for, and one that takes two deliberate edits to reach in the app.
 */
export const WithConflict: Story = {
  render: (args) => ({
    components: { ShortcutSheet },
    setup: () => {
      connected();
      setBinding('tab.new', ['mod+k']);
      return { args };
    },
    template: `<ShortcutSheet v-bind="args" />`,
  }),
};
