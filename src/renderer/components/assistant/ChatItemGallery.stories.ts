import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { AiItem } from '@shared/ai';
import { FIELDS, ROWS } from '../../../../.storybook/fixtures/database';
import ChatItem from './ChatItem.vue';

/**
 * Every kind of item, in one column.
 *
 * The point of seeing them together is the *loudness ladder*: the answer is the
 * loudest thing, a SQL block and a result table are objects with their own
 * edges, and the steps and reasoning above them are deliberately quieter than
 * both. One at a time, that ordering is impossible to check.
 *
 * It is also where the two intents can be compared: the query the model ran to
 * check itself is one folded row, and the one it ran to answer with is open
 * beneath it — the same container, differing only in where it starts.
 */
const items: AiItem[] = [
  { kind: 'thinking', id: '1', text: 'The question is about albums, so I want music.album.' },
  {
    kind: 'step',
    id: '2',
    tool: 'inspect_schema',
    state: 'done',
    label: 'Read the schema',
    detail: 'music.album',
  },
  {
    kind: 'step',
    id: '3',
    tool: 'run_sql',
    state: 'done',
    intent: 'check',
    label: 'Checking the count',
    detail: '5 rows · 8 ms',
    sql: 'SELECT count(*) FROM "music"."album";',
    rows: {
      fields: [{ name: 'count' }],
      rows: [{ count: 50 }],
      truncated: false,
      durationMs: 3,
    },
  },
  {
    kind: 'step',
    id: '4',
    tool: 'run_sql',
    state: 'done',
    intent: 'answer',
    label: 'The first five albums',
    detail: '5 rows · 8 ms',
    sql: 'SELECT * FROM "music"."album" LIMIT 5;',
    rows: { fields: FIELDS, rows: ROWS, truncated: false, durationMs: 8 },
  },
  { kind: 'text', id: '5', text: 'Five rows, and **two** of them have no `notes`.' },
  {
    kind: 'sql',
    id: '6',
    sql: 'SELECT count(*) FROM "music"."album" WHERE notes IS NULL;',
    title: 'Albums with no notes',
  },
  {
    kind: 'step',
    id: '7',
    tool: 'run_sql',
    state: 'denied',
    label: 'Not run — this would change the database',
    sql: 'DELETE FROM music.album WHERE notes IS NULL;',
  },
  { kind: 'error', id: '8', message: 'Stopped after 6 rounds of checking.' },
];

const meta = {
  title: 'Assistant/ChatItem gallery',
  component: ChatItem,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { ChatItem },
    setup: () => ({ items }),
    template: `
      <div style="width:40rem; padding:1.5rem;">
        <ChatItem v-for="item in items" :key="item.id" :item="item" :streaming="false" />
      </div>
    `,
  }),
} satisfies Meta<typeof ChatItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryKind: Story = {};
