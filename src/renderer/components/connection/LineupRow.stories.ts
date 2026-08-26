import type { Meta, StoryObj } from '@storybook/vue3-vite';
import LineupRow from './LineupRow.vue';

/**
 * One row of the start screen: a saved connection, or an action.
 *
 * The mark carries the engine's hue, which is what makes a list of six
 * connections scannable without reading any of them.
 */
const meta = {
  title: 'Connection/LineupRow',
  component: LineupRow,
  args: { title: 'Local Postgres', subtitle: 'localhost:5432 · records', mark: 'PG', hue: 220 },
  render: (args) => ({
    components: { LineupRow },
    setup: () => ({ args }),
    template: `<div style="width:26rem;"><LineupRow v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof LineupRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connection: Story = {};

/** An action rather than a database — an icon instead of a mark. */
export const Action: Story = {
  args: {
    title: 'New connection',
    subtitle: undefined,
    mark: undefined,
    icon: 'plus',
    hue: undefined,
  },
};

/** No hue: the mark falls back to the neutral fill rather than inventing one. */
export const NoHue: Story = { args: { hue: undefined, mark: 'DK' } };

/** A name long enough to truncate, and a path long enough to test the subtitle. */
export const Long: Story = {
  args: {
    title: 'Analytics warehouse — production replica (read only)',
    subtitle: '/Users/you/Library/Application Support/shelf/warehouse.duckdb',
    mark: 'DB',
    hue: 40,
  },
};

/** Several, which is the only way to see whether the hues actually separate. */
export const Lineup: Story = {
  render: () => ({
    components: { LineupRow },
    template: `
      <div style="width:26rem; display:flex; flex-direction:column; gap:0.25rem;">
        <LineupRow title="Local Postgres" subtitle="localhost:5432" mark="PG" :hue="220" />
        <LineupRow title="Staging" subtitle="staging.internal:3306" mark="MY" :hue="30" />
        <LineupRow title="Analytics" subtitle="warehouse.duckdb" mark="DK" :hue="120" />
        <LineupRow title="Cache" subtitle="localhost:6379" mark="RD" :hue="0" />
        <LineupRow title="New connection" icon="plus" />
      </div>
    `,
  }),
};
