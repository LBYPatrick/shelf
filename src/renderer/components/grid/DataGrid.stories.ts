import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { FIELDS, ROWS } from '../../../../.storybook/fixtures/database';
import DataGrid from './DataGrid.vue';

/**
 * The grid.
 *
 * Its column widths are measured in a canvas from text metrics over a sample of
 * rows, never by the layout: Tabulator's `fitData` family sizes a column by
 * clearing its width and reading `offsetWidth` off every cell, which is a
 * forced reflow each.
 *
 * A locked cell always says *why* it is locked — that is what `editable`
 * carries.
 */
const frame = `<div style="width:52rem; height:22rem;"><DataGrid v-bind="args" /></div>`;

const meta = {
  title: 'Grid/DataGrid',
  component: DataGrid,
  args: { fields: FIELDS, rows: ROWS, loading: false },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { DataGrid },
    setup: () => ({ args }),
    template: frame,
  }),
} satisfies Meta<typeof DataGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rows: Story = {};

/** The skeleton, before the first page lands. */
export const Loading: Story = { args: { loading: true, rows: [], fields: [] } };

export const NoRows: Story = { args: { rows: [] } };

/** One column locked, with the reason the tooltip will give. */
export const WithLockedColumn: Story = {
  args: {
    editable: new Map([
      ['id', { editable: false, reason: 'missing-primary-key' }],
      ['title', { editable: true }],
      ['released', { editable: true }],
      ['runtime_seconds', { editable: false, reason: 'computed-column' }],
      ['notes', { editable: true }],
    ]),
  },
};

/** Many rows, which is what the virtualiser is for. */
export const Many: Story = {
  args: {
    rows: Array.from({ length: 2_000 }, (_unused, index) => ({
      id: index + 1,
      title: `Album ${index + 1}`,
      released: null,
      runtime_seconds: 1800 + (index % 900),
      notes: index % 7 === 0 ? 'A note that is long enough to need the inspector.' : null,
    })),
  },
};

/** Wide, so the last column takes up the slack rather than leaving a gap. */
export const ManyColumns: Story = {
  args: {
    fields: Array.from({ length: 14 }, (_u, i) => ({ name: `column_${i + 1}` })),
    rows: Array.from({ length: 30 }, (_u, row) =>
      Object.fromEntries(
        Array.from({ length: 14 }, (_c, i) => [`column_${i + 1}`, `r${row}c${i}`])
      )
    ),
  },
};
