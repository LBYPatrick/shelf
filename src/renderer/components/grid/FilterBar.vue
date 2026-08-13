<script setup lang="ts" generic="T">
/**
 * The table filter.
 *
 * Two modes over one contract. The builder covers what people actually filter
 * on — a column, an operator, a value, joined by and/or — without anyone having
 * to know the engine's dialect. Raw is there because the builder will always be
 * a subset of what SQL can express, and hiding that is worse than offering both.
 *
 * Switching modes keeps whichever side you were on intact, so flipping to raw to
 * check something and back does not cost you the rows you had built.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { Column, ColumnFilter, FilterOperator, Filters } from '@drivers/types';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import SelectMenu from '../ui/SelectMenu.vue';

const props = defineProps<{
  columns: readonly Column[];
  /** What is currently in force, so the bar can show whether it is dirty. */
  applied?: Filters | undefined;
}>();

const emit = defineEmits<{ apply: [Filters | undefined] }>();

const { t } = useTranslation();

/** Operators that take no value — the field is meaningless and is hidden. */
const VALUELESS: readonly FilterOperator[] = ['is null', 'is not null'];

/** Operators that take a list, entered comma-separated. */
const LIST: readonly FilterOperator[] = ['in', 'not in'];

const OPERATORS: readonly FilterOperator[] = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'like',
  'not like',
  'in',
  'not in',
  'is null',
  'is not null',
];

const mode = ref<'builder' | 'raw'>('builder');
const raw = ref('');

interface Draft {
  column: string;
  operator: FilterOperator;
  value: string;
  join: 'and' | 'or';
}

function blankRow(): Draft {
  return {
    column: props.columns[0]?.name ?? '',
    operator: '=',
    value: '',
    join: 'and',
  };
}

const rows = ref<Draft[]>([blankRow()]);

// A table that arrives after the bar is built (or a different table in the same
// tab) leaves the drafts pointing at columns that no longer exist.
watch(
  () => props.columns,
  (columns) => {
    if (!columns.length) return;
    const names = new Set(columns.map((column) => column.name));
    if (rows.value.every((row) => names.has(row.column))) return;
    rows.value = [blankRow()];
  }
);

const columnOptions = computed(() =>
  props.columns.map((column) => ({ value: column.name, label: column.name }))
);

const operatorOptions = computed(() =>
  OPERATORS.map((operator) => ({ value: operator, label: operator }))
);

const joinOptions = computed(() => [
  { value: 'and' as const, label: t('filter.and') },
  { value: 'or' as const, label: t('filter.or') },
]);

function takesValue(operator: FilterOperator): boolean {
  return !VALUELESS.includes(operator);
}

/** Rows with no value are dropped rather than sent as an empty comparison. */
const built = computed<readonly ColumnFilter[]>(() =>
  rows.value
    .filter((row) => row.column && (!takesValue(row.operator) || row.value.trim() !== ''))
    .map((row, index) => ({
      column: row.column,
      operator: row.operator,
      ...(takesValue(row.operator)
        ? {
            value: LIST.includes(row.operator)
              ? row.value.split(',').map((part) => part.trim())
              : row.value,
          }
        : {}),
      // The first row has nothing to join to, and sending a join for it would
      // make the generated SQL start with a dangling AND.
      ...(index > 0 ? { join: row.join } : {}),
    }))
);

function apply(): void {
  if (mode.value === 'raw') {
    const expression = raw.value.trim();
    emit('apply', expression ? { kind: 'raw', expression } : undefined);
    return;
  }
  emit('apply', built.value.length ? { kind: 'builder', filters: built.value } : undefined);
}

function clear(): void {
  rows.value = [blankRow()];
  raw.value = '';
  emit('apply', undefined);
}

function addRow(): void {
  rows.value = [...rows.value, blankRow()];
}

