import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SqlEditor from './SqlEditor.vue';

/**
 * The editor.
 *
 * Monaco promotes itself to its own layer, which is why the content pane's
 * rounded corner is a `clip-path` rather than an `overflow` — Chromium does not
 * apply an ancestor's rounded overflow clip to a composited descendant.
 */
const frame = `<div style="width:52rem; height:18rem;"><SqlEditor v-bind="args" /></div>`;

const meta = {
  title: 'Editor/SqlEditor',
  component: SqlEditor,
  args: {
    schema: {
      'music.album': ['id', 'artist_id', 'title', 'released'],
      'music.artist': ['id', 'name', 'country'],
    },
    readOnly: false,
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => ({
    components: { SqlEditor },
    setup: () => ({ args }),
    template: frame,
  }),
} satisfies Meta<typeof SqlEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

/** Read-only, for a statement being shown rather than written. */
export const ReadOnly: Story = { args: { readOnly: true } };

/** No schema: completion has nothing to offer and says nothing. */
export const WithoutSchema: Story = { args: { schema: undefined } };
