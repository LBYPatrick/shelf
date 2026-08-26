import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useActivity } from '@renderer/stores/activity';
import { connected } from '../../../../.storybook/seed';
import StatusBar from './StatusBar.vue';

/**
 * The line along the foot of the window.
 *
 * It clears the window's own rounded corners — the row count on the right and
 * the connection dot on the left were both cut off by the radius once — and it
 * truncates rather than running off the edge.
 */
const meta = {
  title: 'Chrome/StatusBar',
  component: StatusBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const bar = (build?: () => void) => ({
  components: { StatusBar },
  setup: () => {
    connected();
    build?.();
    return {};
  },
  template: `<div style="width:52rem;"><StatusBar /></div>`,
});

export const Connected: Story = { render: () => bar() };

/** While something is running, which is what the left half is for. */
export const Busy: Story = {
  render: () =>
    bar(() => {
      useActivity().begin('story', 'Running a query');
    }),
};