function removeRow(index: number): void {
  rows.value =
    rows.value.length === 1 ? [blankRow()] : rows.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div class="filterbar">
    <div
      v-if="mode === 'builder'"
      class="filterbar__rows"
    >
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="filterbar__row"
      >
        <!-- The first condition has nothing to join to, so it says so rather
             than offering a choice that does nothing. Both occupy the same
             width, so the columns below line up instead of stepping sideways
             as "where" gives way to "and". -->
        <span
          v-if="index === 0"
          class="filterbar__lead type-label"
        >{{
          $t('filter.where')
        }}</span>
        <SelectMenu
          v-else
          v-model="row.join"
          class="filterbar__lead"
          :options="joinOptions"
          :aria-label="$t('filter.join')"
        />

        <SelectMenu
          v-model="row.column"
          class="filterbar__column"
          :options="columnOptions"
          :aria-label="$t('filter.column')"
        />

        <SelectMenu
          v-model="row.operator"
          class="filterbar__operator"
          :options="operatorOptions"
          :aria-label="$t('filter.operator')"
        />

        <!-- An operator that takes no value hides the field rather than
             disabling it: a greyed box invites a click that does nothing. -->
        <input
          v-if="takesValue(row.operator)"
          v-model="row.value"
          class="filterbar__value focus-fill"
          type="text"
          spellcheck="false"
          :placeholder="
            LIST.includes(row.operator) ? $t('filter.listHint') : $t('filter.value')
          "
          :aria-label="$t('filter.value')"
          @keydown.enter="apply"
        >
        <span
          v-else
          class="filterbar__value filterbar__value--none"
        />

        <button
          type="button"
          class="filterbar__drop focus-fill"
          :aria-label="$t('filter.removeRow')"
          :title="$t('filter.removeRow')"
          @click="removeRow(index)"
        >
          <AppIcon
            name="close"
            :size="10"
          />
        </button>
      </div>

      <button
        type="button"
        class="filterbar__add focus-fill"
        @click="addRow"
      >
        <AppIcon
          name="plus"
          :size="10"
        />
        {{ $t('filter.addCondition') }}
      </button>
    </div>

    <input
      v-else
      v-model="raw"
      class="filterbar__raw focus-fill"
      type="text"
      spellcheck="false"
      :placeholder="$t('table.filterPlaceholder')"
      :aria-label="$t('filter.raw')"
      @keydown.enter="apply"
    >

    <!-- The controls that act on the whole filter sit apart from the conditions
         they act on, at the end of the bar rather than above them. -->
    <div class="filterbar__actions">
      <div
        class="filterbar__modes"
        role="group"
        :aria-label="$t('filter.mode')"
      >
        <button
          v-for="option in ['builder', 'raw'] as const"
          :key="option"
          type="button"
          class="filterbar__mode"
          :class="{ 'filterbar__mode--on': mode === option }"
          :aria-pressed="mode === option"
          @click="mode = option"
        >
          {{ $t(`filter.${option}`) }}
        </button>
      </div>

      <button
        v-if="applied"
        type="button"
        class="filterbar__clear focus-fill"
        @click="clear"
      >
        {{ $t('action.clear') }}
      </button>

      <PressButton
        size="sm"
        variant="primary"
        @click="apply"
      >
        {{ $t('action.apply') }}
      </PressButton>
    </div>
  </div>
</template>

<style scoped>
/*
 * One row per condition, and the whole thing sits on a single line when there
 * is only one — which is the common case and the one that was worst before:
 * three full-width controls stretched across the pane with a mode switch and an
 * Apply button stacked above them, for what is usually `column = value`.
 */
.filterbar {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  padding: var(--gap-tight) var(--gap);
  border-bottom: 1px solid var(--separator);
}

.filterbar__rows {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
}

.filterbar__row {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
}

/*
 * The controls are sized to what they hold, not stretched to fill. A column
 * name is short, an operator is shorter still, and giving each a third of the
 * pane is what made this read as a form rather than a filter.
 */
.filterbar__lead {
  flex: 0 0 auto;
  width: 4rem;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

span.filterbar__lead {
  padding-inline-start: var(--gap-tight);
}

.filterbar__column {
  flex: 0 1 11rem;
  width: 11rem;
  min-width: 6rem;
}

.filterbar__operator {
  flex: 0 0 auto;
  width: 6.5rem;
}

.filterbar__value {
  flex: 1 1 9rem;
  min-width: 5rem;
  max-width: 18rem;
  height: var(--field-h);
  padding-inline: var(--gap-loose);
  border: 1px solid transparent;
  border-radius: var(--control-radius);
  background-color: var(--fill-3);
  color: var(--color-base-content);
  font-size: 0.8125rem;
}

.filterbar__value--none {
  flex: 0 0 auto;
  width: 0;
  background: none;
}

/* Removing a condition is a quiet action, so it is a mark rather than a
   button — it only needs to be found once you are already looking at the row. */
.filterbar__drop,
.filterbar__add {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-hair);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  font-size: 0.6875rem;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.filterbar__drop {
  padding-inline: var(--gap-tight);
  min-width: var(--field-h);
  justify-content: center;
}

.filterbar__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-tight);
  margin-inline-start: auto;
}

/* A two-state switch, not a segmented control: there is nothing between the
   two states for an indicator to travel across. */
.filterbar__modes {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--control-radius);
  background-color: var(--fill-4);
}

.filterbar__mode {
  height: calc(var(--field-h) - 4px);
  padding-inline: var(--gap);
  border-radius: calc(var(--control-radius) - 2px);
  font-size: 0.6875rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.filterbar__mode--on {
  background-color: var(--control-thumb);
  box-shadow: var(--elev-thumb);
  color: var(--color-base-content);
}

.filterbar__clear {
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

.filterbar__raw {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  padding-inline: var(--gap-loose);
  border: 1px solid transparent;
  border-radius: var(--control-radius);
  background-color: var(--fill-3);
  color: var(--color-base-content);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

@media (hover: hover) and (pointer: fine) {
  .filterbar__mode:not(.filterbar__mode--on):hover,
  .filterbar__clear:hover {
    color: var(--color-base-content);
  }

  .filterbar__drop:hover,
  .filterbar__add:hover {
    background-color: var(--fill-4);
    color: var(--color-base-content);
  }

  .filterbar__value:hover,
  .filterbar__raw:hover {
    background-color: var(--fill-2);
  }
}
</style>
