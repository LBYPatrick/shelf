<script setup lang="ts">
/**
 * Bringing a file into a table.
 *
 * Columns are matched by name first, because that is right most of the time and
 * an interface that makes you map every column by hand when the names already
 * agree is doing work the computer should. Anything unmatched is left explicitly
 * unset rather than guessed at by position.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { Column, EntityRef } from '@drivers/types';
import { host } from '../../lib/host';
import CheckBox from '../ui/CheckBox.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import Sheet from '../ui/Sheet.vue';
import { errorMessage } from '@shared/errors';

const props = defineProps<{
  entity: EntityRef;
  columns: readonly Column[];
  connectionId: string;
}>();
const emit = defineEmits<{ done: [number] }>();

const open = defineModel<boolean>({ required: true });

const path = ref('');
const header = ref<readonly string[]>([]);
const preview = ref<readonly (readonly string[])[]>([]);
const total = ref(0);
const mapping = ref<Record<string, string>>({});
const truncateFirst = ref(false);
const running = ref(false);
const error = ref<string | null>(null);

const SKIP = '';

const { t } = useTranslation();

/*
 * One list for every row, because every row offers the same choice: a column
 * from the file, or nothing. Built here rather than in the template so it is
 * assembled once per file rather than once per column per render.
 */
const sourceOptions = computed(() => [
  { value: SKIP, label: t('import.skip') },
  ...header.value.map((name) => ({ value: name, label: name })),
]);

async function choose(): Promise<void> {
  const chosen = await window.shelf.dialogs.openFile({
    title: t('import.chooseFile'),
    extensions: ['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'txt'],
  });
  if (!chosen) return;

  path.value = chosen;
  error.value = null;

  try {
    const result = await host.call('import/preview', { path: chosen, limit: 5 });
    header.value = result.header;
    preview.value = result.rows;
    total.value = result.total;

    // Match on name, case-insensitively — a header of "ID" and a column of "id"
    // is the same column, and refusing to see that would be pedantry.
    const byLower = new Map(result.header.map((name) => [name.toLowerCase(), name]));
    mapping.value = Object.fromEntries(
      props.columns.map((column) => [
        column.name,
        byLower.get(column.name.toLowerCase()) ?? SKIP,
      ])
    );
  } catch (caught) {
    error.value = errorMessage(caught);
  }
}

const mapped = computed(() =>
  Object.entries(mapping.value).filter(([, source]) => source !== SKIP)
);

const unmatched = computed(() =>
  props.columns.filter((column) => !mapping.value[column.name]).map((column) => column.name)
);

async function run(): Promise<void> {
  running.value = true;
  error.value = null;

  try {
    const result = await host.call('import/run', {
      connectionId: props.connectionId,
      entity: props.entity,
      path: path.value,
      mapping: Object.fromEntries(mapped.value),
      truncateFirst: truncateFirst.value,
    });

    open.value = false;
    emit('done', result.inserted);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    running.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) return;
  path.value = '';
  header.value = [];
  preview.value = [];
  error.value = null;
});
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('import.title', { name: entity.name })"
    wide
  >
    <FormField
      :label="$t('import.file')"
      :help="$t('import.fileHelp')"
    >
      <div class="file">
        <span class="file__path">{{ path || $t('import.nothingChosen') }}</span>
        <PressButton
          variant="glass"
          @click="choose"
        >
          {{ $t('action.choose') }}
        </PressButton>
      </div>
    </FormField>

    <template v-if="header.length">
      <p class="count">
        {{ $t('import.rowsFound', { count: total }) }}
      </p>

      <p class="import__label type-label">
        {{ $t('import.firstRows') }}
      </p>
      <div class="preview">
        <table>
          <thead>
            <tr>
              <th
                v-for="name in header"
                :key="name"
              >
                {{ name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in preview"
              :key="index"
            >
              <td
                v-for="(cell, cellIndex) in row"
                :key="cellIndex"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="import__label type-label">
        {{ $t('import.columns') }}
      </p>
      <div class="map">
        <div
          v-for="column in columns"
          :key="column.name"
          class="map__row"
        >
          <span class="map__target">
            {{ column.name }}
            <span class="map__type">{{ column.dataType }}</span>
          </span>

          <!--
            The app's own list, not the engine's.
            ────────────────────────────────────
            This was the last native `<select>` left in the window, and it is
            the one control that gives its popup to the operating system to
            draw — its own focus ring, its own selection colour, its own idea of
            where the list goes. It survived because the sweep that found the
            others only looked at the settings sheet, which this is not.
          -->
          <SelectMenu
            v-model="mapping[column.name]"
            class="map__select"
            :options="sourceOptions"
            :aria-label="$t('import.sourceFor', { name: column.name })"
          />
        </div>
      </div>

      <p
        v-if="unmatched.length"
        class="note"
      >
        {{ $t('import.unmatched', { count: unmatched.length, names: unmatched.join(', ') }) }}
      </p>

      <CheckBox
        v-model="truncateFirst"
        :label="$t('import.replace')"
        :hint="$t('import.replaceHelp')"
      />
    </template>

    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>

    <template #footer>
      <PressButton @click="open = false">
        {{ $t('action.cancel') }}
      </PressButton>
      <PressButton
        variant="primary"
        :disabled="!path || mapped.length === 0 || running"
        @click="run"
      >
        {{ running ? $t('import.importing') : $t('import.importRows', { count: total }) }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.file {
  display: flex;
  align-items: center;
  gap: var(--gap);
}

.file__path {
  flex: 1;
  min-width: 0;
  padding: 0 var(--gap);
  height: var(--field-h);
  display: flex;
  align-items: center;
  border-radius: var(--radius-field);
  background: var(--fill-4);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.count {
  padding-block: var(--gap);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.import__label {
  padding-block: var(--gap-tight);
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.preview {
  overflow-x: auto;
  border-radius: 0.5rem;
  border: 1px solid var(--separator);
  margin-bottom: var(--gap-loose);
}

.preview table {
  border-collapse: collapse;
  font-size: 0.6875rem;
  font-family: var(--font-mono);
  white-space: nowrap;
}

.preview th,
.preview td {
  padding: 3px var(--gap);
  border-bottom: 1px solid var(--separator);
  text-align: start;
}

.preview th {
  background: var(--fill-4);
  font-weight: 500;
}

.map {
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  margin-bottom: var(--gap-loose);
}

.map__row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--gap);
}

.map__target {
  font-size: 0.75rem;
}

.map__type {
  margin-inline-start: var(--gap-tight);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.map__select {
  min-width: 11rem;
  font-size: 0.75rem;
}

.note {
  padding: var(--gap) var(--gap-loose);
  border-radius: 0.5rem;
  background: color-mix(in oklab, var(--color-warning) 14%, transparent);
  font-size: 0.6875rem;
  margin-bottom: var(--gap-loose);
}

.error {
  margin-top: var(--gap-loose);
  padding: var(--gap) var(--gap-loose);
  border-radius: 0.5rem;
  background: color-mix(in oklab, var(--color-error) 15%, transparent);
  font-size: 0.75rem;
}
</style>
