import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useAssistant } from '@renderer/stores/assistant';
import { connected, withProvider } from '../../../../.storybook/seed';
import ProviderSheet from './ProviderSheet.vue';

/**
 * Where the assistant's providers are configured.
 *
 * A list and a form in one sheet, which the sheet is built for: it measures its
 * content and animates to the height it needs, so moving between the two reads
 * as one panel changing rather than two popups.
 */
const meta = {
  title: 'Assistant/ProviderSheet',
  component: ProviderSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProviderSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing configured — the state everyone sees first. */
export const Empty: Story = {
  render: (args) => ({
    components: { ProviderSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<ProviderSheet v-bind="args" />`,
  }),
};

export const OneProvider: Story = {
  render: (args) => ({
    components: { ProviderSheet },
    setup: () => {
      connected();
      withProvider();
      return { args };
    },
    template: `<ProviderSheet v-bind="args" />`,
  }),
};

/** Several, including two of the same driver — which is what instances are for. */
export const Several: Story = {
  render: (args) => ({
    components: { ProviderSheet },
    setup: () => {
      connected();
      const assistant = useAssistant();
      assistant.providers = [
        { id: 'p1', name: 'Claude Code', driver: 'claudeCode', model: 'default', createdAt: 1 },
        {
          id: 'p2',
          name: 'Work key',
          driver: 'anthropic',
          model: 'claude-opus-5',
          createdAt: 2,
        },
        {
          id: 'p3',
          name: 'Personal key',
          driver: 'anthropic',
          model: 'claude-sonnet-5',
          createdAt: 3,
        },
        {
          id: 'p4',
          name: 'Ollama',
          driver: 'openaiCompatible',
          model: 'qwen2.5-coder',
          baseUrl: 'http://localhost:11434/v1',
          createdAt: 4,
        },
      ];
      assistant.preferredId = 'p2';
      return { args };
    },
    template: `<ProviderSheet v-bind="args" />`,
  }),
};
