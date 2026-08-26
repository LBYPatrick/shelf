import type { Meta, StoryObj } from '@storybook/vue3-vite';
import MarkdownText from './MarkdownText.vue';

/**
 * A model's reply, drawn as the markdown it is.
 *
 * Nothing here produces HTML — no `v-html`, no sanitiser. Every node becomes a
 * real element with a real text child, so a reply containing a script tag is a
 * string that says "script tag". The last story is that promise, on screen.
 */
const meta = {
  title: 'Assistant/MarkdownText',
  component: MarkdownText,
  args: { streaming: false, text: 'A single paragraph of prose.' },
  render: (args) => ({
    components: { MarkdownText },
    setup: () => ({ args }),
    template: `<div style="width:36rem;"><MarkdownText v-bind="args" /></div>`,
  }),
} satisfies Meta<typeof MarkdownText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paragraph: Story = {};

/** The shape that shipped broken: bold labels in a bulleted list. */
export const BulletedList: Story = {
  args: {
    text: [
      "I'm a database assistant. What that means here:",
      '',
      '- **What I do:** write SQL for your connection.',
      '- **Dialect:** I target the `postgres` engine specifically.',
      "- **What I can't do:** change anything.",
      '',
      'Ask me for a query and I will write it.',
    ].join('\n'),
  },
};

export const Numbered: Story = {
  args: { text: '1. Read the schema\n2. Write the query\n3. Check it against the data' },
};

export const Headings: Story = {
  args: {
    text: '# The shape\n\nThree tables.\n\n## Relations\n\nAlbums belong to artists.',
  },
};

export const Table: Story = {
  args: {
    text: [
      '| table | rows | size |',
      '| --- | --- | --- |',
      '| music.artist | 8 | 24 kB |',
      '| music.album | 50 | 180 kB |',
      '| music.track | 512 | 2.1 MB |',
    ].join('\n'),
  },
};

export const QuoteAndRule: Story = {
  args: {
    text: '> Counting is a full scan on this engine.\n\n---\n\nSo it is worth an index.',
  },
};

/** Streaming draws a caret after the last block and nowhere else. */
export const Streaming: Story = {
  args: { text: 'Reading the schema and working out which tables', streaming: true },
};

export const Links: Story = {
  args: { text: 'See [the docs](https://example.com/docs) or <https://example.com>.' },
};

/**
 * The safety promise, visible.
 *
 * Every one of these stays text. A link with a scheme we will not open keeps
 * its words and loses its href.
 */
export const NothingBecomesMarkup: Story = {
  args: {
    text: [
      'A tag: <script>alert(1)</script>',
      '',
      'A link: [click me](javascript:alert(1))',
      '',
      'A data URL: [x](data:text/html,<b>hi</b>)',
      '',
      'An identifier: daily_metrics_table stays unemphasised.',
    ].join('\n'),
  },
};
