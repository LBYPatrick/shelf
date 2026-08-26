import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ResizeHandle from './ResizeHandle.vue';

/**
 * The seam between two panes.
 *
 * It tracks the pointer one to one, keeps the grab offset, resists at its
 * limits and hands its release velocity to the spring that follows — all of
 * which is `useDrag`'s, not this component's.
 */
const meta = {
  title: 'UI/ResizeHandle',
  component: ResizeHandle,
  args: { size: 240, min: 180, max: 520, ariaLabel: 'Sidebar width' },
  render: (args) => ({
    components: { ResizeHandle },
    setup: () => ({ args }),
    template: `
      <div style="display:flex; height:14rem; border:1px solid var(--separator); border-radius:0.5rem; overflow:hidden;">
        <div :style="{ width: args.size + 'px', background: 'var(--fill-1)' }" />
        <ResizeHandle v-bind="args" />
        <div style="flex:1; background:var(--fill-2);" />
      </div>
    `,
  }),
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {};

/** Between an editor and its results, where it runs the other way. */
export const Horizontal: Story = {
  args: { orientation: 'horizontal', size: 120, min: 80, max: 300, ariaLabel: 'Editor height' },
  render: (args) => ({
    components: { ResizeHandle },
    setup: () => ({ args }),
    template: `
      <div style="display:flex; flex-direction:column; width:22rem; height:14rem;
                  border:1px solid var(--separator); border-radius:0.5rem; overflow:hidden;">
        <div :style="{ height: args.size + 'px', background: 'var(--fill-1)' }" />
        <ResizeHandle v-bind="args" />
        <div style="flex:1; background:var(--fill-2);" />
      </div>
    `,
  }),
};
