import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SelectMenu from './SelectMenu.vue';

/**
 * A select whose list is drawn in the viewport, not inside the control.
 *
 * It used to be an absolutely positioned child, which meant every ancestor
 * that clips could cut it in half — and in a settings row two of them do.
 */
const meta = {
  title: 'UI/SelectMenu',
  component: SelectMenu,
  args: {
    modelValue: '500',
    ariaLabel: 'Row limit',
    options: [
      { value: '10', label: '10 rows' },
      { value: '100', label: '100 rows' },
      { value: '500', label: '500 rows' },
      { value: '1000', label: '1,000 rows' },
      { value: 'none', label: 'Unlimited' },
    ],
  },
} satisfies Meta<typeof SelectMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** A label long enough to prove the control is sized to its widest option. */
export const LongLabels: Story = {
  args: {
    modelValue: 'b',
    options: [
      { value: 'a', label: 'Comma separated values' },
      { value: 'b', label: 'JavaScript Object Notation, one object per line' },
      { value: 'c', label: 'SQL insert statements' },
    ],
  },
};

/** Inside a clipping box, which is the case that broke it. */
export const InsideAClippingBox: Story = {
  render: (args) => ({
    components: { SelectMenu },
    setup: () => ({ args }),
    template: `
      <div style="width:14rem; height:5rem; overflow:hidden; border:1px dashed var(--separator);
                  border-radius:0.75rem; padding:0.75rem;">
        <SelectMenu v-bind="args" />
      </div>
    `,
  }),
};
