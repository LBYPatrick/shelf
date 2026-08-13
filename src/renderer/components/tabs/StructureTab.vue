<script setup lang="ts">
/**
 * A table's structure.
 *
 * Which sections exist is decided by the engine's capabilities, not by trying
 * each one and catching the failure — a store with no triggers simply has no
 * Triggers pill rather than an empty tab that looks broken.
 */
import { computed, onMounted, ref, watch } from 'vue';
import type {
  Column,
  EntityProperties,
  EntityRef,
  Index,
  Partition,
  Relation,
  Trigger,
} from '@drivers/types';
import { isSupported, type SchemaChange } from '@shared/ddl';
import { useTranslation } from 'i18next-vue';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import AppIcon from '../ui/AppIcon.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Sheet from '../ui/Sheet.vue';
import TextInput from '../ui/TextInput.vue';
import CheckBox from '../ui/CheckBox.vue';
import SchemaChangeSheet from './SchemaChangeSheet.vue';

const props = defineProps<{ entity: EntityRef; active: boolean }>();

const connections = useConnections();
const { t } = useTranslation();

type Section = 'columns' | 'indexes' | 'relations' | 'triggers' | 'partitions';

const section = ref<Section>('columns');
const loading = ref(false);
const error = ref<string | null>(null);

const columns = ref<readonly Column[]>([]);
const indexes = ref<readonly Index[]>([]);
const relations = ref<readonly Relation[]>([]);
const triggers = ref<readonly Trigger[]>([]);
const partitions = ref<readonly Partition[]>([]);
const properties = ref<EntityProperties>({});

const capabilities = computed(() => connections.active?.capabilities);

const sections = computed(() => {
  const available: { value: Section; label: string }[] = [
    { value: 'columns', label: t('structure.columns') },
  ];
  if (capabilities.value?.indexes)
    available.push({ value: 'indexes', label: t('structure.indexes') });
  if (capabilities.value?.relations)
    available.push({ value: 'relations', label: t('structure.relations') });
  if (capabilities.value?.triggers)
    available.push({ value: 'triggers', label: t('structure.triggers') });
  if (capabilities.value?.partitions)
    available.push({ value: 'partitions', label: t('structure.partitions') });
  return available;
});

