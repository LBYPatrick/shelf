<script lang="ts">
import { defineComponent, h, type VNode } from 'vue';
import { parseMarkdown, type Block, type Inline } from '@shared/markdown';

/**
 * A model's reply, drawn as the markdown it is.
 *
 * It was plain text with `white-space: pre-wrap`, which put `**What I do:**` on
 * screen with its asterisks and a list of bullets as four lines beginning with a
 * hyphen. Models write markdown whether or not you ask them to.
 *
 * Built with `h` rather than a template because the shape is recursive and the
 * two halves nest into each other — a list item holds blocks, a block holds
 * inlines, an inline holds inlines. A template would be two components calling
 * each other through `<component :is>` to express what twenty lines of render
 * function say directly.
 *
 * **Nothing here produces HTML.** No `v-html`, no sanitiser. Every node becomes
 * a real element with a real text child, so a reply containing `<script>` — and
 * it can, because the model may be quoting a row out of the reader's own
 * database back at them — is a string that says `<script>`. Sanitising is the
 * usual answer to this and it is a dependency, a configuration, and a class of
 * bug that never quite closes; not generating markup has none of those.
 */

function inline(nodes: readonly Inline[]): (VNode | string)[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'code':
        return h('code', { class: 'md__code' }, node.text);
      case 'strong':
        return h('strong', inline(node.children));
      case 'em':
        return h('em', inline(node.children));
      case 'strike':
        return h('s', inline(node.children));
      case 'link':
        /*
         * A link with no safe scheme keeps its words and loses its href. The
         * reader still sees exactly what was written; there is simply nothing
         * to navigate to. `noreferrer` because the target is a stranger's URL.
         */
        return node.href
          ? h(
              'a',
              {
                class: 'md__link',
                href: node.href,
                target: '_blank',
                rel: 'noreferrer noopener',
              },
              node.text
            )
          : h('span', node.text);
    }
  });
}

function block(node: Block): VNode {
  switch (node.kind) {
    case 'paragraph':
      return h('p', { class: 'md__p' }, inline(node.children));

    case 'heading':
      // Never an `<h1>`: this is a paragraph of a conversation inside a tab,
      // and a document outline that starts over per reply is worse than none.
      return h(`h${node.level + 3}`, { class: 'md__h' }, inline(node.children));

    case 'list':
      return h(
        node.ordered ? 'ol' : 'ul',
        { class: 'md__list' },
        node.items.map((item) => h('li', { class: 'md__item' }, item.map(block)))
      );

    case 'quote':
      return h('blockquote', { class: 'md__quote' }, node.children.map(block));

    case 'rule':
      return h('hr', { class: 'md__rule' });

    case 'table':
      /*
       * Scrolls inside its own box, like every other wide thing in this app: a
       * six-column table handed to the transcript would widen the column and
       * put a horizontal scrollbar under the whole conversation.
       */
      return h('div', { class: 'md__scroll' }, [
        h('table', { class: 'md__table' }, [
          h('thead', [
            h(
              'tr',
              node.head.map((cell) => h('th', inline(cell)))
            ),
          ]),
          h(
            'tbody',
            node.rows.map((row) =>
              h(
                'tr',
                row.map((cell) => h('td', inline(cell)))
              )
            )
          ),
        ]),
      ]);
  }
}

export default defineComponent({
  name: 'MarkdownText',
  props: {
    text: { type: String, required: true },
    /** Draws the caret that says more is still arriving. */
    streaming: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h(
        'div',
        { class: ['md', { 'md--streaming': props.streaming }] },
        parseMarkdown(props.text).map(block) as unknown as VNode[]
      );
  },
});
</script>

<style scoped>
.md {
  font-size: 0.8125rem;
  /* Looser than the dense chrome around it. This is the one place in the app
     with paragraphs in it, and UI leading makes a paragraph a wall. */
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.md :deep(.md__p) {
  margin: 0 0 0.75em;
}

.md :deep(.md__p:last-child) {
  margin-bottom: 0;
}

/*
 * A heading inside a reply is a label, not a title. It gets weight and a little
 * space above it and nothing else — a larger size here would compete with the
 * tab it is inside.
 */
.md :deep(.md__h) {
  margin: 1.2em 0 0.5em;
  font-size: 0.8125rem;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.md :deep(.md__h:first-child) {
  margin-top: 0;
}

.md :deep(.md__list) {
  margin: 0 0 0.75em;
  padding-inline-start: 1.35em;
}

.md :deep(.md__list:last-child) {
  margin-bottom: 0;
}

.md :deep(ul.md__list) {
  list-style: disc;
}

.md :deep(ol.md__list) {
  list-style: decimal;
}

.md :deep(.md__item) {
  margin-block: 0.15em;
}

/* A nested list is tighter than the one it sits in, so the nesting reads as
   depth rather than as two lists that happen to be adjacent. */
.md :deep(.md__item .md__list) {
  margin-block: 0.15em;
}

.md :deep(.md__code) {
  padding: 0.1em 0.35em;
  border-radius: 0.3rem;
  background: var(--fill-2);
  font-family: var(--font-mono);
  /* Monospace at the same nominal size reads larger; this puts the x-heights
     back together so a backtick span does not jump out of its sentence. */
  font-size: 0.9em;
}

.md :deep(.md__link) {
  color: var(--color-primary-text, var(--color-primary));
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.md :deep(.md__quote) {
  margin: 0 0 0.75em;
  padding-inline-start: 0.9em;
  border-inline-start: 2px solid var(--separator);
  color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
}

.md :deep(.md__rule) {
  height: 1px;
  margin: 1.1em 0;
  border: 0;
  background: var(--separator);
}

.md :deep(.md__scroll) {
  margin: 0 0 0.75em;
  overflow-x: auto;
  border: 1px solid var(--separator);
  border-radius: 0.6rem;
}

.md :deep(.md__table) {
  display: table;
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.md :deep(.md__table th),
.md :deep(.md__table td) {
  padding: 0.35em 0.75em;
  text-align: start;
  border-bottom: 1px solid var(--separator);
  white-space: nowrap;
}

.md :deep(.md__table th) {
  font-weight: 600;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.md :deep(.md__table tr:last-child td) {
  border-bottom: 0;
}

/*
 * A caret after the last character of the last block.
 *
 * Not per-token animation: a transition on text that changes many times a
 * second repaints the whole paragraph every frame and reads as flicker. One
 * blinking block says the same thing for the cost of one composited element.
 */
.md--streaming > :deep(*:last-child)::after {
  content: '';
  display: inline-block;
  width: 0.45em;
  height: 1em;
  margin-inline-start: 0.15em;
  border-radius: 1px;
  vertical-align: -0.15em;
  background: currentColor;
  opacity: 0.5;
  animation: md-caret 1.1s steps(2, start) infinite;
}

@keyframes md-caret {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .md--streaming > :deep(*:last-child)::after {
    animation: none;
  }
}
</style>
