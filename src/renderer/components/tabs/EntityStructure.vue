<script setup lang="ts">
/**
 * A table's structure: its columns, indexes, relations, triggers and partitions.
 *
 * Which sections exist is decided by the engine's capabilities, not by trying
 * each one and catching the failure — a store with no triggers simply has no
 * Triggers pill rather than an empty tab that looks broken.
 *
 * Shared rather than owned by the structure tab, because the same five sections
 * are what the Properties popup shows. Two copies of this would be four hundred
 * lines kept in agreement by hand.
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
import { useDrag } from '../../composables/useDrag';
import { host } from '../../lib/host';
import { useToasts } from '../../stores/toasts';
import { useConnections } from '../../stores/connections';
import AppIcon from '../ui/AppIcon.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Sheet from '../ui/Sheet.vue';
import TextInput from '../ui/TextInput.vue';
import CheckBox from '../ui/CheckBox.vue';
import SchemaChangeSheet from './SchemaChangeSheet.vue';
import { errorMessage } from '@shared/errors';

const props = defineProps<{ entity: EntityRef }>();

/*
 * The properties travel out rather than being rendered here: the tab puts them
 * in the status bar and the popup puts them in its header, and neither of those
 * is this component's business.
 */
const emit = defineEmits<{ loaded: [EntityProperties] }>();

const connections = useConnections();
const toasts = useToasts();
const { t } = useTranslation();

type Section = 'columns' | 'indexes' | 'relations' | 'triggers' | 'partitions';

const section = ref<Section>('columns');
const loading = ref(false);
const error = ref<string | null>(null);
/*
 * A table with two hundred columns is a list you scroll looking for one name.
 * The box narrows whichever section is showing rather than being a search of
 * its own, so there is one thing to learn and it works everywhere.
 */
const filter = ref('');

const columns = ref<readonly Column[]>([]);
const indexes = ref<readonly Index[]>([]);
const relations = ref<readonly Relation[]>([]);
const triggers = ref<readonly Trigger[]>([]);
const partitions = ref<readonly Partition[]>([]);
const properties = ref<EntityProperties>({});

const capabilities = computed(() => connections.active?.capabilities);

/*
 * The head of each section, in one place.
 *
 * The five tables used to declare their own `<colgroup>` and `<thead>`, which
 * is five copies of the same two facts — what the columns are called and how
 * wide they start. Naming them once is what makes a grip on the edge of a
 * header possible at all: a width the reader has dragged has to be written
 * somewhere both the head and the body read from.
 */
interface HeadColumn {
  readonly key: string;
  /** Translation key, or absent for the actions column, which is unlabelled. */
  readonly label?: string;
  /** The width it starts at, before anyone drags anything. */
  readonly share: string;
}

const HEADS: Record<Section, readonly HeadColumn[]> = {
  columns: [
    { key: 'name', label: 'structure.name', share: '34%' },
    { key: 'type', label: 'structure.type', share: '26%' },
    { key: 'nullable', label: 'structure.nullable', share: '12%' },
    { key: 'default', label: 'structure.default', share: '22%' },
    { key: 'actions', share: '6%' },
  ],
  indexes: [
    { key: 'name', label: 'structure.name', share: '34%' },
    { key: 'columns', label: 'import.columns', share: '34%' },
    { key: 'type', label: 'structure.type', share: '24%' },
    { key: 'actions', share: '8%' },
  ],
  relations: [
    { key: 'name', label: 'structure.name', share: '28%' },
    { key: 'columns', label: 'import.columns', share: '24%' },
    { key: 'references', label: 'structure.references', share: '30%' },
    { key: 'onDelete', label: 'structure.onDelete', share: '18%' },
  ],
  triggers: [
    { key: 'name', label: 'structure.name', share: '40%' },
    { key: 'timing', label: 'structure.timing', share: '30%' },
    { key: 'event', label: 'structure.event', share: '30%' },
  ],
  partitions: [
    { key: 'name', label: 'structure.name', share: '40%' },
    { key: 'expression', label: 'structure.expression', share: '60%' },
  ],
};

