import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useConnections } from '@renderer/stores/connections';
import { connected } from '../../../../.storybook/seed';
import ConnectionSwitcher from './ConnectionSwitcher.vue';

/**
 * Which database you are in, at the top of the sidebar.
 *
 * It sits there rather than in a title bar because the window has no title bar:
 * the connection a workspace belongs to is part of the structure it is showing.
 */
const frame = `<div style="width:17rem;"><ConnectionSwitcher /></div>`;

const meta = {
  title: 'Sidebar/ConnectionSwitcher',
  component: ConnectionSwitcher,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { ConnectionSwitcher },
    setup: () => {
      connected();
      return {};
    },
    template: frame,
  }),
} satisfies Meta<typeof ConnectionSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

/** Read-only, which the switcher has to say without being asked. */
export const ReadOnly: Story = {
  render: () => ({
    components: { ConnectionSwitcher },
    setup: () => {
      connected();
      const connections = useConnections();
      connections.active = { ...connections.active!, readOnly: true, name: 'Staging' };
      return {};
    },
    template: frame,
  }),
};

/** A name long enough to truncate. */
export const LongName: Story = {
  render: () => ({
    components: { ConnectionSwitcher },
    setup: () => {
      connected();
      const connections = useConnections();
      connections.active = {
        ...connections.active!,
        name: 'Analytics warehouse — production replica',
      };
      return {};
    },
    template: frame,
  }),
};
