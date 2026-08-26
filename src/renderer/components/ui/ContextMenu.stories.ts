import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ContextMenu from './ContextMenu.vue';

/**
 * A menu opened at a point.
 *
 * Its class is `popmenu`, not `menu`: daisyUI owns that name and dresses its
 * list items, so a component of ours taking it inherits a second set of
 * paddings and hovers on top of the ones it drew.
 *
 * Nothing is highlighted until the pointer or the keyboard picks something — a
 * menu that opens with its first row already lit looks like it has decided for
 * you.
 */
const meta = {
  title: 'UI/ContextMenu',
  component: ContextMenu,
  args: {
    modelValue: true,
    at: { x: 80, y: 80 },
    items: [
      { id: 'copy', label: 'Copy table name', icon: 'copy' },
      { id: 'docs', label: 'Quick docs', icon: 'info', startsGroup: true },
      { id: 'properties', label: 'Properties', icon: 'structure' },
      { id: 'export', label: 'Export data to file…', icon: 'download', startsGroup: true },
      { id: 'chat', label: 'Chat', icon: 'assistant', startsGroup: true },
    ],
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ContextMenu },
    setup: () => ({ args }),
    template: `<div style="height:26rem;"><ContextMenu v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EntityMenu: Story = {};

/** A disabled row still says what it would have done. */
export const WithDisabled: Story = {
  args: {
    items: [
      { id: 'open', label: 'Open the rows', icon: 'table', disabled: true },
      { id: 'export', label: 'Export data to file…', icon: 'download', disabled: true },
      { id: 'explain', label: 'Explain this query', icon: 'chart' },
      { id: 'discard', label: 'Discard', icon: 'trash', startsGroup: true },
    ],
  },
};

/** Near an edge, where it flips rather than sliding over what you clicked. */
export const NearTheEdge: Story = { args: { at: { x: 900, y: 360 } } };
