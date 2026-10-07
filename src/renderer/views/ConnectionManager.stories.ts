import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useConnections } from '@renderer/stores/connections';
import { resetShelf } from '../../../.storybook/mocks/shelf';
import { SAVED_CONNECTIONS } from '../../../.storybook/fixtures/database';
import ConnectionManager from './ConnectionManager.vue';

const meta = {
  title: 'Pages/ConnectionManager',
  component: ConnectionManager,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { ConnectionManager },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
} satisfies Meta<typeof ConnectionManager>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithConnections: Story = {};

export const FirstLaunch: Story = {
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      resetShelf({ connections: [], history: [] });
    },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
};

/** Thousands on file, forty on screen, including long international names. */
export const LargeLibrary: Story = {
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      resetShelf({
        connections: Array.from({ length: 1000 }, (_, index) => ({
          ...SAVED_CONNECTIONS[0]!,
          id: `library-${index}`,
          name: `${String(index).padStart(4, '0')} · ${index % 3 ? 'Production analytics' : '東京・非常に長い接続名・売上分析'}`,
          lastUsedAt: index % 4 ? null : Date.now() - index * 60_000,
        })),
        history: Array.from({ length: 2000 }, (_, index) => ({
          id: `history-${index}`,
          connectionId: `library-${index % 1000}`,
          text: `select ${index} as report_number`,
          executedAt: Date.now() - index * 60_000,
          rowCount: 1,
          durationMs: 12,
          succeeded: index % 7 !== 0,
        })),
      });
    },
    template: `<div style="width:64rem; height:40rem; display:flex;"><ConnectionManager /></div>`,
  }),
};

export const Failed: Story = {
  render: () => ({
    components: { ConnectionManager },
    setup: () => {
      const connections = useConnections();
      connections.status = {
        state: 'failed',
        connectionId: 'conn-local',
        message: 'password authentication failed for user "shelf"',
      };
    },
    template: `<div style="width:56rem; height:36rem; display:flex;"><ConnectionManager /></div>`,
  }),
};
