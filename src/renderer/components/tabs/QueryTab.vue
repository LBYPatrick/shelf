<script setup lang="ts">
/**
 * The query tab: an editor above its results, on a draggable split.
 *
 * Running is cancellable for real — the abort reaches the database and stops
 * the query there, rather than abandoning a promise while the server carries on
 * working.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { format } from 'sql-formatter';
import { useTranslation } from 'i18next-vue';
import type { CellValue, Field, ResultSet, Row } from '@drivers/types';
import type { Statement } from '@shared/sqlText';
import { explainStatement, parsePlan, type PlanNode } from '@shared/explain';
import { RpcCancelled } from '@shared/rpc';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useQueries } from '../../stores/queries';
import { useSettings } from '../../stores/settings';
import { useActivity } from '../../stores/activity';
import DataGrid from '../grid/DataGrid.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import RowIndexToggle from '../grid/RowIndexToggle.vue';
import SqlEditor, { type SchemaMap } from '../editor/SqlEditor.vue';
import ExplainTree from '../viz/ExplainTree.vue';
import PressButton from '../ui/PressButton.vue';
import ProgressBar from '../ui/ProgressBar.vue';
import ResizeHandle from '../ui/ResizeHandle.vue';
import FormField from '../ui/FormField.vue';
import Sheet from '../ui/Sheet.vue';
import TextInput from '../ui/TextInput.vue';
import { errorMessage } from '@shared/errors';

const props = defineProps<{ tabId: string; active: boolean }>();
const text = defineModel<string>('text', { required: true });

const connections = useConnections();
const entities = useEntities();
const queries = useQueries();
const settings = useSettings();
const activity = useActivity();
const { t } = useTranslation();

/** Read live, so the preference applies to the next run rather than the next tab. */
const maxRows = computed(() => settings.values.maxRows);

const editor = ref<InstanceType<typeof SqlEditor>>();

/** Mirrors the editor's own line/column readout into the status bar. */
const editorStats = computed(
  () => editor.value?.stats ?? { lines: 1, line: 1, column: 1, selected: 0 }
);
const grid = ref<InstanceType<typeof DataGrid>>();

const editorHeight = ref(240);
const running = ref(false);
const error = ref<string | null>(null);
const results = ref<ResultSet[]>([]);
const selectedResult = ref(0);
const currentStatement = ref<Statement | null>(null);
const transactionOpen = ref(false);
const plan = ref<PlanNode | null>(null);
const explaining = ref(false);
const manualCommit = ref(false);

let controller: AbortController | null = null;

const capabilities = computed(() => connections.active?.capabilities);
const language = computed(() => capabilities.value?.queryLanguage ?? 'sql');
const activeResult = computed(() => results.value[selectedResult.value]);

/** Completions come from the schema the sidebar already loaded. */
const schema = computed<SchemaMap>(() => {
  const namespace: Record<string, string[]> = {};
  for (const entity of entities.entities) {
    const columns = entities.columns.get(
      entity.schema ? `${entity.schema}.${entity.name}` : entity.name
    );
    namespace[entity.name] = (columns ?? []).map((column) => column.name);
  }
  return namespace;
});

async function execute(source: string): Promise<void> {
  const statement = source.trim();
  if (!statement || running.value) return;

  // Remembered so an export can re-run exactly what produced what is on screen,
  // rather than whatever has been typed since.
  lastRunText.value = statement;

  controller = new AbortController();
  running.value = true;
  error.value = null;
  plan.value = null;

  try {
    const sets = await activity.track(
      host.call(
        'query/run',
        {
          connectionId: connections.requireId(),
          text: statement,
          options: {
            maxRows: maxRows.value,
            ...(manualCommit.value ? { tabId: props.tabId } : {}),
          },
        },
        controller.signal
      )
    );

    results.value = [...sets];
    selectedResult.value = 0;

    const total = sets.reduce((sum, set) => sum + set.rowCount, 0);
    const elapsed = sets.reduce((sum, set) => sum + set.durationMs, 0);
    void queries.record({
      text: statement,
      rowCount: total,
      durationMs: elapsed,
      succeeded: true,
    });

    await nextTick();
    grid.value?.redraw();
  } catch (caught) {
    // A cancel is something the user asked for, not a failure to report.
    if (caught instanceof RpcCancelled) return;

    error.value = errorMessage(caught);
    results.value = [];

    // Failures are recorded too: a statement that errored is exactly the one
    // you want to find again and fix.
    void queries.record({
      text: statement,
      rowCount: null,
      durationMs: null,
      succeeded: false,
    });
  } finally {
    running.value = false;
    controller = null;
  }
}

function runAll(): void {
  const selected = editor.value?.selection() ?? '';
  void execute(selected || text.value);
}

function runCurrent(): void {
  void execute(currentStatement.value?.text ?? '');
}

