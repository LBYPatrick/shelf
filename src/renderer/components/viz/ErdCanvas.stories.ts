import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ErdCanvas from './ErdCanvas.vue';

/**
 * The diagram: a force simulation over the tables and their foreign keys.
 *
 * Scoped to a database or a schema rather than a whole connection, because two
 * hundred tables laid out by a force simulation fill a canvas no screen can
 * show at a legible size.
 */
const meta = {
  title: 'Visualisation/ErdCanvas',
  component: ErdCanvas,
  args: {
    tables: [
      {
        key: 'music.artist',
        name: 'artist',
        schema: 'music',
        columns: [
          { name: 'id', dataType: 'integer', primaryKey: true },
          { name: 'name', dataType: 'text', primaryKey: false },
          { name: 'country', dataType: 'char(2)', primaryKey: false },
        ],
      },
      {
        key: 'music.album',
        name: 'album',
        schema: 'music',
        columns: [
          { name: 'id', dataType: 'integer', primaryKey: true },
          { name: 'artist_id', dataType: 'integer', primaryKey: false },
          { name: 'title', dataType: 'text', primaryKey: false },
        ],
      },
      {
        key: 'music.track',
        name: 'track',
        schema: 'music',
        columns: [
          { name: 'id', dataType: 'integer', primaryKey: true },
          { name: 'album_id', dataType: 'integer', primaryKey: false },
          { name: 'title', dataType: 'text', primaryKey: false },
        ],
      },
    ],
    edges: [
      { source: 'music.album', target: 'music.artist', label: 'artist_id' },
      { source: 'music.track', target: 'music.album', label: 'album_id' },
    ],
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { ErdCanvas },
    setup: () => ({ args }),
    template: `<div style="width:100%; height:30rem;"><ErdCanvas v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof ErdCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Chain: Story = {};

/** No relations at all, which is a legible diagram and not an empty one. */
export const Unrelated: Story = {
  args: {
    tables: [
      {
        key: 'ops.daily_metrics',
        name: 'daily_metrics',
        schema: 'ops',
        columns: [
          { name: 'day', dataType: 'date', primaryKey: true },
          { name: 'plays', dataType: 'bigint', primaryKey: false },
        ],
      },
      {
        key: 'ops.audit_log',
        name: 'audit_log',
        schema: 'ops',
        columns: [
          { name: 'id', dataType: 'integer', primaryKey: true },
          { name: 'actor', dataType: 'text', primaryKey: false },
        ],
      },
    ],
    edges: [],
  },
};

export const Empty: Story = { args: { tables: [], edges: [] } };
