import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { FIELDS, ROWS } from '../../../../.storybook/fixtures/database';
import ChatItem from './ChatItem.vue';

/**
 * One thing the assistant produced.
 *
 * A turn is a list of these rather than a string, which is what makes the chat
 * a place where a query can be run and a table looked at. The two quiet kinds
 * — reasoning and steps — are drawn smaller and dimmer than the answer on
 * purpose: they are not the point.
 */
const meta = {
  title: 'Assistant/ChatItem',
  component: ChatItem,
  args: { streaming: false, item: { kind: 'text', id: 't', text: 'Fifty rows.' } },
  render: (args) => ({
    components: { ChatItem },
    setup: () => ({ args }),
    template: `<div style="width:38rem;"><ChatItem v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ChatItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Answer: Story = {};

export const AnswerStreaming: Story = {
  args: { streaming: true, item: { kind: 'text', id: 't', text: 'Counting the rows in' } },
};

export const Sql: Story = {
  args: {
    item: {
      kind: 'sql',
      id: 's',
      sql: 'SELECT count(*) FROM music.album;',
      title: 'Albums in the catalogue',
    },
  },
};

/**
 * A statement the model wrote out with no name on its fence. The container is
 * the same one either way; only the caption falls back.
 */
export const SqlUnnamed: Story = {
  args: { item: { kind: 'sql', id: 's', sql: 'SELECT count(*) FROM music.album;' } },
};

const ROWS_BACK = {
  fields: FIELDS,
  rows: ROWS,
  truncated: false,
  durationMs: 8,
};

/**
 * A query the model ran to check itself, folded away.
 *
 * This is the shape most of a working turn is made of, and the reason it folds:
 * a turn that answers a question properly may run four of these, and four
 * tables of intermediate counting bury the one table that was asked for. Open
 * it and the statement and its rows are there, in the same container the answer
 * uses.
 */
export const StepCheck: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'r',
      tool: 'run_sql',
      state: 'done',
      intent: 'check',
      label: 'Which tables carry a release date',
      detail: '3 rows · 8 ms',
      sql: "SELECT table_name FROM information_schema.columns WHERE column_name = 'released';",
      rows: ROWS_BACK,
    },
  },
};

/** The query that *is* the answer, which starts open. */
export const StepAnswer: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'r',
      tool: 'run_sql',
      state: 'done',
      intent: 'answer',
      label: 'Albums per artist',
      detail: '5 rows · 8 ms',
      sql: 'SELECT * FROM music.album LIMIT 5;',
      rows: ROWS_BACK,
    },
  },
};

/** A step, while it is happening. */
export const StepRunning: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'p',
      tool: 'run_sql',
      state: 'running',
      label: 'Counting rows in music.album',
      sql: 'SELECT count(*) FROM music.album;',
    },
  },
};

export const StepDone: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'p',
      tool: 'run_sql',
      state: 'done',
      label: 'Counted rows in music.album',
      detail: '1 row · 4 ms',
      sql: 'SELECT count(*) FROM music.album;',
    },
  },
};

/**
 * The rule, on screen: a statement that writes is not run, and the step says so
 * rather than reporting a failure.
 */
export const StepDenied: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'p',
      tool: 'run_sql',
      state: 'denied',
      label: 'Not run — this would change the database',
      sql: 'DELETE FROM ops.audit_log;',
    },
  },
};

export const StepFailed: Story = {
  args: {
    item: {
      kind: 'step',
      id: 'p',
      tool: 'run_sql',
      state: 'failed',
      label: 'The query failed',
      sql: 'SELECT * FROM music.artistt;',
      error: 'relation "music.artistt" does not exist',
    },
  },
};

export const Thinking: Story = {
  args: {
    streaming: true,
    item: {
      kind: 'thinking',
      id: 'k',
      text: 'The question is about albums, so I want music.album and its count.',
    },
  },
};

export const Failure: Story = {
  args: {
    item: { kind: 'error', id: 'e', message: 'Stopped after 6 rounds of checking.' },
  },
};