/*
 * Which of the two ⌘↩ and the filled button perform is a preference, because
 * which one is "the" run action genuinely differs by habit: people who keep one
 * statement in the tab want the whole buffer, and people who keep a scratchpad
 * of twenty want the one under the cursor. The other is always still there,
 * quiet, beside it.
 */
const runsCurrentFirst = computed(() => settings.values.primaryRun === 'current');

const primaryRun = computed(() =>
  runsCurrentFirst.value
    ? { label: t('action.runCurrent'), run: runCurrent, ready: !!currentStatement.value }
    : { label: t('action.run'), run: runAll, ready: text.value.trim().length > 0 }
);

const secondaryRun = computed(() =>
  runsCurrentFirst.value
    ? { label: t('action.run'), run: runAll, ready: text.value.trim().length > 0 }
    : { label: t('action.runCurrent'), run: runCurrent, ready: !!currentStatement.value }
);

function cancel(): void {
  controller?.abort();
}

/**
 * Asks the engine how it would run the statement.
 *
 * The plan replaces the result grid rather than opening beside it: you are
 * looking at one thing or the other, and splitting the space would shrink both.
 */
async function explain(): Promise<void> {
  const statement = (currentStatement.value?.text ?? text.value).trim();
  const engine = connections.active?.engine;
  if (!statement || !engine) return;

  explaining.value = true;
  error.value = null;

  try {
    const sets = await activity.track(
      host.call('query/run', {
        connectionId: connections.requireId(),
        text: explainStatement(engine, statement),
        options: { maxRows: 1000 },
      })
    );

    const rows = (sets[0]?.rows ?? []) as unknown as Record<string, unknown>[];
    const parsed = parsePlan(engine, rows);

    if (!parsed) {
      error.value = 'This engine returned a plan Shelf could not read.';
      return;
    }

    plan.value = parsed;
    results.value = [];
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    explaining.value = false;
  }
}

function formatQuery(): void {
  try {
    text.value = format(text.value, {
      language: language.value === 'cql' ? 'sql' : 'sql',
      keywordCase: 'upper',
      tabWidth: 2,
    });
  } catch {
    // A statement the formatter cannot parse is left exactly as written; losing
    // someone's query to a formatting error would be far worse than not
    // formatting it.
  }
}

const savedName = ref('');
const saving = ref(false);

/** Saving asks for a name once, then updates that query from then on. */
async function saveQuery(): Promise<void> {
  const text_ = text.value.trim();
  if (!text_) return;

  if (!savedId.value) {
    saving.value = true;
    return;
  }

  await queries.save(savedName.value || 'Untitled', text_, savedId.value);
}

const savedId = ref<string | undefined>(undefined);

async function confirmSave(): Promise<void> {
  const stored = await queries.save(savedName.value.trim() || 'Untitled', text.value.trim());
  savedId.value = stored.id;
  saving.value = false;
}

async function beginTransaction(): Promise<void> {
  await host.call('txn/begin', { connectionId: connections.requireId(), tabId: props.tabId });
  transactionOpen.value = true;
}

async function finishTransaction(action: 'commit' | 'rollback'): Promise<void> {
  await host.call(action === 'commit' ? 'txn/commit' : 'txn/rollback', {
    connectionId: connections.requireId(),
    tabId: props.tabId,
  });
  transactionOpen.value = false;
}

const exporting = ref(false);
const lastRunText = ref('');

/**
 * Writing a file re-runs the statement in the host so it streams to disk in
 * full — the interface only ever holds the first page, and an export that
 * silently stopped there would be worse than no export.
 */
async function writeResultsToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql'
): Promise<void> {
  await host.call('export/run', {
    connectionId: connections.requireId(),
    path,
    format,
    query: lastRunText.value,
  });
}

const rows = computed<readonly Row[]>(() => activeResult.value?.rows ?? []);
const fields = computed<readonly Field[]>(() => activeResult.value?.fields ?? []);

const summary = computed(() => {
  const set = activeResult.value;
  if (!set) return '';

  const parts: string[] = [];
  if (set.rows.length > 0 || set.rowCount > 0) {
    parts.push(`${set.rowCount.toLocaleString()} ${set.rowCount === 1 ? 'row' : 'rows'}`);
  }
  if (set.affectedRows !== undefined) parts.push(`${set.affectedRows} affected`);
  if (set.truncated) parts.push(`showing first ${maxRows.value.toLocaleString()}`);
  parts.push(`${Math.round(set.durationMs)} ms`);
  return parts.join(' · ');
});

onMounted(() => {
  if (props.active) editor.value?.focus();
});

watch(
  () => props.active,
  (isActive) => {
    if (isActive) void nextTick(() => grid.value?.redraw());
  }
);
</script>

