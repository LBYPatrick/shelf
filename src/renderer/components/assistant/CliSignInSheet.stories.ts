import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import CliSignInSheet from './CliSignInSheet.vue';

/**
 * The sheet a signed-out command-line assistant raises.
 *
 * Hard to reach in the app on purpose — it needs a machine with the CLI
 * installed and nobody signed in to it — which is exactly the case the
 * storybook is for.
 */
const meta = {
  title: 'Assistant/CliSignInSheet',
  component: CliSignInSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CliSignInSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClaudeCode: Story = {
  args: { kind: 'claudeCode' },
  render: (args) => ({
    components: { CliSignInSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<CliSignInSheet v-bind="args" />`,
  }),
};

export const Codex: Story = {
  args: { kind: 'codex' },
  render: (args) => ({
    components: { CliSignInSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<CliSignInSheet v-bind="args" />`,
  }),
};
