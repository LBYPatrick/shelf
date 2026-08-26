import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { PlanNode } from '@shared/explain';
import ExplainTree from './ExplainTree.vue';

/**
 * The plan, as a tree whose width and tint follow cost.
 *
 * The expensive step is meant to be the one that stands out without being read
 * — which is the whole argument for drawing a plan rather than printing it.
 */
const node = (
  label: string,
  cost: number,
  children: PlanNode[] = [],
  detail?: string
): PlanNode =>
  ({
    label,
    cost,
    rows: Math.round(cost * 3),
    children,
    ...(detail ? { detail } : {}),
  }) as PlanNode;

const meta = {
  title: 'Visualisation/ExplainTree',
  component: ExplainTree,
  args: {
    plan: node('Hash Join', 480, [
      node('Seq Scan on track', 410, [], 'filter: play_count > 100'),
      node('Hash', 62, [node('Index Scan on album', 58, [], 'using album_pkey')]),
    ]),
  },
  render: (args) => ({
    components: { ExplainTree },
    setup: () => ({ args }),
    template: `<div style="width:44rem; height:22rem;"><ExplainTree v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ExplainTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Join: Story = {};

/** One node — the plan for a statement with nothing to decide. */
export const Single: Story = { args: { plan: node('Result', 1) } };

/** Deep, which is where the level spacing has to hold up. */
export const Deep: Story = {
  args: {
    plan: node('Limit', 900, [
      node('Sort', 890, [
        node('Aggregate', 850, [
          node('Nested Loop', 800, [
            node('Seq Scan on track', 700),
            node('Index Scan on album', 90),
          ]),
        ]),
      ]),
    ]),
  },
};

/** One step dominating, which is the case the tint exists for. */
export const OneExpensiveStep: Story = {
  args: {
    plan: node('Nested Loop', 12_000, [
      node('Seq Scan on track', 11_950, [], 'no index used'),
      node('Index Scan on album', 12),
    ]),
  },
};
