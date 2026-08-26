<script lang="ts">
import { defineComponent, h, type PropType } from 'vue';
import { tokenizeSql, type TokenKind } from '@shared/sqlHighlight';

/**
 * A statement, coloured.
 *
 * Spans built with `h`, never `v-html`: this text is written by a model and may
 * be repeating a row out of the reader's own database, so nothing here may
 * become markup. Every token is a real text node inside a real element.
 *
 * The colours are the editor's own `--syntax-*` tokens rather than a palette of
 * this component's, so the same statement reads the same in a chat and in a
 * query tab — and both follow the accent and the theme without being told.
 */
const CLASS: Record<TokenKind, string> = {
  keyword: 'tok tok--keyword',
  type: 'tok tok--type',
  function: 'tok tok--function',
  string: 'tok tok--string',
  number: 'tok tok--number',
  comment: 'tok tok--comment',
  operator: 'tok tok--operator',
  quoted: 'tok tok--quoted',
  punctuation: 'tok tok--punctuation',
  identifier: 'tok tok--identifier',
  plain: 'tok',
};

export default defineComponent({
  name: 'SqlCode',
  props: {
    sql: { type: String as PropType<string>, required: true },
  },
  setup(props) {
    return () =>
      h(
        'pre',
        { class: 'sqlcode' },
        h(
          'code',
          tokenizeSql(props.sql).map((token) =>
            // Whitespace and the like carry no class of their own, so a run of
            // it is one bare text node rather than a wrapper around nothing.
            token.kind === 'plain'
              ? token.text
              : h('span', { class: CLASS[token.kind] }, token.text)
          )
        )
      );
  },
});
</script>

<style scoped>
.sqlcode {
  margin: 0;
  padding: var(--gap-loose);
  /*
   * Scrolls inside its own box. A long line handed to the transcript would
   * widen the whole column and put a horizontal scrollbar under the
   * conversation — the rule every wide thing in this app follows.
   */
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.55;
  tab-size: 2;
  white-space: pre;
}

.sqlcode :deep(.tok--keyword) {
  color: var(--syntax-keyword);
  font-weight: 600;
}

.sqlcode :deep(.tok--type) {
  color: var(--syntax-type);
}

.sqlcode :deep(.tok--function) {
  color: var(--syntax-function);
}

.sqlcode :deep(.tok--string) {
  color: var(--syntax-string);
}

.sqlcode :deep(.tok--number) {
  color: var(--syntax-number);
}

.sqlcode :deep(.tok--comment) {
  color: var(--syntax-comment);
  font-style: italic;
}

.sqlcode :deep(.tok--operator) {
  color: var(--syntax-operator);
}

/* A quoted name is a name, and is coloured like the property it identifies. */
.sqlcode :deep(.tok--quoted) {
  color: var(--syntax-property);
}

/*
 * Punctuation and bare identifiers take the body colour. Colouring every
 * bracket is how a statement ends up with nothing standing out because
 * everything does.
 */
.sqlcode :deep(.tok--punctuation) {
  opacity: 0.65;
}
</style>
