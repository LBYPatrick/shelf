import type { Meta, StoryObj } from '@storybook/vue3-vite';
import CircuitRing from './CircuitRing.vue';

/**
 * A line that runs the perimeter of the control it is inside.
 *
 * Used while a query is running: it traces the button rather than spinning
 * beside it, so the thing that is busy is the thing that says so.
 */
const meta = {
  title: 'UI/CircuitRing',
  component: CircuitRing,
  args: { strokeWidth: 1.5 },
  render: (args) => ({
    components: { CircuitRing },
    setup: () => ({ args }),
    template: `
      <div style="position:relative; width:9rem; height:var(--field-h);
                  display:grid; place-items:center; border-radius:var(--radius-field);
                  background:var(--fill-2); font-size:0.75rem;">
        Running
        <CircuitRing v-bind="args" />
      </div>
    `,
  }),
} satisfies Meta<typeof CircuitRing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tracing: Story = {};
export const Thicker: Story = { args: { strokeWidth: 2.5 } };
export const Rounder: Story = { args: { radius: 20 } };
