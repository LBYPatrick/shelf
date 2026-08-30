<script setup lang="ts">
/**
 * Rows the assistant read, drawn as a table.
 *
 * Not the data grid. That component is a virtualised, editable, resizable,
 * exportable surface that measures its columns in a canvas and owns its own
 * scroll — everything a tab full of rows needs and nothing a twenty-row aside
 * inside a conversation does. Mounting one per answer would put several
 * Tabulator instances in a scrolling transcript, each with its own observers.
 *
 * So: a plain table with a sticky head, capped in height, scrolling inside its
 * own box. `display: table` is set explicitly because Tailwind's `.grid` and
 * friends are single declarations that outrank a scoped rule which sets width
 * and layout but not display — the failure that turned the structure view into
 * two independently sized tables.
 */
import { computed } from 'vue';
import type { Field, Row } from '@drivers/types';
import { displayValue } from '@shared/values';
import { useSettings } from '../../stores/settings';

const props = defineProps<{
  fields: readonly Field[];
  rows: readonly Row[];
  truncated: boolean;
  durationMs: number;
}>();

const settings = useSettings();

/** Rows drawn here. Past this it is a query tab's job, not a footnote's. */
const CEILING = 50;

const shown = computed(() => props.rows.slice(0, CEILING));

const summary = computed(() => {
  const parts = [`${props.rows.length}`, `${Math.round(props.durationMs)} ms`];
  return parts;
});

function cell(row: Row, field: Field): string {
  return displayValue(row[field.name] ?? null, {
    encoding: settings.values.binaryEncoding,
    ...(field.dataType ? { dataType: field.dataType } : {}),
  });
}

function isNull(row: Row, field: Field): boolean {
  return row[field.name] === null || row[field.name] === undefined;
}
</script>

<template>
  <div class="rows">
    <div class="rows__scroll">
      <table class="rows__table">
        <thead>
          <tr>
            <th v-for="field in fields" :key="field.name" scope="col">
              {{ field.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in shown" :key="index">
            <td
              v-for="field in fields"
              :key="field.name"
              :class="{ rows__null: isNull(row, field) }"
            >
              {{ isNull(row, field) ? 'NULL' : cell(row, field) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="rows__foot type-label">
      <span>{{ $t('assistant.rowsRead', { rows: summary[0], ms: summary[1] }) }}</span>
      <!--
        Two different kinds of "there is more", and they are not the same fact:
        one is the server having stopped early, the other is this table showing
        part of what came back. Saying only the first would be a table quietly
        missing rows with nothing on screen to say why.
      -->
      <span v-if="rows.length > shown.length">{{
        $t('assistant.showingFirst', { count: shown.length })
      }}</span>
      <span v-else-if="truncated">{{ $t('assistant.cutOff') }}</span>
    </p>
  </div>
</template>

<style scoped>
.rows {
  margin: var(--gap) 0;
  border: 1px solid var(--separator);
  border-radius: 0.75rem;
  overflow: hidden;
  /* The same paper the statement above it is on — see the note in `SqlBlock`. */
  background: var(--surface-raised);
}

.rows__scroll {
  max-height: 15rem;
  overflow: auto;
  overscroll-behavior: contain;
}

.rows__table {
  display: table;
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.rows__table th,
.rows__table td {
  padding: var(--gap-tight) var(--gap-loose);
  text-align: start;
  white-space: nowrap;
  border-bottom: 1px solid var(--separator);
}

.rows__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  /* Opaque, or the rows scroll visibly through the header behind it — and the
     card's own surface, which it used not to be: a `--color-base-100` header on
     a `--fill-1` card is two unrelated surfaces in one object. */
  background: var(--surface-raised);
  font-weight: 600;
  font-size: 0.6875rem;
  letter-spacing: 0.01em;
  color: var(--text-soft);
}

.rows__table td {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.rows__table tbody tr:last-child td {
  border-bottom: 0;
}

.rows__null {
  opacity: 0.4;
  font-style: italic;
}

.rows__foot {
  display: flex;
  gap: var(--gap-loose);
  padding: var(--gap-tight) var(--gap-loose);
  border-top: 1px solid var(--separator);
  opacity: 0.65;
}
</style>
