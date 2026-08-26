import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StatementHistogram from './StatementHistogram.vue';

/**
 * Calls over time, with a span you can drag out of it.
 *
 * The app keeps this history itself — no engine does — which is why the view
 * has to be able to say that a window is wider than the readings behind it.
 */
const START = Date.UTC(2026, 2, 10, 9, 0, 0);
const STEP = 5 * 60_000;

const buckets = Array.from({ length: 36 }, (_unused, index) => {
  const calls = Math.round(40 + Math.sin(index / 3) * 30 + (index % 5) * 6);
  return {
    from: START + index * STEP,
    to: START + (index + 1) * STEP,
    calls,
    totalMs: calls * 12,
    coveredSeconds: STEP / 1000,
  };
});

const meta = {
  title: 'Visualisation/StatementHistogram',
  component: StatementHistogram,
  args: {
    buckets,
    label: 'Calls',
    selection: null,
    height: 148,
    format: (value: number) => `${value}`,
    formatTime: (at: number) => new Date(at).toISOString().slice(11, 16),
  },
  render: (args) => ({
    components: { StatementHistogram },
    setup: () => ({ args }),
    template: `<div style="width:38rem;"><StatementHistogram v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof StatementHistogram>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Whole: Story = {};

/** A span dragged out of the middle. */
export const WithSelection: Story = {
  args: { selection: [START + 8 * STEP, START + 20 * STEP] as const },
};

/** Two readings, which is what "a window wider than the history" looks like. */
export const Sparse: Story = { args: { buckets: buckets.slice(0, 2) } };

export const Empty: Story = { args: { buckets: [] } };
