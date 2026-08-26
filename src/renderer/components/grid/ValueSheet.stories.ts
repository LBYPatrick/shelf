import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ValueSheet from './ValueSheet.vue';

/**
 * One cell, in full.
 *
 * The inspector renders the value exactly the way the cell did — otherwise it
 * would disagree with the grid about what the value *is*, which is the one
 * thing it exists to settle.
 */
const meta = {
  title: 'Grid/ValueSheet',
  component: ValueSheet,
  args: { modelValue: true, column: 'notes', value: 'Remastered in 2011.' },
} satisfies Meta<typeof ValueSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {};

/** JSON is pretty-printed; everything else is shown exactly as stored. */
export const Json: Story = {
  args: {
    column: 'metadata',
    value: {
      $: 'json',
      data: '{"producer":"Sylvia Massy","reissued":false,"pressings":[1988,2011]}',
    },
  },
};

export const Null: Story = { args: { column: 'released', value: null } };

export const Instant: Story = {
  args: { column: 'released', value: { $: 'date', data: '1973-03-01T00:00:00.000Z' } },
};

export const Binary: Story = {
  args: { column: 'cover', value: { $: 'binary', data: 'iVBORw0KGgoAAAANSUhEUg==' } },
};

/** Wider than any cell, which is the reason this sheet exists. */
export const VeryLong: Story = {
  args: {
    column: 'biography',
    value: Array.from({ length: 40 }, (_u, i) => `Paragraph ${i + 1} of a long note.`).join(
      '\n\n'
    ),
  },
};
