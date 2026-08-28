import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import StorageSheet from './StorageSheet.vue';

/**
 * What the app is holding, by category.
 *
 * The mock reports a machine that has been used — one category two hundred
 * megabytes larger than every other — because that is the state the sheet is
 * for, and the one nobody can produce on demand in a fresh app.
 */
const meta = {
  title: 'Settings/StorageSheet',
  component: StorageSheet,
  args: { modelValue: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StorageSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => ({
    components: { StorageSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<StorageSheet v-bind="args" />`,
  }),
};
