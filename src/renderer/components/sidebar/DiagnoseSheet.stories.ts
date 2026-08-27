import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import DiagnoseSheet from './DiagnoseSheet.vue';

/**
 * Is this connection well?
 *
 * Live against the mock bridge: opening the story runs the probes, so the trace
 * fills in and the catalogue checks land one at a time, which is what it does
 * in the app.
 */
const meta = {
  title: 'Sidebar/DiagnoseSheet',
  component: DiagnoseSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DiagnoseSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => ({
    components: { DiagnoseSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<DiagnoseSheet v-bind="args" />`,
  }),
};
