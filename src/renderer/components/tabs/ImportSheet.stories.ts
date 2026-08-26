import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { COLUMNS } from '../../../../.storybook/fixtures/database';
import { connected } from '../../../../.storybook/seed';
import ImportSheet from './ImportSheet.vue';

/**
 * Rows in from a file, matched by column name.
 *
 * The file is read in the host and inserted in batches inside one transaction,
 * so a large import never crosses into this process.
 */
const meta = {
  title: 'Tabs/ImportSheet',
  component: ImportSheet,
  args: {
    modelValue: true,
    entity: { name: 'album', schema: 'music' },
    columns: COLUMNS['music.album'] ?? [],
    connectionId: 'conn-local',
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ImportSheet },
    setup: () => {
      connected();
      return { args };
    },
    template: `<ImportSheet v-bind="args" />`,
  }),
} satisfies Meta<typeof ImportSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeAFile: Story = {};

/** A table with few columns, where the mapping is short. */
export const FewColumns: Story = {
  args: {
    entity: { name: 'daily_metrics', schema: 'ops' },
    columns: COLUMNS['ops.daily_metrics'] ?? [],
  },
};