function connectionId(): string {
  const id = connections.active?.id;
  if (!id) throw new Error('No open connection');
  return id;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  const connection = connectionId();
  const entity = props.entity;
  const can = capabilities.value;

  try {
    // Everything is fetched at once rather than per pill: the requests are
    // small, and switching sections should be instant once the tab is open.
    const [columnList, indexList, relationList, triggerList, partitionList, props_] =
      await Promise.all([
        host.call('schema/columns', { connectionId: connection, entity }),
        can?.indexes ? host.call('schema/indexes', { connectionId: connection, entity }) : [],
        can?.relations
          ? host.call('schema/relations', { connectionId: connection, entity })
          : [],
        can?.triggers ? host.call('schema/triggers', { connectionId: connection, entity }) : [],
        can?.partitions
          ? host.call('schema/partitions', { connectionId: connection, entity })
          : [],
        host.call('schema/properties', { connectionId: connection, entity }),
      ]);

    columns.value = columnList;
    indexes.value = indexList;
    relations.value = relationList;
    triggers.value = triggerList;
    partitions.value = partitionList;
    properties.value = props_;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const isEmpty = computed(() => {
  const counts: Record<Section, number> = {
    columns: columns.value.length,
    indexes: indexes.value.length,
    relations: relations.value.length,
    triggers: triggers.value.length,
    partitions: partitions.value.length,
  };
  return counts[section.value] === 0;
});

/* ---------------------------------------------------------------- editing */

const engine = computed(() => connections.active?.engine);
const canEdit = computed(
  () => (capabilities.value?.ddl ?? false) && !connections.active?.readOnly
);

const pending = ref<SchemaChange | null>(null);
const confirming = ref(false);
const applying = ref(false);

const adding = ref(false);
const newColumn = ref({ name: '', dataType: 'text', nullable: true, defaultValue: '' });

const addingIndex = ref(false);
const newIndex = ref({ name: '', columns: '', unique: false });

function propose(change: SchemaChange): void {
  if (!engine.value || !isSupported(change, engine.value)) {
    error.value = `${engine.value} cannot do that without rewriting the table.`;
    return;
  }
  pending.value = change;
  confirming.value = true;
}

async function apply(sql: string): Promise<void> {
  applying.value = true;
  error.value = null;

  try {
    await host.call('query/run', {
      connectionId: connectionId(),
      text: sql,
      options: { maxRows: 1 },
    });
    confirming.value = false;
    pending.value = null;
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    applying.value = false;
  }
}

function confirmAddColumn(): void {
  const column = newColumn.value;
  if (!column.name.trim() || !column.dataType.trim()) return;

  adding.value = false;
  propose({
    kind: 'add-column',
    entity: props.entity,
    name: column.name.trim(),
    dataType: column.dataType.trim(),
    nullable: column.nullable,
    ...(column.defaultValue.trim() ? { defaultValue: column.defaultValue.trim() } : {}),
  });
}

function confirmAddIndex(): void {
  const index = newIndex.value;
  const columns = index.columns
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!index.name.trim() || columns.length === 0) return;

  addingIndex.value = false;
  propose({
    kind: 'add-index',
    entity: props.entity,
    name: index.name.trim(),
    columns,
    unique: index.unique,
  });
}

onMounted(load);
watch(() => props.entity, load);
</script>

<template>
  <div class="structure">
    <div class="structure__head mat-thin">
      <SegmentedControl
        v-model="section"
        :options="sections"
        :aria-label="$t('structure.columns')"
      />

      <span class="structure__spacer" />

      <PressButton
        v-if="canEdit && section === 'columns'"
        size="sm"
        variant="glass"
        @click="adding = true"
      >
        <AppIcon
          name="plus"
          :size="12"
        />
        {{ $t('structure.column') }}
      </PressButton>

      <PressButton
        v-if="canEdit && section === 'indexes'"
        size="sm"
        variant="glass"
        @click="addingIndex = true"
      >
        <AppIcon
          name="plus"
          :size="12"
        />
        {{ $t('structure.index') }}
      </PressButton>
    </div>

    <p
      v-if="error"
      class="structure__error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="loading"
      class="structure__note"
    >
      {{ $t('workspace.loading') }}
    </p>

    <div
      v-else
      class="structure__body"
    >
      <table
        v-if="section === 'columns'"
        class="grid"
      >
        <thead>
          <tr>
            <th>{{ $t('structure.name') }}</th>
            <th>{{ $t('structure.type') }}</th>
            <th>{{ $t('structure.null') }}</th>
            <th>{{ $t('structure.default') }}</th>
            <th>{{ $t('structure.key') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="column in columns"
            :key="column.name"
          >
            <td class="grid__name">
              {{ column.name }}
            </td>
            <td class="grid__type">
              {{ column.dataType }}
            </td>
            <td>{{ column.nullable ? 'yes' : 'no' }}</td>
            <td class="grid__type">
              {{ column.defaultValue ?? '—' }}
            </td>
            <td>
              <span
                v-if="column.primaryKey"
                class="chip chip--key"
              >PK</span>
              <span
                v-else-if="column.generated"
                class="chip"
              >generated</span>
            </td>
            <td class="grid__actions">
              <button
                v-if="canEdit && !column.primaryKey"
                type="button"
                class="grid__drop"
                :aria-label="$t('structure.dropColumn', { name: column.name })"
                title="Drop column"
                @click="propose({ kind: 'drop-column', entity: entity, name: column.name })"
              >
                <AppIcon
                  name="close"
                  :size="11"
                />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <table
        v-else-if="section === 'indexes'"
        class="grid"
      >
        <thead>
          <tr>
            <th>{{ $t('structure.name') }}</th>
            <th>{{ $t('import.columns') }}</th>
            <th>{{ $t('structure.unique') }}</th>
            <th>{{ $t('structure.type') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="index in indexes"
            :key="index.name"
          >
            <td class="grid__name">
              {{ index.name }}
            </td>
            <td class="grid__type">
              {{ index.columns.join(', ') }}
            </td>
            <td>{{ index.unique ? 'yes' : 'no' }}</td>
            <td>
              <span
                v-if="index.primary"
                class="chip chip--key"
              >primary</span>
              <span v-else>{{ index.type ?? '—' }}</span>
            </td>
            <td class="grid__actions">
              <button
                v-if="canEdit && !index.primary"
                type="button"
                class="grid__drop"
                :aria-label="$t('structure.dropIndex', { name: index.name })"
                title="Drop index"
                @click="propose({ kind: 'drop-index', entity: entity, name: index.name })"
              >
                <AppIcon
                  name="close"
                  :size="11"
                />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <table
        v-else-if="section === 'relations'"
        class="grid"
      >
        <thead>
          <tr>
            <th>{{ $t('structure.name') }}</th>
            <th>{{ $t('structure.direction') }}</th>
            <th>{{ $t('import.columns') }}</th>
            <th>{{ $t('structure.references') }}</th>
            <th>{{ $t('structure.onDelete') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="relation in relations"
            :key="`${relation.name}-${relation.direction}`"
          >
            <td class="grid__name">
              {{ relation.name }}
            </td>
            <td>
              <span class="chip">{{ relation.direction }}</span>
            </td>
            <td class="grid__type">
              {{ relation.columns.join(', ') }}
            </td>
            <td class="grid__type">
              {{ relation.referencedTable.name }}({{ relation.referencedColumns.join(', ') }})
            </td>
            <td>{{ relation.onDelete ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <table
        v-else-if="section === 'triggers'"
        class="grid"
      >
        <thead>
          <tr>
            <th>{{ $t('structure.name') }}</th>
            <th>{{ $t('structure.timing') }}</th>
            <th>{{ $t('structure.event') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="trigger in triggers"
            :key="trigger.name"
          >
            <td class="grid__name">
              {{ trigger.name }}
            </td>
            <td>{{ trigger.timing }}</td>
            <td>{{ trigger.event }}</td>
          </tr>
        </tbody>
      </table>

      <table
        v-else
        class="grid"
      >
        <thead>
          <tr>
            <th>{{ $t('structure.name') }}</th>
            <th>{{ $t('structure.expression') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="partition in partitions"
            :key="partition.name"
          >
            <td class="grid__name">
              {{ partition.name }}
            </td>
            <td class="grid__type">
              {{ partition.expression ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>

      <p
        v-if="isEmpty"
        class="structure__note"
      >
        {{ $t('structure.nothingHere') }}
      </p>
    </div>

    <Sheet
      v-model="adding"
      :title="$t('structure.addColumn')"
    >
      <div class="stack">
        <FormField
          v-slot="{ id }"
          label="Name"
        >
          <TextInput
            :id="id"
            v-model="newColumn.name"
            placeholder="note"
          />
        </FormField>

        <FormField
          v-slot="{ id }"
          label="Type"
          help="Written through as-is, so any type this engine accepts works."
        >
          <TextInput
            :id="id"
            v-model="newColumn.dataType"
            monospace
            placeholder="text"
          />
        </FormField>

        <FormField
          v-slot="{ id }"
          label="Default"
          help="Optional. An expression, not a value — quote strings yourself."
        >
          <TextInput
            :id="id"
            v-model="newColumn.defaultValue"
            monospace
            placeholder="'unset'"
          />
        </FormField>

        <CheckBox
          v-model="newColumn.nullable"
          label="Allow NULL"
          hint="An existing table with rows in it usually has to."
        />
      </div>

      <template #footer>
        <PressButton @click="adding = false">
          {{ $t('action.cancel') }}
        </PressButton>
        <PressButton
          variant="primary"
          :disabled="!newColumn.name.trim() || !newColumn.dataType.trim()"
          @click="confirmAddColumn"
        >
          {{ $t('action.continue') }}
        </PressButton>
      </template>
    </Sheet>

    <Sheet
      v-model="addingIndex"
      :title="$t('structure.addIndex')"
    >
      <div class="stack">
        <FormField
          v-slot="{ id }"
          label="Name"
        >
          <TextInput
            :id="id"
            v-model="newIndex.name"
            :placeholder="`${entity.name}_idx`"
          />
        </FormField>

        <FormField
          v-slot="{ id }"
          label="Columns"
          help="Comma separated, in the order the index should use them."
        >
          <TextInput
            :id="id"
            v-model="newIndex.columns"
            monospace
            placeholder="artist_id, released"
          />
        </FormField>

        <CheckBox
          v-model="newIndex.unique"
          label="Unique"
          hint="Refuses duplicate values across these columns."
        />
      </div>

      <template #footer>
        <PressButton @click="addingIndex = false">
          {{ $t('action.cancel') }}
        </PressButton>
        <PressButton
          variant="primary"
          :disabled="!newIndex.name.trim() || !newIndex.columns.trim()"
          @click="confirmAddIndex"
        >
          {{ $t('action.continue') }}
        </PressButton>
      </template>
    </Sheet>

    <SchemaChangeSheet
      v-if="pending && engine"
      v-model="confirming"
      :change="pending"
      :engine="engine"
      :running="applying"
      @apply="apply"
      @cancel="pending = null"
    />

    <Teleport
      v-if="active"
      to="#statusbar-slot"
      defer
    >
      <div class="tabstatus">
        <span
          v-if="properties.rowCount !== undefined"
          class="tabstatus__item"
        >
          {{ properties.rowCount.toLocaleString() }} rows
        </span>
        <span
          v-if="properties.dataSizeBytes !== undefined"
          class="tabstatus__item"
        >
          {{ formatBytes(properties.dataSizeBytes) }} data
        </span>
        <span
          v-if="properties.indexSizeBytes !== undefined"
          class="tabstatus__item"
        >
          {{ formatBytes(properties.indexSizeBytes) }} indexes
        </span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.structure {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.structure__head {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap-tight) var(--gap);
  border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

.structure__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.structure__error {
  margin: var(--gap);
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-field);
  background: color-mix(in oklab, var(--color-error) 15%, transparent);
  font-size: 0.75rem;
}

.structure__note {
  padding: var(--gap-section);
  text-align: center;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.grid {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

/*
 * Proportions rather than content-sizing: left to itself the table bunched
 * every column against the left edge and left the rest of the pane empty.
 * Names get the room, the yes/no columns stay narrow.
 */
.grid th:first-child,
.grid td:first-child {
  width: 26%;
  padding-inline-start: var(--gap-loose);
}

.grid th:nth-child(2),
.grid td:nth-child(2) {
  width: 22%;
}

.grid th:nth-child(3),
.grid td:nth-child(3) {
  width: 8%;
}

.grid th:nth-child(4),
.grid td:nth-child(4) {
  width: 22%;
}

.grid td,
.grid th {
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0 var(--gap);
  height: calc(var(--row-h) * 1.15);
  text-align: start;
  font-size: 0.6875rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  background: color-mix(in oklab, var(--color-base-200) 92%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent);
}

.grid td {
  padding: 0 var(--gap);
  /* Matches the data grid and the sidebar, so the three panes share a rhythm. */
  height: calc(var(--row-h) * 1.15);
  border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 5%, transparent);
  white-space: nowrap;
}

.grid tbody tr:hover {
  background: color-mix(in oklab, var(--color-primary) 7%, transparent);
}

.structure__spacer {
  flex: 1;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding-block: var(--gap);
}

.grid__actions {
  width: 2rem;
  text-align: end;
}

.grid__drop {
  padding: 3px;
  border-radius: 0.3rem;
  opacity: 0;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    opacity var(--t-press) var(--ease-out),
    background-color var(--t-press) var(--ease-out),
    color var(--t-press) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .grid tbody tr:hover .grid__drop {
    opacity: 1;
  }

  .grid__drop:hover {
    background: var(--color-error);
    color: var(--color-error-content);
  }
}

.grid__drop:focus-visible {
  opacity: 1;
}

.grid__name {
  font-weight: 500;
}

.grid__type {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
}

/*
 * A chip is a label, not a control: the same tonal fill every quiet surface in
 * the app wears, rather than a percentage of the text colour picked by hand
 * here — which is what made these read differently on the dark theme, where the
 * text colour is near-white and a "10% tint" is 10% white.
 */
.chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background-color: var(--fill-3);
  font-size: 0.625rem;
  letter-spacing: 0.01em;
}

/*
 * A key chip carries the accent as *type* on a wash of itself, not as a solid
 * fill. `--color-primary` set as text on a 20% wash of the same colour is the
 * one combination guaranteed to be low contrast, which is exactly what it was.
 */
.chip--key {
  background-color: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.tabstatus {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  white-space: nowrap;
}

.tabstatus__item {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}
</style>
