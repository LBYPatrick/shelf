import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { PlanNode } from '@shared/explain';
import PlanSheet from './PlanSheet.vue';

/** The plan, in front of the results rather than in place of them. */
const plan = {
  label: 'Hash Join',
  cost: 480,
  rows: 1440,
  children: [
    { label: 'Seq Scan on track', cost: 410, rows: 1230, children: [] },
    { label: 'Hash', cost: 62, rows: 50, children: [] },
  ],
} as unknown as PlanNode;

const meta = {
  title: 'Visualisation/PlanSheet',
  component: PlanSheet,
  args: { modelValue: true, plan },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PlanSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithPlan: Story = {};

/** Nothing to draw — a statement the server would not explain. */
export const NoPlan: Story = { args: { plan: null } };