<template>
  <div class="query">
    <div
      class="editor-pane"
      :style="{ height: `${editorHeight}px` }"
    >
      <SqlEditor
        ref="editor"
        v-model="text"
        :schema="schema"
        @run="runAll"
        @run-current="runCurrent"
        @statement-change="currentStatement = $event"
      />
    </div>

    <ResizeHandle
      v-model:size="editorHeight"
      orientation="horizontal"
      :min="80"
      :max="700"
      aria-label="Resize editor"
    />

    <div class="toolbar">
      <PressButton
        v-if="!running"
        variant="primary"
        size="sm"
        :disabled="!primaryRun.ready"
        @click="primaryRun.run"
      >
        {{ primaryRun.label }}
        <kbd class="key">⌘↩</kbd>
      </PressButton>
      <PressButton
        v-else
        variant="danger"
        size="sm"
        @click="cancel"
      >
        {{ $t('action.cancel') }}
      </PressButton>

      <!--
        Running is the one action in this bar that commits, so it is the only
        one that is filled. The rest are quiet until reached for.
      -->
      <button
        type="button"
        class="toolbar__action focus-fill"
        :disabled="running || !secondaryRun.ready"
        :title="currentStatement?.text"
        @click="secondaryRun.run"
      >
        {{ secondaryRun.label }}
      </button>

      <button
        type="button"
        class="toolbar__action focus-fill"
        :disabled="!text.trim()"
        @click="formatQuery"
      >
        {{ $t('action.format') }}
      </button>

      <button
        v-if="capabilities?.sql"
        type="button"
        class="toolbar__action focus-fill"
        :disabled="!text.trim() || explaining"
        :title="$t('query.explainHint')"
        @click="explain"
      >
        {{ explaining ? $t('query.planning') : $t('action.explain') }}
      </button>

      <button
        type="button"
        class="toolbar__action focus-fill"
        :disabled="!text.trim()"
        :title="$t('query.saveHint')"
        @click="saveQuery"
      >
        {{ savedId ? $t('action.update') : $t('action.save') }}
      </button>

      <!--
        Everything to the left acts on the query; everything from here acts on
        what it returned. They were one undifferentiated row of six words, which
        gave no clue that half of them do nothing until a result exists.
      -->
      <span class="toolbar__rule" />

      <RowIndexToggle />

      <button
        type="button"
        class="toolbar__action focus-fill"
        :disabled="!rows.length"
        @click="exporting = true"
      >
        {{ $t('action.export') }}
      </button>

      <span class="toolbar__rule" />

      <template v-if="capabilities?.transactions">
        <!--
          A mode, not a form field. The bar's own language already has a shape
          for "switched on" — a tonal surface that stays for as long as it is in
          force — and a checkbox dropped into a row of buttons read as a stray
          piece of a settings pane.
        -->
        <button
          type="button"
          class="toolbar__mode focus-fill"
          :class="{ 'toolbar__mode--on': manualCommit }"
          :disabled="transactionOpen"
          :aria-pressed="manualCommit"
          @click="manualCommit = !manualCommit"
        >
          {{ $t('query.manualCommit') }}
        </button>

        <template v-if="manualCommit">
          <span
            v-if="transactionOpen"
            class="toolbar__txn"
            role="status"
          >{{
            $t('query.transactionOpen')
          }}</span>
          <PressButton
            v-if="!transactionOpen"
            size="sm"
            @click="beginTransaction"
          >
            {{ $t('query.begin') }}
          </PressButton>
          <template v-else>
            <PressButton
              size="sm"
              @click="finishTransaction('rollback')"
            >
              {{ $t('query.rollback') }}
            </PressButton>
            <PressButton
              size="sm"
              variant="primary"
              @click="finishTransaction('commit')"
            >
              {{ $t('query.commit') }}
            </PressButton>
          </template>
        </template>
      </template>
    </div>

    <div class="results">
      <div
        v-if="results.length > 1"
        class="results__tabs"
      >
        <button
          v-for="(set, index) in results"
          :key="index"
          class="results__tab"
          :class="{ 'results__tab--on': index === selectedResult }"
          @click="selectedResult = index"
        >
          Result {{ index + 1 }}
          <span class="results__count">{{ set.rowCount }}</span>
        </button>
      </div>

      <p
        v-if="error"
        class="results__error"
        role="alert"
      >
        {{ error }}
      </p>

      <div
        v-else-if="running"
        class="results__running"
      >
        <ProgressBar />
        <p class="results__note">
          {{ $t('query.running') }}
        </p>
      </div>

      <ExplainTree
        v-else-if="plan"
        :plan="plan"
      />

      <div
        v-else-if="results.length === 0"
        class="results__note"
      >
        <span>{{ $t('query.writeAndPress') }}</span>
        <kbd class="key">⌘↩</kbd>
      </div>

      <p
        v-else-if="fields.length === 0"
        class="results__note"
      >
        {{ summary || $t('query.completed') }}
      </p>

      <DataGrid
        v-else
        ref="grid"
        :fields="fields"
        :rows="rows"
        :loading="running"
      />
    </div>

    <Sheet
      v-model="saving"
      :title="$t('query.saveTitle')"
    >
      <FormField
        v-slot="{ id }"
        :label="$t('connection.name')"
        :help="$t('query.saveNameHelp')"
      >
        <TextInput
          :id="id"
          v-model="savedName"
          placeholder="Monthly revenue"
          @keydown.enter="confirmSave"
        />
      </FormField>

      <template #footer>
        <PressButton @click="saving = false">
          {{ $t('action.cancel') }}
        </PressButton>
        <PressButton
          variant="primary"
          :disabled="!savedName.trim()"
          @click="confirmSave"
        >
          {{ $t('action.save') }}
        </PressButton>
      </template>
    </Sheet>

    <ExportSheet
      v-model="exporting"
      :fields="fields"
      :rows="rows as readonly Record<string, CellValue>[]"
      :name="savedName.trim() || 'query-results'"
      :write-file="lastRunText ? writeResultsToFile : undefined"
    />

    <Teleport
      v-if="active"
      to="#statusbar-slot"
      defer
    >
      <div class="tabstatus">
        <!--
          Where the caret is and how long the query is. An engine that reports
          an error "near line 14" is useless without the first, and the line
          count is the cheapest possible answer to "is this the short one".
        -->
        <span class="tabstatus__item">{{
          $t('query.caret', {
            line: editorStats.line,
            column: editorStats.column,
            lines: editorStats.lines,
          })
        }}</span>
        <span
          v-if="editorStats.selected > 0"
          class="tabstatus__item"
        >{{
          $t('query.selected', { count: editorStats.selected })
        }}</span>

        <select
          v-if="results.length > 1"
          v-model.number="selectedResult"
          class="tabstatus__select"
          :aria-label="$t('query.result', { index: selectedResult + 1 })"
        >
          <option
            v-for="(set, index) in results"
            :key="index"
            :value="index"
          >
            Result {{ index + 1 }}: {{ set.rowCount }} rows
          </option>
        </select>
        <span
          v-if="summary"
          class="tabstatus__item"
        >{{ summary }}</span>
        <span
          v-if="transactionOpen"
          class="tabstatus__txn"
        >{{
          $t('query.transactionOpen')
        }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/*
 * Hairlines on both edges rather than a fill: a band that is a *different
 * colour* from the panes either side would be a fourth shade in a stack that
 * already has three, and the job here is to mark a boundary, not to add a
 * surface.
 */
.query > .toolbar {
  flex: 0 0 auto;
  border-block: 1px solid var(--separator);
}

/*
 * An open transaction is stated calmly and permanently rather than shouted:
 * it is a mode you are in, not an error, and a red banner would train people to
 * ignore it.
 */
.toolbar__txn {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding-inline: var(--gap);
  height: calc(var(--field-h) * 0.9);
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 22%, transparent);
  font-size: 0.6875rem;
}