const head = computed(() => HEADS[section.value]);

/* ------------------------------------------------------- resizable columns */

/** Narrow enough to push a column out of the way, wide enough to still grab. */
const MIN_COLUMN = 56;

/**
 * Pixel widths, per section, once anyone has dragged one.
 *
 * Until then the declared shares hold and the table fills the pane, which is
 * the right default and the one that survives a resize of the window. The first
 * drag measures what the browser worked out and freezes it, so the column that
 * moves is the only one that changes.
 */
const widths = ref<Partial<Record<Section, number[]>>>({});
const bodyEl = ref<HTMLElement>();

let grip: number | null = null;

function measured(): number[] | undefined {
  return widths.value[section.value];
}

function freeze(): void {
  if (measured()) return;
  const cells = bodyEl.value?.querySelectorAll<HTMLElement>('table.rows thead th');
  if (!cells?.length) return;
  widths.value = {
    ...widths.value,
    [section.value]: [...cells].map((cell) => Math.round(cell.getBoundingClientRect().width)),
  };
}

const { start: startResize, dragging: resizing } = useDrag({
  axis: 'x',
  getValue: () => (grip === null ? 0 : (measured()?.[grip] ?? 0)),
  onDrag: ({ value }) => {
    if (grip === null) return;
    const set = [...(measured() ?? [])];
    set[grip] = Math.max(MIN_COLUMN, Math.round(value));
    widths.value = { ...widths.value, [section.value]: set };
  },
});

function beginResize(event: PointerEvent, index: number): void {
  freeze();
  grip = index;
  startResize(event);
}

function colStyle(index: number): { width: string } {
  const set = measured();
  return { width: set?.[index] ? `${set[index]}px` : (head.value[index]?.share ?? 'auto') };
}

/**
 * The table's own width. Once columns are in pixels it is their sum, so a
 * column dragged wider takes the room from the pane rather than from its
 * neighbours — the pane scrolls, which is what a resizable table does
 * everywhere else it exists.
 */
const tableStyle = computed(() => {
  const set = measured();
  if (!set) return { width: '100%' };
  return { width: `${set.reduce((total, width) => total + width, 0)}px` };
});

/* ------------------------------------------------------------ wrapped text */

/**
 * Off by default: a table is scanned down its first column, and rows of
 * different heights make that a slower read than an ellipsis does. On, nothing
 * is hidden — a default that is a whole expression long takes the lines it
 * needs instead of ending in three dots.
 */
const wrapping = ref(false);

/*
 * Said out loud, because the control is an icon and its effect is invisible on
 * a table whose values all happen to fit: pressing it and seeing nothing change
 * is indistinguishable from pressing a dead button.
 */
function toggleWrap(): void {
  wrapping.value = !wrapping.value;
  toasts.show({
    id: 'structure-wrap',
    tone: 'info',
    message: wrapping.value ? t('structure.wrapOn') : t('structure.wrapOff'),
  });
}

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

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  const connection = connections.requireId();
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
    emit('loaded', props_);
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

/**
 * Matches anything the row shows, so a search for a type or a referenced table
 * works as well as a search for a name — the reader should not have to know
 * which column the word they remember lives in.
 */
