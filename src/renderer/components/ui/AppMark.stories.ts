import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppMark from './AppMark.vue';

/**
 * The app's own icon, from the one drawing everything else is derived from.
 *
 * It is a real image rather than a second copy of the artwork: the packagers
 * cut every size from `resources/icon.svg`, and this is the same file copied
 * into the renderer's build root because a bundle cannot import from outside it.
 */
const meta = {
  title: 'UI/AppMark',
  component: AppMark,
  args: { size: 64 },
} satisfies Meta<typeof AppMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every size it is drawn at, which is where a raster would fall apart. */
export const EverySize: Story = {
  render: () => ({
    components: { AppMark },
    template: `
      <div style="display:flex; align-items:flex-end; gap:1rem;">
        <AppMark :size="16" />
        <AppMark :size="24" />
        <AppMark :size="40" />
        <AppMark :size="64" />
        <AppMark :size="128" />
      </div>
    `,
  }),
};
