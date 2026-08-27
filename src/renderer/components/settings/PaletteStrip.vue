<script setup lang="ts">
/**
 * A scheme's colours, as its colours.
 *
 * A dropdown of nine names asks the reader to remember what nine palettes look
 * like, or to choose one, look at the editor, and come back — nine times. The
 * eight tokens *are* the answer to "what is this", so they sit beside the name
 * that selects them.
 *
 * It shows the halves the control beside it *sets*, and no more. Synced, that
 * is both — light above dark, because a scheme is a pair and one picker is
 * choosing the pair. Unsynced, each picker gets a specimen of its own half, so
 * a swatch is never sitting beside a control that does not decide it.
 *
 * Not interactive, and not labelled colour by colour. It is a fingerprint —
 * enough to recognise Gruvbox from across the sheet — and a reader who wants to
 * know which swatch is which has the editor.
 */
import { computed } from 'vue';
import { SYNTAX_TOKENS, syntaxProperties } from '@shared/syntaxThemes';

const props = defineProps<{
  light: string;
  dark: string;
  /** Which halves this specimen is for, in the order they are drawn. */
  appearances: readonly ('light' | 'dark')[];
  /** Announced as one thing, because it is one specimen of one scheme. */
  label: string;
}>();

const rows = computed(() =>
  props.appearances.map((appearance) => {
    const palette = syntaxProperties(
      appearance === 'light' ? props.light : props.dark,
      appearance
    );
    return {
      appearance,
      swatches: SYNTAX_TOKENS.map((token) => ({ token, colour: palette[token] })),
    };
  })
);
</script>

<template>
  <span class="palettestrip" role="img" :aria-label="label">
    <span v-for="row in rows" :key="row.appearance" class="palettestrip__row">
      <span
        v-for="swatch in row.swatches"
        :key="swatch.token"
        class="palettestrip__chip"
        :style="{ background: swatch.colour }"
      />
    </span>
  </span>
</template>

<style scoped>
.palettestrip {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  gap: 2px;
  padding: 3px;
  border-radius: 6px;
  /* The scheme's own colours are the subject; the frame under them is a well,
     so a pale palette does not float on the card. */
  background: var(--surface-well);
}

.palettestrip__row {
  display: flex;
  gap: 2px;
}

.palettestrip__chip {
  width: 0.75rem;
  height: 0.6875rem;
  border-radius: 2px;
}
</style>
