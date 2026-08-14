<script setup lang="ts">
/**
 * The full value of one cell.
 *
 * A grid row is a few hundred pixels wide; a JSON document or a long text field
 * is not. This shows the whole thing, formatted, with the type stated — because
 * "is this a string containing JSON or an actual JSON column" is a question the
 * truncated cell cannot answer.
 */
import { computed } from 'vue';
import type { CellValue } from '@drivers/types';
import { displayValue, valueKind } from '@shared/values';
import { useSettings } from '../../stores/settings';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';

const props = defineProps<{ column: string; value: CellValue }>();
const open = defineModel<boolean>({ required: true });

const settings = useSettings();

// The same rendering the cell used, or the inspector would disagree with the
// grid about what the value is — which is the one thing it exists to settle.
const raw = computed(() =>
  displayValue(props.value, { encoding: settings.values.binaryEncoding })
);
const kind = computed(() => valueKind(props.value));

/** JSON is pretty-printed; anything else is shown exactly as stored. */
const pretty = computed(() => {
  const text = raw.value;
  if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
});

const isJson = computed(() => pretty.value !== raw.value);

const size = computed(() => {
  const bytes = new TextEncoder().encode(raw.value).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
});

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(raw.value);
}
</script>

<template>
  <Sheet
    v-model="open"
    :title="column"
    wide
  >
    <div class="meta">
      <span class="chip">{{ kind }}</span>
      <span class="chip">{{ size }}</span>
      <span
        v-if="isJson"
        class="chip"
      >formatted as JSON</span>
      <span
        v-if="value === null"
        class="chip chip--null"
      >NULL</span>
    </div>

    <pre class="value">{{ pretty || '(empty)' }}</pre>

    <template #footer>
      <PressButton @click="copy">
        Copy
      </PressButton>
      <PressButton
        variant="primary"
        @click="open = false"
      >
        Done
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.meta {
  display: flex;
  gap: var(--gap-tight);
  padding-block: var(--gap);
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fill-3);
  font-size: 0.625rem;
  letter-spacing: 0.02em;
}

.chip--null {
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
}

.value {
  max-height: 60vh;
  overflow: auto;
  padding: var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
</style>