/*
 * The pane stack, in one order.
 *
 * Reading down: the tab strip is the most recessed chrome, the editor is a
 * shallower well because it is something you type into, the control bar is on
 * the working surface with a hairline either side so it reads as the divider it
 * now is, and the results are the working surface itself.
 *
 * The bar sits *between* the two panes rather than above both. It was at the
 * top, which put "Run" as far from the results it produces as the layout
 * allowed and left the split between editor and grid unmarked.
 */
.editor-pane {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
  background-color: var(--fill-4);
}

/* The bar above it is the divider now, so the results need no line of their own. */
.results {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.results__tabs {
  display: flex;
  gap: var(--gap-hair);
  padding: var(--gap-tight) var(--gap) 0;
}

.results__tab {
  padding: var(--gap-hair) var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
}

.results__tab--on {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.results__count {
  opacity: 0.6;
}

.results__error {
  padding: var(--gap) var(--gap-loose);
  margin: var(--gap);
  border-radius: var(--radius-field);
  background: color-mix(in oklab, var(--color-error) 15%, transparent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
}

/* The word alone did not read as motion; the bar above it does. */
.results__running {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.results__note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  height: 100%;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.key {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in oklab, currentColor 18%, transparent);
  color: inherit;
  font-family: var(--font-ui);
  font-size: 0.625rem;
  line-height: 1.4;
}

.tabstatus__select {
  height: 1.25rem;
  border-radius: var(--radius-field);
  background: transparent;
  color: inherit;
  font-size: 0.6875rem;
}

.tabstatus__txn {
  padding-inline: var(--gap);
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.625rem;
}
</style>
