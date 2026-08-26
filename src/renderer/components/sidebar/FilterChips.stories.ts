import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { NO_FILTER, addCriterion, toggleCriterion } from '@shared/jobFilter';
import FilterChips from './FilterChips.vue';

/**
 * The filter, as the conditions it is made of.
 *
 * Nothing is drawn until a condition exists, and every condition that exists is
 * drawn — the inverse of four dropdowns permanently reporting "any". The chip
 * body is a *switch*: crossing one out parks it without forgetting its value,
 * which is what makes narrowing a log iterative rather than a series of
 * retypes.
 */
const one = addCriterion(NO_FILTER, 'status', 'done');
const two = addCriterion(one, 'took', 'long');

const meta = {
  title: 'Sidebar/FilterChips',
  component: FilterChips,
  args: { modelValue: NO_FILTER },
  render: (args) => ({
    components: { FilterChips },
    setup: () => ({ args }),
    template: `<div style="width:17rem; padding-bottom:12rem;"><FilterChips v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof FilterChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing yet — one dashed button and no chrome at all. */
export const Empty: Story = {};

export const OneCondition: Story = { args: { modelValue: one } };

export const TwoConditions: Story = { args: { modelValue: two } };

/** Parked, not discarded: still there, still remembering what it was. */
export const OneSwitchedOff: Story = { args: { modelValue: toggleCriterion(two, 0) } };

/** Enough of them to wrap, which is what the sidebar's width actually allows. */
export const Wrapping: Story = {
  args: {
    modelValue: addCriterion(
      addCriterion(addCriterion(two, 'started', 'today'), 'finished', 'hour'),
      'status',
      'failed'
    ),
  },
};
