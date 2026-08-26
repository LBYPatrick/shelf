import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { FIELDS, ROWS } from '../../../../.storybook/fixtures/database';
import ResultTable from './ResultTable.vue';

/**
 * Rows the assistant read, drawn as a table.
 *
 * Not the data grid: that is a virtualised, editable, resizable surface with
 * its own scroll and its own observers, and mounting one per answer would put
 * several of them inside a scrolling transcript.
 */
const meta = {
  title: 'Assistant/ResultTable',
  component: ResultTable,
  args: { fields: FIELDS, rows: ROWS, truncated: false, durationMs: 12 },
  render: (args) => ({
    components: { ResultTable },
    setup: () => ({ args }),
    template: `<div style="width:38rem;"><ResultTable v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ResultTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rows: Story = {};

/** The server stopped early — a different fact from this table showing part. */
export const CutOff: Story = { args: { truncated: true, durationMs: 940 } };

/** More rows than the table draws, which it says rather than hides. */
export const MoreThanItShows: Story = {
  args: {
    rows: Array.from({ length: 120 }, (_unused, index) => ({
      id: index + 1,
      title: `Album ${index + 1}`,
      released: null,
      runtime_seconds: 2000 + index,
      notes: null,
    })),
  },
};

export const OneRow: Story = { args: { rows: ROWS.slice(0, 1) } };

export const NoRows: Story = { args: { rows: [] } };
