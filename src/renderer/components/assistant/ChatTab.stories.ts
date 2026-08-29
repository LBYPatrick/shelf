import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useAssistant } from '@renderer/stores/assistant';
import { connected, withProvider } from '../../../../.storybook/seed';
import ChatTab from './ChatTab.vue';

/**
 * The conversation.
 *
 * One measure runs through the whole tab — the transcript, the composer and the
 * note under it are the same width and the same centring. The column is pushed
 * to the bottom so an exchange always sits against the box that continues it,
 * except when there is nothing yet, where it centres instead.
 */
const frame = `<div style="width:64rem; height:38rem; display:flex;"><ChatTab v-bind="args" /></div>`;

const meta = {
  title: 'Assistant/ChatTab',
  component: ChatTab,
  args: { tabId: 'tab-1', active: true },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before a provider exists: the invitation, and the way to set one up. */
export const NotConfigured: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      return { args };
    },
    template: frame,
  }),
};

/** Configured and empty — three things to press so the first message is easy. */
export const Empty: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      void withProvider();
      return { args };
    },
    template: frame,
  }),
};

/** A finished exchange, with everything a turn can contain in it. */
export const WithAnswer: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      void withProvider();
      const assistant = useAssistant();
      const chat = assistant.conversation('tab-1', { kind: 'connection' });
      chat.turns = [
        {
          id: 't1',
          question: 'How many rows are in music.album?',
          state: 'done',
          items: [
            {
              kind: 'step',
              id: 's1',
              tool: 'run_sql',
              state: 'done',
              intent: 'answer',
              label: 'Rows in music.album',
              detail: '1 row · 4 ms',
              sql: 'SELECT count(*) FROM "music"."album";',
              rows: {
                fields: [{ name: 'count' }],
                rows: [{ count: 50 }],
                truncated: false,
                durationMs: 4,
              },
            },
            { kind: 'text', id: 'x1', text: 'Fifty rows in `music.album`.' },
          ],
        },
      ];
      return { args };
    },
    template: frame,
  }),
};

/** Mid-answer: the Stop button is up and the caret is on the last block. */
export const Streaming: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      void withProvider();
      const chat = useAssistant().conversation('tab-1', { kind: 'connection' });
      chat.turns = [
        {
          id: 't1',
          question: 'Describe yourself as the agent',
          state: 'running',
          items: [{ kind: 'text', id: 'x', text: "I'm a database assistant running inside" }],
        },
      ];
      return { args };
    },
    template: frame,
  }),
};

/** A write, handed back rather than run — the rule, on screen. */
export const RefusedAWrite: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      void withProvider();
      const chat = useAssistant().conversation('tab-1', { kind: 'connection' });
      chat.turns = [
        {
          id: 't1',
          question: 'Delete every row from ops.audit_log',
          state: 'done',
          items: [
            {
              kind: 'step',
              id: 's1',
              tool: 'run_sql',
              state: 'denied',
              label: 'Not run — this would change the database',
              sql: 'DELETE FROM ops.audit_log;',
            },
            {
              kind: 'text',
              id: 'x1',
              text: 'That would remove every row. Run it yourself if you mean to:',
            },
            { kind: 'sql', id: 'q1', sql: 'DELETE FROM ops.audit_log;' },
          ],
        },
      ];
      return { args };
    },
    template: frame,
  }),
};

/** The turn failed, which the transcript says rather than a toast. */
export const Failed: Story = {
  render: (args) => ({
    components: { ChatTab },
    setup: () => {
      connected();
      void withProvider();
      const chat = useAssistant().conversation('tab-1', { kind: 'connection' });
      chat.turns = [
        {
          id: 't1',
          question: 'anything',
          state: 'failed',
          error: 'Claude Code is not installed, or is not on this app’s path.',
          items: [],
        },
      ];
      return { args };
    },
    template: frame,
  }),
};
