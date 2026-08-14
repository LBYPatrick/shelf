<script setup lang="ts">
/**
 * The short answer.
 *
 * What a table is made of, in the shape you want when you are halfway through
 * writing a query and cannot remember whether the column is `released` or
 * `release_date`. Properties is the reference; this is the glance — one list,
 * no sections, no controls, dismissed with the same key that opened it.
 *
 * Keys are marked rather than listed separately, because the question being
 * answered is "what can I select" and a primary key is a column first.
 */
import { computed, ref, watch } from 'vue';
import type { Column, EntityProperties, EntityRef } from '@drivers/types';
import { errorMessage } from '@shared/errors';
import { formatBytes } from '@shared/bytes';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import Sheet from '../ui/Sheet.vue';
import PressButton from '../ui/PressButton.vue';

const props = defineProps<{ entity: EntityRef }>();
const open = defineModel<boolean>({ required: true });

const connections = useConnections();

const columns = ref<readonly Column[]>([]);
const properties = ref<EntityProperties>({});
const loading = ref(false);
const error = ref<string | null>(null);

const qualified = computed(() =>
  props.entity.schema ? `${props.entity.schema}.${props.entity.name}` : props.entity.name
);

/** A SELECT of every column by name — the thing you were about to type. */
const selectAll = computed(() =>
  columns.value.length === 0
    ? ''
    : `SELECT ${columns.value.map((column) => column.name).join(', ')}\nFROM ${qualified.value};`
);

const copied = ref(false);

async function copySelect(): Promise<void> {
  await navigator.clipboard.writeText(selectAll.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const connectionId = connections.requireId();
    const [columnList, props_] = await Promise.all([
      host.call('schema/columns', { connectionId, entity: props.entity }),
      host.call('schema/properties', { connectionId, entity: props.entity }),
    ]);
    columns.value = columnList;
    properties.value = props_;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

/*
 * Fetched when it opens rather than on mount: the menu that summons this is on
 * every row in the sidebar, and none of them should cost a round trip to sit
 * there.
 *
 * `immediate` because the component is created *by* being opened — the caller
 * sets the entity and the flag in the same tick, so the sheet mounts with `open`
 * already true and a plain watcher would never see the change. That is exactly
 * how it first shipped: a popup with a title and nothing under it.
 */
watch(
  open,
  (isOpen) => {
    if (isOpen) void load();
  },
  { immediate: true }
);
</script>

<template>
  <Sheet
    v-model="open"
    :title="qualified"
  >
    <p class="summary type-label">
      <span>{{ entity.schema ?? $t('properties.noSchema') }}</span>
      <span v-if="properties.rowCount !== undefined">· {{ $t('properties.rowsCount', { count: properties.rowCount }) }}</span>
      <span v-if="properties.dataSizeBytes !== undefined">· {{ formatBytes(properties.dataSizeBytes) }}</span>
    </p>

    <p
      v-if="properties.comment"
      class="comment"
    >
      {{ properties.comment }}
    </p>

    <p
      v-if="error"
      class="note note--error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="loading"
      class="note"
    >
      {{ $t('workspace.loading') }}
    </p>

    <!--
      Name and type on one line each, the type set right so the eye can run down
      the column of types without reading a single name.
    -->
    <ul
      v-else
      class="columns"
    >
      <li
        v-for="column in columns"
        :key="column.name"
        class="columns__row"
      >
        <span class="columns__name">
          {{ column.name }}
          <span
            v-if="column.primaryKey"
            class="columns__key"
          >{{ $t('properties.key') }}</span>
        </span>
        <span class="columns__type">
          {{ column.dataType
          }}<span
            v-if="!column.nullable"
            class="columns__req"
          >·{{ $t('properties.required') }}</span>
        </span>
      </li>
    </ul>

    <template #footer>
      <PressButton
        size="sm"
        :disabled="!selectAll"
        @click="copySelect"
      >
        {{ copied ? $t('properties.copied') : $t('properties.copySelect') }}
      </PressButton>
      <PressButton
        variant="primary"
        size="sm"
        @click="open = false"
      >
        {{ $t('action.done') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-tight);
  padding-block: var(--gap) var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.comment {
  margin: 0 0 var(--gap-loose);
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  font-size: 0.8125rem;
}

.note {
  padding: var(--gap-section);
  text-align: center;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.note--error {
  color: var(--color-error);
}

.columns {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 24rem;
  overflow-y: auto;
}

.columns__row {
  display: flex;
  align-items: baseline;
  gap: var(--gap);
  height: calc(var(--row-h) * 1.15);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
}

.columns__row:nth-child(odd) {
  background: var(--fill-4);
}

.columns__name {
  display: flex;
  align-items: baseline;
  gap: var(--gap-tight);
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.columns__key {
  padding: 0 5px;
  border-radius: 999px;
  background-color: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text, var(--color-primary));
  font-family: var(--font-ui);
  font-size: 0.5625rem;
  letter-spacing: 0.02em;
}

.columns__type {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.columns__req {
  color: color-mix(in oklab, var(--color-base-content) 40%, transparent);
}
</style>
