import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { summarize } from '@shared/latency';
import LatencyTrace from './LatencyTrace.vue';

/**
 * Round trips, one column each.
 *
 * The three states worth looking at are hard to reach in the app on purpose:
 * a healthy local socket, a link that is slow but even, and one that is fine
 * except when it is not.
 */
const meta = {
  title: 'Viz/LatencyTrace',
  component: LatencyTrace,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof LatencyTrace>;

export default meta;
type Story = StoryObj<typeof meta>;

const ms = (value: number) =>
  value >= 10
    ? `${Math.round(value)} ms`
    : value >= 1
      ? `${value.toFixed(1)} ms`
      : `${value.toFixed(2)} ms`;

/* Fixed rather than random: a chart that redraws differently every time cannot
   be compared with itself across a change. */
const shape = (base: number, spread: number, count = 15) =>
  Array.from({ length: count }, (_, i) => base + spread * Math.abs(Math.sin(i * 1.7)));

const show = (samples: number[]) => ({
  render: () => ({
    components: { LatencyTrace },
    setup: () => ({ samples, summary: summarize(samples), ms }),
    template: `<div style="width: 24rem">
      <LatencyTrace :samples="samples" :summary="summary" :format="ms" label="Round trip" />
    </div>`,
  }),
});

/** A local socket: fast, and the same every time. */
export const Steady: Story = show(shape(0.4, 0.15));

/** Across a network: slow, but honestly slow. */
export const Distant: Story = show(shape(180, 20));

/** The one worth catching — fine fourteen times and terrible once. */
export const Erratic: Story = {
  ...show([...shape(2, 0.5, 14), 340]),
};
