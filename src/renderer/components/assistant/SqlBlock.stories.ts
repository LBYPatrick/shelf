import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SqlBlock from './SqlBlock.vue';

/**
 * A statement the assistant wrote, drawn as a statement.
 *
 * The actions are always visible rather than revealed on hover: a reader who
 * does not know the block is actionable will not hover it to find out.
 */
const meta = {
  title: 'Assistant/SqlBlock',
  component: SqlBlock,
  args: { sql: 'SELECT count(*) AS albums FROM "music"."album";' },
  render: (args) => ({
    components: { SqlBlock },
    setup: () => ({ args }),
    template: `<div style="width:38rem;"><SqlBlock v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof SqlBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Read: Story = {};

/**
 * A write. The assistant never runs one — it comes back here instead — and the
 * block says why it is a block rather than a result.
 */
export const WouldChangeData: Story = {
  args: { sql: "DELETE FROM ops.audit_log WHERE created_at < now() - interval '90 days';" },
};

export const WouldChangeSchema: Story = {
  args: { sql: 'ALTER TABLE music.album ADD COLUMN reissued boolean DEFAULT false;' },
};

/**
 * Named. The title is what the model called the query, and it is also the name
 * the tab takes when the block is opened in an editor.
 */
export const Titled: Story = {
  args: {
    title: 'Albums by artist, alphabetically',
    sql: 'SELECT a.name, al.title\nFROM music.artist a\nJOIN music.album al ON al.artist_id = a.id\nORDER BY a.name;',
  },
};

/** Wide enough to scroll inside its own box rather than widening the column. */
export const VeryWide: Story = {
  args: {
    sql: 'SELECT a.id, a.name, a.country, a.formed, al.title, al.released, t.title AS track, t.play_count FROM music.artist a JOIN music.album al ON al.artist_id = a.id JOIN music.track t ON t.album_id = al.id WHERE a.country = $1 ORDER BY t.play_count DESC LIMIT 100;',
  },
};
