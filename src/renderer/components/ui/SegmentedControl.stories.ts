import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SegmentedControl from './SegmentedControl.vue';

/**
 * One selection that travels between the options rather than a surface each
 * option paints for itself — the same rule the tab strip and the rail follow.
 */
const meta = {
  title: 'UI/SegmentedControl',
  component: SegmentedControl,
  args: {
    modelValue: 'visual',
    ariaLabel: 'How settings are shown',
    options: [
      { value: 'visual', label: 'Form' },
      { value: 'json', label: 'JSON' },
    ],
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Two: Story = {};

export const Three: Story = {
  args: {
    modelValue: 'default',
    ariaLabel: 'Density',
    options: [
      { value: 'compact', label: 'Compact' },
      { value: 'default', label: 'Default' },
      { value: 'comfortable', label: 'Comfortable' },
    ],
  },
};

/** The last one selected, which is where an indicator measured wrong shows up. */
export const LastSelected: Story = {
  args: {
    modelValue: 'sql',
    ariaLabel: 'Format',
    options: [
      { value: 'csv', label: 'CSV' },
      { value: 'json', label: 'JSON' },
      { value: 'jsonl', label: 'JSONL' },
      { value: 'sql', label: 'SQL' },
    ],
  },
};
