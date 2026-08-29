import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useAssistant } from '@renderer/stores/assistant';
import { connected, withProvider } from '../../../../.storybook/seed';
import SettingsSheet from './SettingsSheet.vue';

/**
 * Preferences.
 *
 * The appearance section is live: every control applies immediately, because
 * choosing an accent is a visual decision and you should be able to see it
 * being made rather than confirm and hope.
 */
const meta = {
  title: 'Settings/SettingsSheet',
  component: SettingsSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => ({
    components: { SettingsSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<SettingsSheet v-bind="args" />`,
  }),
};

/** With a provider on file, which changes what the assistant row says. */
export const WithAssistant: Story = {
  render: (args) => ({
    components: { SettingsSheet },
    setup: () => {
      connected();
      void withProvider();
      void useAssistant();
      return { args };
    },
    template: `<SettingsSheet v-bind="args" />`,
  }),
};
