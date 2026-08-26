import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useConnections } from '@renderer/stores/connections';
import ConnectionManager from './ConnectionManager.vue';

/**
 * The start screen.
 *
 * A panel rather than a workspace — the window is made compact for it, because
 * given a full screen it would be mostly emptiness. It parses a pasted
 * connection URL into a filled-in form.
 */
const meta = {
  title: 'Pages/ConnectionManager',
  component: ConnectionManager,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      void useConnections().refresh();
      return {};
    },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
} satisfies Meta<typeof ConnectionManager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** With saved connections, pinned and recent. */
export const WithConnections: Story = {};

/** The first launch: nothing saved, and the sample database on offer. */
export const FirstLaunch: Story = {
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      useConnections().saved = [];
      return {};
    },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
};

/** A connection that failed, which the screen has to keep on screen. */
export const Failed: Story = {
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      const connections = useConnections();
      void connections.refresh();
      connections.status = {
        state: 'failed',
        connectionId: 'conn-local',
        message: 'password authentication failed for user "shelf"',
      };
      return {};
    },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
};
