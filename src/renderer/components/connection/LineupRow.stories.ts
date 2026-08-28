import type { Meta, StoryObj } from '@storybook/vue3-vite';
import LineupRow from './LineupRow.vue';

/**
 * One row of the start screen: a saved connection, or an action.
 *
 * The mark is the engine's own logo on the engine's own hue, which is what
 * makes a list of six connections scannable without reading any of them.
 */
const meta = {
  title: 'Connection/LineupRow',
  component: LineupRow,
  args: {
    title: 'Local Postgres',
    subtitle: 'localhost:5432 · records',
    engine: 'postgres' as const,
  },
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
    engine: undefined,
    icon: 'plus',
  },
};

/**
 * The one engine `simple-icons` does not carry.
 *
 * Amazon's service marks are not in the set, so DynamoDB falls back to the two
 * letters the catalogue has always held. It is here because it is the state
 * every future engine is in until somebody maps it.
 */
export const NoLogo: Story = { args: { engine: 'dynamodb' as const } };

/** A name long enough to truncate, and a path long enough to test the subtitle. */
export const Long: Story = {
  args: {
    title: 'Analytics warehouse — production replica (read only)',
    subtitle: '/Users/you/Library/Application Support/shelf/warehouse.duckdb',
    engine: 'duckdb' as const,
  },
};

/** Several, which is the only way to see whether the marks actually separate. */
export const Lineup: Story = {
  render: () => ({
    components: { LineupRow },
    template: `
      <div style="width:26rem; display:flex; flex-direction:column; gap:0.25rem;">
        <LineupRow title="Local Postgres" subtitle="localhost:5432" engine="postgres" />
        <LineupRow title="Staging" subtitle="staging.internal:3306" engine="mysql" />
        <LineupRow title="Analytics" subtitle="warehouse.duckdb" engine="duckdb" />
        <LineupRow title="Cache" subtitle="localhost:6379" engine="redis" />
        <LineupRow title="Documents" subtitle="cluster0.mongodb.net" engine="mongodb" />
        <LineupRow title="Events" subtitle="eu-west-1" engine="dynamodb" />
        <LineupRow title="New connection" icon="plus" />
      </div>
    `,
  }),
};
