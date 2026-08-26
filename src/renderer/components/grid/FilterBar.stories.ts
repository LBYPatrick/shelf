import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { COLUMNS } from '../../../../.storybook/fixtures/database';
import FilterBar from './FilterBar.vue';

/**
 * Narrowing a table, either by building a condition or by writing one.
 *
 * Operators that take no value hide the field rather than disabling it: a box
 * you cannot type in beside "is null" is a question with no answer.
 */
const meta = {
  title: 'Grid/FilterBar',
  component: FilterBar,
  args: { columns: COLUMNS['music.album'] ?? [], applied: undefined },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { FilterBar },
    setup: () => ({ args }),
    template: `<div style="width:52rem;"><FilterBar v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** Something in force, so the bar can show it is dirty. */
export const Applied: Story = {
  args: {
    applied: {
      kind: 'builder',
      filters: [{ column: 'released', operator: '>=', value: '1970-01-01' }],
    },
  },
};

/** Whatever the reader typed, for the conditions the builder cannot express. */
export const RawExpression: Story = {
  args: {
    applied: { kind: 'raw', expression: "title ilike '%blue%' and released is not null" },
  },
};