function matches(...parts: readonly (string | undefined)[]): boolean {
  const needle = filter.value.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

const shownColumns = computed(() =>
  columns.value.filter((column) =>
    matches(column.name, column.dataType, column.defaultValue, column.comment)
  )
);
const shownIndexes = computed(() =>
  indexes.value.filter((index) => matches(index.name, index.columns.join(' '), index.type))
);
const shownRelations = computed(() =>
  relations.value.filter((relation) =>
    matches(
      relation.name,
      relation.columns.join(' '),
      relation.referencedTable.name,
      relation.referencedColumns.join(' ')
    )
  )
);
const shownTriggers = computed(() =>
  triggers.value.filter((trigger) => matches(trigger.name, trigger.timing, trigger.event))
);
const shownPartitions = computed(() =>
  partitions.value.filter((partition) => matches(partition.name, partition.expression))
);

const shownCount = computed(() => {
  const counts: Record<Section, number> = {
    columns: shownColumns.value.length,
    indexes: shownIndexes.value.length,
    relations: shownRelations.value.length,
    triggers: shownTriggers.value.length,
    partitions: shownPartitions.value.length,
  };
  return counts[section.value];
});

const isEmpty = computed(() => shownCount.value === 0);
/** Empty because nothing matched is a different message from empty because
    there is nothing — one is the reader's doing and can be undone. */
const isFiltered = computed(() => filter.value.trim().length > 0);

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
      connectionId: connections.requireId(),
      text: sql,
      options: { maxRows: 1 },
    });
    confirming.value = false;
    pending.value = null;
    await load();
  } catch (caught) {
    error.value = errorMessage(caught);
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
  <div
    class="structure"
    :class="{ 'structure--wrap': wrapping, 'structure--resizing': resizing }"
  >
    <div class="structure__head">
      <SegmentedControl
        v-model="section"
        :options="sections"
        :aria-label="$t('structure.sections')"
      />

      <span class="structure__spacer" />

      <PressButton
        v-tip="$t('structure.wrapHint')"
        size="sm"
        :active="wrapping"
        :aria-label="$t('structure.wrap')"
        @click="toggleWrap"
      >
        <AppIcon
          name="wrap"
          :size="13"
        />
      </PressButton>

      <label class="structure__find">
        <AppIcon
          name="search"
          :size="12"
        />
        <input
          v-model="filter"
          type="search"
          class="structure__find-input"
          spellcheck="false"
          :aria-label="$t('structure.filter')"
          :placeholder="$t('structure.filter')"
        >
      </label>

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
      ref="bodyEl"
      class="structure__body"
    >
      <!--
        Every section states its own column widths in a `colgroup`.

        The widths used to be `nth-child` rules shared by all five tables, which
        meant the two-column partitions list wore the six-column layout and left
        half its width empty. A `colgroup` is also the only place a width can be
        declared once for a header cell and its body cells together — declared
        on the cells, they are two sets of numbers that have to agree, and the
        header and the body are exactly the two things that must never disagree.
      -->
      <table
        v-if="section === 'columns'"
        class="rows"
        :style="tableStyle"
      >
        <colgroup>
          <col
            v-for="(column, index) in head"
            :key="column.key"
            :style="colStyle(index)"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, index) in head"
              :key="column.key"
            >
              <span v-if="column.label">{{ $t(column.label) }}</span>
              <span
                v-else
                class="sr-only"
              >{{ $t('structure.actions') }}</span>
              <!--
                On the *leading* edge of every header but the first, sizing the
                column to its left. A grip on the trailing edge is the same
                boundary and reads the same way, but half of it overhangs the
                next header — and a sticky header is its own stacking context,
                so the neighbour paints over the half of the grip that is on it
                and swallows every press aimed at the middle.
              -->
              <span
                v-if="index > 0"
                class="rows__grip"
                @pointerdown.prevent.stop="beginResize($event, index - 1)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="column in shownColumns"
            :key="column.ordinal"
          >
            <!--
              The description goes under the name rather than in a column of its
              own. A sentence needs the width of a sentence, and giving it one
              across five sections would have squeezed every other value in the
              table to make room for a field most rows leave empty.
            -->
            <td class="rows__lead">
              <span class="rows__name">
                {{ column.name }}
                <span
                  v-if="column.primaryKey"
                  class="chip chip--key"
                >{{
                  $t('structure.pk')
                }}</span>
                <span
                  v-else-if="column.generated"
                  class="chip"
                >{{
                  $t('structure.generated')
                }}</span>
              </span>
              <span
                v-if="column.comment"
                class="rows__note"
                :title="column.comment"
              >{{
                column.comment
              }}</span>
            </td>
            <td class="rows__code">
              {{ column.dataType }}
            </td>
            <td>
              <span
                v-if="!column.nullable"
                class="chip chip--strict"
              >{{
                $t('structure.notNull')
              }}</span>
              <span
                v-else
                class="rows__muted"
              >{{ $t('structure.yes') }}</span>
            </td>
            <td class="rows__code">
              {{ column.defaultValue ?? '—' }}
            </td>
            <td class="rows__actions">
              <button
                v-if="canEdit && !column.primaryKey"
                type="button"
                class="rows__drop"
                :aria-label="$t('structure.dropColumn', { name: column.name })"
                :title="$t('structure.dropColumn', { name: column.name })"
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
        class="rows"
        :style="tableStyle"
      >
        <colgroup>
          <col
            v-for="(column, index) in head"
            :key="column.key"
            :style="colStyle(index)"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, index) in head"
              :key="column.key"
            >
              <span v-if="column.label">{{ $t(column.label) }}</span>
              <span
                v-else
                class="sr-only"
              >{{ $t('structure.actions') }}</span>
              <!--
                On the *leading* edge of every header but the first, sizing the
                column to its left. A grip on the trailing edge is the same
                boundary and reads the same way, but half of it overhangs the
                next header — and a sticky header is its own stacking context,
                so the neighbour paints over the half of the grip that is on it
                and swallows every press aimed at the middle.
              -->
              <span
                v-if="index > 0"
                class="rows__grip"
                @pointerdown.prevent.stop="beginResize($event, index - 1)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="index in shownIndexes"
            :key="index.name"
          >
            <td class="rows__lead">
              <span class="rows__name">
                {{ index.name }}
                <span
                  v-if="index.primary"
                  class="chip chip--key"
                >{{
                  $t('structure.pk')
                }}</span>
                <span
                  v-else-if="index.unique"
                  class="chip chip--strict"
                >{{
                  $t('structure.unique')
                }}</span>
              </span>
            </td>
            <td class="rows__code">
              {{ index.columns.join(', ') }}
            </td>
            <td class="rows__muted">
              {{ index.type ?? '—' }}
            </td>
            <td class="rows__actions">
              <button
                v-if="canEdit && !index.primary"
                type="button"
                class="rows__drop"
                :aria-label="$t('structure.dropIndex', { name: index.name })"
                :title="$t('structure.dropIndex', { name: index.name })"
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
        class="rows"
        :style="tableStyle"
      >
        <colgroup>
          <col
            v-for="(column, index) in head"
            :key="column.key"
            :style="colStyle(index)"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, index) in head"
              :key="column.key"
            >
              <span v-if="column.label">{{ $t(column.label) }}</span>
              <span
                v-else
                class="sr-only"
              >{{ $t('structure.actions') }}</span>
              <!--
                On the *leading* edge of every header but the first, sizing the
                column to its left. A grip on the trailing edge is the same
                boundary and reads the same way, but half of it overhangs the
                next header — and a sticky header is its own stacking context,
                so the neighbour paints over the half of the grip that is on it
                and swallows every press aimed at the middle.
              -->
              <span
                v-if="index > 0"
                class="rows__grip"
                @pointerdown.prevent.stop="beginResize($event, index - 1)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="relation in shownRelations"
            :key="`${relation.name}-${relation.direction}`"
          >
            <td class="rows__lead">
              <span class="rows__name">
                {{ relation.name }}
                <!--
                  Which way the key points is a property of the relation, not a
                  column of its own: it was a whole column carrying one of two
                  words, next to a name that had nowhere to wrap.
                -->
                <span
                  class="chip"
                  :class="`chip--${relation.direction}`"
                >{{
                  $t(`structure.${relation.direction}`)
                }}</span>
              </span>
            </td>
            <td class="rows__code">
              {{ relation.columns.join(', ') }}
            </td>
            <td class="rows__code">
              {{ relation.referencedTable.name }}({{ relation.referencedColumns.join(', ') }})
            </td>
            <td class="rows__muted">
              {{ relation.onDelete ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>

      <table
        v-else-if="section === 'triggers'"
        class="rows"
        :style="tableStyle"
      >
        <colgroup>
          <col
            v-for="(column, index) in head"
            :key="column.key"
            :style="colStyle(index)"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, index) in head"
              :key="column.key"
            >
              <span v-if="column.label">{{ $t(column.label) }}</span>
              <span
                v-else
                class="sr-only"
              >{{ $t('structure.actions') }}</span>
              <!--
                On the *leading* edge of every header but the first, sizing the
                column to its left. A grip on the trailing edge is the same
                boundary and reads the same way, but half of it overhangs the
                next header — and a sticky header is its own stacking context,
                so the neighbour paints over the half of the grip that is on it
                and swallows every press aimed at the middle.
              -->
              <span
                v-if="index > 0"
                class="rows__grip"
                @pointerdown.prevent.stop="beginResize($event, index - 1)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="trigger in shownTriggers"
            :key="trigger.name"
          >
            <td class="rows__lead">
              <span class="rows__name">{{ trigger.name }}</span>
            </td>
            <td class="rows__muted">
              {{ trigger.timing }}
            </td>
            <td class="rows__muted">
              {{ trigger.event }}
            </td>
          </tr>
        </tbody>
      </table>

      <table
        v-else
        class="rows"
        :style="tableStyle"
      >
        <colgroup>
          <col
            v-for="(column, index) in head"
            :key="column.key"
            :style="colStyle(index)"
          >
        </colgroup>
        <thead>
          <tr>
            <th
              v-for="(column, index) in head"
              :key="column.key"
            >
              <span v-if="column.label">{{ $t(column.label) }}</span>
              <span
                v-else
                class="sr-only"
              >{{ $t('structure.actions') }}</span>
              <!--
                On the *leading* edge of every header but the first, sizing the
                column to its left. A grip on the trailing edge is the same
                boundary and reads the same way, but half of it overhangs the
                next header — and a sticky header is its own stacking context,
                so the neighbour paints over the half of the grip that is on it
                and swallows every press aimed at the middle.
              -->
              <span
                v-if="index > 0"
                class="rows__grip"
                @pointerdown.prevent.stop="beginResize($event, index - 1)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="partition in shownPartitions"
            :key="partition.name"
          >
            <td class="rows__lead">
              <span class="rows__name">{{ partition.name }}</span>
            </td>
            <td class="rows__code">
              {{ partition.expression ?? '—' }}
            </td>
          </tr>
        </tbody>
      </table>

      <p
        v-if="isEmpty"
        class="structure__note"
      >
        {{ isFiltered ? $t('structure.noMatch') : $t('structure.nothingHere') }}
      </p>
    </div>

    <Sheet
      v-model="adding"
      :title="$t('structure.addColumn')"
    >
      <div class="fields">
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
      <div class="fields">
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
  </div>
</template>

<style scoped>
/*
 * Fills whatever it is put in. As a tab's only child that was automatic; inside
 * the Properties popup it is a flex item, where the default is to be sized by
 * its own content — which left the section switcher and the table bunched
 * against the left edge of a pane twice their width.
 */
.structure {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

/*
 * No material here.
 *
 * The bar wore `mat-thin`, which put a `backdrop-filter` on a strip sitting
 * inside a sheet — and an ancestor carrying a backdrop filter is the backdrop
 * root for everything in it, so this was blurring the sheet's own flat fill.
 * A compositing pass a frame, for a grey rectangle. A tonal fill states the
 * same thing and costs nothing.
 */
.structure__head {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap-tight) var(--gap);
  border-bottom: 1px solid var(--separator);
  background: var(--fill-4);
}

.structure__spacer {
  flex: 1;
}

.structure__find {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  width: 9rem;
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  background: var(--fill-3);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.structure__find:focus-within {
  background-image: linear-gradient(var(--focus-fill), var(--focus-fill));
  color: var(--color-base-content);
}

.structure__find-input {
  min-width: 0;
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--color-base-content);
  font-size: 0.75rem;
}

.structure__find-input::-webkit-search-cancel-button {
  appearance: none;
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

/*
 * `rows`, not `grid`.
 *
 * Tailwind ships `.grid { display: grid }`, and a scoped rule that sets width
 * and `table-layout` but never `display` does not outrank it — so this table
 * was a grid container. Its head and body were blockified into two *separate*
 * anonymous tables, each sizing its own columns from its own content, which is
 * why the header sat at two thirds of the width of the rows beneath it. Taking
 * a framework's class name is the whole of that bug.
 */
.rows {
  display: table;
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.rows th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0 var(--gap);
  height: calc(var(--row-h) * 1.15);
  text-align: start;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  /* Opaque, because it is a header that scrolling content passes under. A
     translucent one over moving rows is unreadable exactly when it matters. */
  background: var(--color-base-200);
  border-bottom: 1px solid var(--separator);
}

.rows th:first-child,
.rows td:first-child {
  padding-inline-start: var(--gap-loose);
}

.rows th:last-child,
.rows td:last-child {
  padding-inline-end: var(--gap-loose);
}

.rows td {
  padding: var(--gap-hair) var(--gap);
  height: calc(var(--row-h) * 1.15);
  border-bottom: 1px solid var(--separator);
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Wrapped, everything is shown and the row is as tall as it needs to be. The
 * height on a cell is a *minimum*, so the rows that fit on one line are exactly
 * where they were and only the long ones grow — and `anywhere` rather than
 * `break-word`, because the values that overflow here are identifiers with no
 * spaces to break at.
 */
.structure--wrap .rows td,
.structure--wrap .rows__note {
  overflow: visible;
  white-space: normal;
  overflow-wrap: anywhere;
}

/*
 * The grip: a hit area wider than the line it draws, because a two-pixel target
 * is a target you hunt for. It sits on the boundary rather than beside it.
 */
.rows__grip {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--gap) / -2);
  width: var(--gap);
  cursor: col-resize;
  touch-action: none;
}

.rows__grip::after {
  content: '';
  position: absolute;
  top: 20%;
  bottom: 20%;
  left: 50%;
  width: 1px;
  background: color-mix(in oklab, var(--color-base-content) 18%, transparent);
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .rows__grip:hover::after {
    background: var(--color-primary);
    width: 2px;
  }
}

/* While a column is moving, the pointer is a resize everywhere — not only over
   the two-pixel line it started on. */
.structure--resizing,
.structure--resizing * {
  cursor: col-resize !important;
  user-select: none;
}

.rows tbody tr:hover {
  background: color-mix(in oklab, var(--color-primary) 7%, transparent);
}

/* The one cell allowed two lines: a name and, under it, what it is for. */
.rows__lead {
  white-space: normal;
}

.rows__name {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-weight: 500;
  overflow: hidden;
}

.rows__note {
  display: block;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.6875rem;
  line-height: 1.3;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.rows__code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
}

.rows__muted {
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

.rows__actions {
  text-align: end;
}

.rows__drop {
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
  .rows tbody tr:hover .rows__drop {
    opacity: 1;
  }

  .rows__drop:hover {
    background: var(--color-error);
    color: var(--color-error-content);
  }
}

.rows__drop:focus-visible {
  opacity: 1;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding-block: var(--gap);
}

/*
 * A chip is a label, not a control: the same tonal fill every quiet surface in
 * the app wears, rather than a percentage of the text colour picked by hand
 * here — which is what made these read differently on the dark theme, where the
 * text colour is near-white and a "10% tint" is 10% white.
 */
.chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  background-color: var(--fill-3);
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
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

/* A constraint, not a category: the same tonal chip, at the text weight the
   rest of the row uses, so it reads as a fact about the column. */
.chip--strict {
  color: var(--color-base-content);
}

.chip--incoming {
  background-color: color-mix(in oklab, var(--color-primary) 10%, transparent);
}
</style>
