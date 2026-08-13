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
import type { SQLNamespace } from '@codemirror/lang-sql';
import type { Field, ResultSet, Row } from '@drivers/types';
import { explainStatement, parsePlan, type PlanNode } from '@shared/explain';
import { RpcCancelled } from '@shared/rpc';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useQueries } from '../../stores/queries';
import DataGrid from '../grid/DataGrid.vue';
import SqlEditor from '../editor/SqlEditor.vue';
import ExplainTree from '../viz/ExplainTree.vue';
import PressButton from '../ui/PressButton.vue';
import ResizeHandle from '../ui/ResizeHandle.vue';
import FormField from '../ui/FormField.vue';
import Sheet from '../ui/Sheet.vue';
import TextInput from '../ui/TextInput.vue';

const props = defineProps<{ tabId: string; active: boolean }>();
const text = defineModel<string>('text', { required: true });

const connections = useConnections();
const entities = useEntities();
const queries = useQueries();

const MAX_ROWS = 50_000;

const editor = ref<InstanceType<typeof SqlEditor>>();
const grid = ref<InstanceType<typeof DataGrid>>();

const editorHeight = ref(240);
const running = ref(false);
const error = ref<string | null>(null);
const results = ref<ResultSet[]>([]);
const selectedResult = ref(0);
const currentStatement = ref<{ text: string; from: number; to: number } | null>(null);
const transactionOpen = ref(false);
const plan = ref<PlanNode | null>(null);
const explaining = ref(false);
const manualCommit = ref(false);

let controller: AbortController | null = null;

const capabilities = computed(() => connections.active?.capabilities);
const language = computed(() => capabilities.value?.queryLanguage ?? 'sql');
const activeResult = computed(() => results.value[selectedResult.value]);

/** Completions come from the schema the sidebar already loaded. */
const schema = computed<SQLNamespace>(() => {
  const namespace: Record<string, string[]> = {};
  for (const entity of entities.entities) {
    const columns = entities.columns.get(
      entity.schema ? `${entity.schema}.${entity.name}` : entity.name
    );
    namespace[entity.name] = (columns ?? []).map((column) => column.name);
  }
  return namespace;
});

function connectionId(): string {
  const id = connections.active?.id;
  if (!id) throw new Error('No open connection');
  return id;
}

async function execute(source: string): Promise<void> {
  const statement = source.trim();
  if (!statement || running.value) return;

  controller = new AbortController();
  running.value = true;
  error.value = null;
  plan.value = null;

  try {
    const sets = await host.call(
      'query/run',
      {
        connectionId: connectionId(),
        text: statement,
        options: { maxRows: MAX_ROWS, ...(manualCommit.value ? { tabId: props.tabId } : {}) },
      },
      controller.signal
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

    error.value = caught instanceof Error ? caught.message : String(caught);
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
    const sets = await host.call('query/run', {
      connectionId: connectionId(),
      text: explainStatement(engine, statement),
      options: { maxRows: 1000 },
    });

    const rows = (sets[0]?.rows ?? []) as unknown as Record<string, unknown>[];
    const parsed = parsePlan(engine, rows);

    if (!parsed) {
      error.value = 'This engine returned a plan Shelf could not read.';
      return;
    }

    plan.value = parsed;
    results.value = [];
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
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
  await host.call('txn/begin', { connectionId: connectionId(), tabId: props.tabId });
  transactionOpen.value = true;
}

async function finishTransaction(action: 'commit' | 'rollback'): Promise<void> {
  await host.call(action === 'commit' ? 'txn/commit' : 'txn/rollback', {
    connectionId: connectionId(),
    tabId: props.tabId,
  });
  transactionOpen.value = false;
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
  if (set.truncated) parts.push(`showing first ${MAX_ROWS.toLocaleString()}`);
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
    <div class="toolbar">
      <PressButton
        v-if="!running"
        variant="primary"
        size="sm"
        :disabled="!text.trim()"
        @click="runAll"
      >
        {{ $t('action.run') }}
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
        :disabled="running || !currentStatement"
        :title="currentStatement?.text"
        @click="runCurrent"
      >
        {{ $t('action.runCurrent') }}
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

      <span class="toolbar__spacer" />

      <template v-if="capabilities?.transactions">
        <CheckBox
          v-model="manualCommit"
          class="toolbar__toggle"
          :disabled="transactionOpen"
          :label="$t('query.manualCommit')"
        />

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
        class="results__note"
      >
        {{ $t('query.running') }}
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

    <Teleport
      v-if="active"
      to="#statusbar-slot"
      defer
    >
      <div class="tabstatus">
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

.toolbar__toggle {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
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

.editor-pane {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
}

.results {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent);
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
