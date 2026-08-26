import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { connected } from '../../../../.storybook/seed';
import QuickDocsSheet from './QuickDocsSheet.vue';

/** What a table is, without opening it. */
const meta = {
  title: 'Tabs/QuickDocsSheet',
  component: QuickDocsSheet,
  args: { modelValue: true, entity: { name: 'album', schema: 'music' } },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { QuickDocsSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<QuickDocsSheet v-bind="args" />`,
  }),
} satisfies Meta<typeof QuickDocsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Album: Story = {};

/** A table with a comment on it, which is the first line worth reading. */
export const Documented: Story = { args: { entity: { name: 'artist', schema: 'music' } } };
