import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import TablePropertiesSheet from './TablePropertiesSheet.vue';

/**
 * The structure, in a popup rather than a tab.
 *
 * A tab you have to close afterwards is the wrong shape for something you are
 * checking rather than working in — which is why `structure` stopped being a
 * tab kind.
 */
const meta = {
  title: 'Tabs/TablePropertiesSheet',
  component: TablePropertiesSheet,
  args: { modelValue: true, entity: { name: 'album', schema: 'music' } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { TablePropertiesSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<TablePropertiesSheet v-bind="args" />`,
  }),
} satisfies Meta<typeof TablePropertiesSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Album: Story = {};
export const Unqualified: Story = { args: { entity: { name: 'daily_metrics' } } };
