import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { FIELDS, ROWS } from '../../../../.storybook/fixtures/database';
import ExportSheet from './ExportSheet.vue';

/**
 * Rows out to a file, or to the clipboard.
 *
 * A file is streamed from the connection host straight to disk, so the size of
 * the table does not matter. Where there is nothing to re-run — a table opened
 * from the tree, with no rows in this process — the clipboard is unavailable
 * and the sheet says so rather than offering it.
 */
const meta = {
  title: 'Grid/ExportSheet',
  component: ExportSheet,
  args: { modelValue: true, fields: FIELDS, rows: ROWS, name: 'album' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ExportSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rows on screen: both destinations are available. */
export const FromResults: Story = {
  args: { writeFile: async () => undefined },
};

/** A whole table: the host streams it, and the clipboard is not offered. */
export const WholeTable: Story = {
  args: { rows: [], fields: [], fileSource: 'table', writeFile: async () => undefined },
};

/** No writer at all — the clipboard is the only way out. */
export const ClipboardOnly: Story = { args: { writeFile: undefined } };

/** A query preview may be a tiny part of an answer whose total is not known. */
export const TruncatedQuery: Story = {
  args: { truncated: true, writeFile: async () => undefined },
};
export const KnownTotal: Story = {
  args: { truncated: true, fullRows: 25000, writeFile: async () => undefined },
};
export const SavedJob: Story = {
  args: { fileSource: 'job', fullRows: 25000, writeFile: async () => undefined },
};
export const LongName: Story = {
  args: {
    name: 'Quarterly analysis of transactions across every region and account with a very long descriptive name',
    writeFile: async () => undefined,
  },
};
export const EmptyResults: Story = { args: { rows: [], writeFile: undefined } };
