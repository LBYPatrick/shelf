import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RankedBars from './RankedBars.vue';

/**
 * The slowest statements, as bars on one scale.
 *
 * One scale is the whole point: bars normalised per row would make the third
 * slowest query look the same length as the slowest, which is precisely the
 * comparison somebody opens this view to make.
 */
const meta = {
  title: 'Visualisation/RankedBars',
  component: RankedBars,
  args: {
    label: 'Total time',
    selected: null,
    bars: [
      { id: 'a', label: 'SELECT * FROM music.track WHERE album_id = $1', value: 42_180 },
      { id: 'b', label: 'UPDATE ops.daily_metrics SET plays = plays + $1', value: 18_940 },
      { id: 'c', label: 'SELECT count(*) FROM music.album', value: 9_310 },
      {
        id: 'd',
        label: 'INSERT INTO ops.audit_log (actor, action) VALUES ($1, $2)',
        value: 4_120,
      },
      { id: 'e', label: 'SELECT 1', value: 240 },
    ],
  },
  render: (args) => ({
    components: { RankedBars },
    setup: () => ({ args }),
    template: `<div style="width:34rem;"><RankedBars v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof RankedBars>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ranked: Story = {};

/** Selected, so the chart and the table beside it stay in step. */
export const WithSelection: Story = { args: { selected: 'b' } };

/**
 * One statement dwarfing the rest — the case that shows whether the small bars
 * are still legible rather than collapsing to a line.
 */
export const OneDominant: Story = {
  args: {
    bars: [
      { id: 'a', label: 'SELECT * FROM music.track', value: 980_000 },
      { id: 'b', label: 'SELECT count(*) FROM music.album', value: 1_200 },
      { id: 'c', label: 'SELECT 1', value: 40 },
    ],
  },
};

export const Empty: Story = { args: { bars: [] } };
