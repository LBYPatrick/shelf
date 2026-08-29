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
import { UNLIMITED } from '@shared/rowLimit';
import { formatterDialect, type Statement } from '@shared/sqlText';
import { explainStatement, parsePlan, type PlanNode } from '@shared/explain';
import { RpcCancelled } from '@shared/rpc';
import { exportName as buildExportName } from '@shared/fileNames';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useQueries } from '../../stores/queries';
import { rowLimitOptions, useSettings } from '../../stores/settings';
import { useActivity } from '../../stores/activity';
import { useToasts } from '../../stores/toasts';
import { defaultJobName, useJobs } from '../../stores/jobs';
import { useTabs } from '../../stores/tabs';
import { shortcutLabel } from '../../lib/keybindings';
import DataGrid from '../grid/DataGrid.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import RowIndexToggle from '../grid/RowIndexToggle.vue';
import SqlEditor, { type SchemaMap } from '../editor/SqlEditor.vue';
import PressButton from '../ui/PressButton.vue';
import ProgressBar from '../ui/ProgressBar.vue';
import ResizeHandle from '../ui/ResizeHandle.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import ToggleSwitch from '../ui/ToggleSwitch.vue';
import CircuitRing from '../ui/CircuitRing.vue';
import AppIcon from '../ui/AppIcon.vue';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';
import GridSkeleton from '../ui/GridSkeleton.vue';
import PlanSheet from '../viz/PlanSheet.vue';
import NameSheet from '../ui/NameSheet.vue';
import { elapsedLabel, useElapsed } from '../../composables/useElapsed';
import { errorMessage } from '@shared/errors';

const props = defineProps<{ tabId: string; active: boolean }>();
const text = defineModel<string>('text', { required: true });

const connections = useConnections();
const entities = useEntities();
const queries = useQueries();
const settings = useSettings();
const activity = useActivity();
const toasts = useToasts();
const jobs = useJobs();
const tabs = useTabs();
const { t } = useTranslation();

/** Read live, so the preference applies to the next run rather than the next tab. */
const maxRows = computed(() => settings.values.maxRows);

/**
 * The limit, as a choice rather than a number to type.
 *
 * Bound to the stored preference rather than to the tab, because "how many rows
 * do I want to look at" is a habit and not a property of one query — and it
 * keeps this control and the one in Settings from ever disagreeing. A value
 * saved before the list existed is offered alongside the list rather than
 * silently replaced.
 */
const rowLimits = computed(() => rowLimitOptions(maxRows.value, t));

const rowLimit = computed<string>({
  get: () => String(maxRows.value),
  set: (value) => (settings.values.maxRows = Number(value)),
});

const editor = ref<InstanceType<typeof SqlEditor>>();

/** Mirrors the editor's own line/column readout into the status bar. */
const editorStats = computed(
  () => editor.value?.stats ?? { lines: 1, line: 1, column: 1, selected: 0 }
);
const grid = ref<InstanceType<typeof DataGrid>>();

/**
 * The split, as a share of the tab rather than a number of pixels.
 *
 * It was a flat 240, which is a third of a tall window and most of a short one,
 * and it left the editor smaller than the empty results pane below it on every
 * screen this is actually used on. Writing is the part of a query tab that
 * takes room — the results have a pager and a scrollbar and the editor has
 * neither — so it opens at seven tenths and the handle is there for anyone who
 * disagrees. Measured once, on mount: after that the reader owns it.
 */
const EDITOR_SHARE = 0.7;

const split = ref<HTMLElement>();
const editorHeight = ref(240);

/* Always leaves room for the toolbar and a row or two of results. */
const maxEditorHeight = ref(700);

onMounted(() => {
  const height = split.value?.clientHeight ?? 0;
  if (height <= 0) return;
  maxEditorHeight.value = Math.max(120, height - 160);
  editorHeight.value = Math.min(maxEditorHeight.value, Math.round(height * EDITOR_SHARE));
});
const running = ref(false);
const error = ref<string | null>(null);
const results = ref<ResultSet[]>([]);
const selectedResult = ref(0);
const currentStatement = ref<Statement | null>(null);
const transactionOpen = ref(false);
const plan = ref<PlanNode | null>(null);
/** The plan opens in front of the results rather than in place of them. */
const planOpen = ref(false);
const explaining = ref(false);
/**
 * Writes commit as they run unless this is switched off.
 *
 * Held as the positive, because that is the state it is in: a flag called
 * `manualCommit` that is false by default made every read of it a double
 * negative, and the control above it inherited the same problem.
 */
const autoCommit = ref(true);
const manualCommit = computed(() => !autoCommit.value);

/** Counts up for as long as the statement is out; see `useElapsed`. */
const elapsed = useElapsed(running);

let controller: AbortController | null = null;

const capabilities = computed(() => connections.active?.capabilities);
const activeResult = computed(() => results.value[selectedResult.value]);

/*
 * The result picker, as the app's own list rather than the engine's.
 *
 * `SelectMenu` is keyed by string because that is what an option's value is in
 * HTML and what every other list in the app carries; the index is a number
 * here, so the two meet in a writable computed rather than by making one of
 * them pretend to be the other.
 */
const resultOptions = computed(() =>
  results.value.map((set, index) => ({
    value: String(index),
    label: t('query.resultRows', { index: index + 1, count: set.rowCount }),
  }))
);

const selectedResultValue = computed({
  get: () => String(selectedResult.value),
  set: (value: string) => {
    selectedResult.value = Number(value);
  },
});

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

/* ------------------------------------------------------------------ dispatch */

/**
 * Sends the statement off to run on its own.
 *
 * The tab is released the moment it starts: no limit is applied, the whole
 * answer is spooled to this machine by the host, and the toast that follows is
 * the only thing that has to reach you. That is the entire distinction from a
 * run — a run is something you wait for, a dispatch is something you start.
 */
const dispatching = ref(false);
const jobName = ref('');

/**
 * Dispatching asks for a name too, and for the same reason saving does.
 *
 * A job outlives the tab that started it — it is a row in a list that is still
 * there tomorrow — and `<database>-20260828-214500` says only when it ran. The
 * stamp is still the default, because it is a real name and never wrong, and
 * the reader can take it by pressing return.
 */
function dispatch(): void {
  const statement = (currentStatement.value?.text ?? text.value).trim();
  if (!statement || !connections.active) return;

  jobName.value = defaultJobName(
    connections.active.database ?? connections.active.name ?? '',
    new Date()
  );
  dispatching.value = true;
}

function confirmDispatch(): void {
  dispatching.value = false;

  const statement = (currentStatement.value?.text ?? text.value).trim();
  const connectionId = connections.active?.id;
  if (!statement || !connectionId) return;

  const { job, finished } = jobs.dispatch({
    name: jobName.value.trim(),
    connectionId,
    database: connections.active?.database ?? connections.active?.name ?? '',
    sql: statement,
  });

  toasts.show({ tone: 'info', message: t('jobs.dispatched', { name: job.name }) });

  void finished.then((done) => {
    if (done.status === 'failed') {
      toasts.show({
        id: `job-${done.id}`,
        tone: 'error',
        title: done.name,
        message: done.error ?? '',
      });
      return;
    }

    toasts.show({
      id: `job-${done.id}`,
      tone: 'success',
      title: done.name,
      message: t('jobs.finished', { rows: done.rows.toLocaleString() }),
      action: { label: t('jobs.open'), run: () => tabs.openJob(done.id, done.name) },
    });
  });
}

/* ------------------------------------------------------------- the run control */

/**
 * One control, three scopes, and the menu is where the other two live.
 *
 * The face performs whichever the reader has chosen as primary; the chevron
 * beside it opens the rest with their shortcuts written out, which is also the
 * only place a second and third scope are *announced*. It is a real menu button
 * — `aria-haspopup`, `aria-expanded`, a focus that returns to the trigger — and
 * not a pair of buttons pretending to be one.
 */
const runButton = ref<HTMLElement>();
const runMenuOpen = ref(false);
const runMenuAt = ref({ x: 0, y: 0 });

function openRunMenu(): void {
  const box = runButton.value?.getBoundingClientRect();
  runMenuAt.value = box ? { x: box.left, y: box.bottom + 4 } : { x: 0, y: 0 };
  runMenuOpen.value = true;
}

const runMenuItems = computed<MenuItem[]>(() => [
  {
    id: 'all',
    label: `${t('action.run')}   ${shortcutLabel('query.run')}`,
    icon: 'play',
    disabled: !text.value.trim(),
  },
  {
    id: 'current',
    label: `${t('action.runCurrent')}   ${shortcutLabel('query.runCurrent')}`,
    icon: 'query',
    disabled: !currentStatement.value,
  },
  {
    id: 'dispatch',
    label: t('action.dispatch'),
    icon: 'jobs',
    disabled: !text.value.trim(),
    startsGroup: true,
  },
]);

function chooseRun(id: string): void {
  if (id === 'dispatch') {
    dispatch();
    return;
  }

  // Picking a scope also makes it the one ⌘↩ performs: a menu that only ran it
  // would leave the shortcut pointing somewhere else for ever.
  settings.values.primaryRun = id === 'current' ? 'current' : 'all';
  if (id === 'current') runCurrent();
  else runAll();
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
      error.value = t('query.planUnreadable');
      return;
    }

    plan.value = parsed;
    planOpen.value = true;
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    explaining.value = false;
  }
}

/**
 * Reformats the statement, in the dialect of the server it is written for.
 *
 * The text is left exactly as written when the formatter cannot parse it —
 * losing a query to a formatting error would be far worse than not formatting
 * it — but the failure is now *said*. It used to be swallowed whole, so a
 * Postgres cast or a JSON operator, neither of which the ANSI grammar accepts,
 * made the button do nothing at all with no way to find out why.
 */
function formatQuery(): void {
  const source = text.value;

  try {
    text.value = format(source, {
      language: formatterDialect(connections.active?.engine),
      keywordCase: 'upper',
      tabWidth: 2,
    });
  } catch (caught) {
    toasts.show({
      tone: 'warning',
      title: t('query.formatFailed'),
      message: errorMessage(caught),
    });
  }
}

const savedName = ref('');
const saving = ref(false);
const savedId = ref<string | undefined>(undefined);

/** Saving asks for a name once, then updates that query from then on. */
async function saveQuery(): Promise<void> {
  const text_ = text.value.trim();
  if (!text_) return;

  if (!savedId.value) {
    /*
     * The tab's own name, which is the one the reader has already chosen.
     *
     * It opened as "Query 3" and may still say that, but it is renameable and a
     * renamed tab is somebody having already answered this question — asking it
     * again with an empty box throws that answer away. Where it has not been
     * renamed the default is at worst harmless, and the button beside the field
     * is there for exactly that case.
     */
    savedName.value = tabs.byId(props.tabId)?.title ?? '';
    saving.value = true;
    return;
  }

  await queries.save(savedName.value || 'Untitled', text_, savedId.value);
}

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
 * Stamped when the sheet opens rather than computed from the clock on every
 * render — the name has to hold still while the save dialog is up, and two
 * exports taken a minute apart have to differ.
 */
const exportName = ref('');

watch(exporting, (open) => {
  if (open) {
    exportName.value = buildExportName(
      savedName.value.trim() || undefined,
      'query',
      new Date(),
      Math.random()
    );
  }
});

/**
 * Writing a file re-runs the statement in the host so it streams to disk in
 * full — the interface only ever holds the first page, and an export that
 * silently stopped there would be worse than no export.
 */
async function writeResultsToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql',
  scope: 'page' | 'full'
): Promise<void> {
  /*
   * The page is written from what is already here; the full set is another
   * execution, without the preview limit. Which of the two happened is a thing
   * the reader chose in the sheet rather than something inferred here — the
   * difference is minutes of the server's time, and on live data a different
   * answer.
   */
  await host.call('export/run', {
    connectionId: connections.requireId(),
    path,
    format,
    query: scope === 'full' ? lastRunText.value : limited(lastRunText.value),
  });
}

/**
 * The statement as it was actually run, limit and all.
 *
 * `query/run` applies the preview limit itself, so re-running the text alone
 * would fetch everything — which is exactly what "current page" means not to
 * do. Wrapping it is the one form that works whatever the statement already
 * says about ordering or its own limit.
 */
function limited(sql: string): string {
  // With no limit in force there is no such thing as "this page": what is on
  // screen is the whole result, and the statement that produced it is the
  // statement that reproduces it.
  if (maxRows.value >= UNLIMITED) return sql;

  const text = sql.trim().replace(/;$/, '');
  return `SELECT * FROM (\n${text}\n) AS shelf_page LIMIT ${maxRows.value}`;
}

const rows = computed<readonly Row[]>(() => activeResult.value?.rows ?? []);
const fields = computed<readonly Field[]>(() => activeResult.value?.fields ?? []);

const summary = computed(() => {
  const set = activeResult.value;
  if (!set) return '';

  const parts: string[] = [];
  if (set.rows.length > 0 || set.rowCount > 0) {
    /*
     * "First 10 rows", or "10 rows" — one statement, not two.
     *
     * It used to say both: a count, and then "showing first 10" beside it. That
     * read as a total and a window onto it, which is what it was while the
     * whole result came back and was cut here. Now the limit is in the
     * statement and the count *is* the window, so saying it twice put two
     * numbers side by side that could only ever agree — and while the server
     * was being asked for one row more than the ceiling, they disagreed.
     */
    const rows = set.rowCount.toLocaleString();
    const one = set.rowCount === 1;
    parts.push(
      set.truncated
        ? t(one ? 'query.summaryFirstOne' : 'query.summaryFirst', { rows })
        : t(one ? 'query.summaryRow' : 'query.summaryRows', { rows })
    );
  }
  if (set.affectedRows !== undefined) {
    parts.push(t('query.summaryAffected', { rows: set.affectedRows.toLocaleString() }));
  }
  parts.push(t('query.summaryMs', { ms: Math.round(set.durationMs) }));
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
  <div ref="split" class="query">
    <div class="editor-pane" :style="{ height: `${editorHeight}px` }">
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
      :max="maxEditorHeight"
      aria-label="Resize editor"
    />

    <!--
      Two named groups, and nothing in the bar that acts on the result.

      It was one undifferentiated row of eight words at one weight, divided by
      two hairlines: "Run · Run current · Format · Explain · Save | 0-based ·
      Export | Manual commit". Three of those act on the text above, two on the
      rows below and one on the connection, and nothing said so — a hairline
      only says "not those", never "these are the ones that…". So the two that
      act on the result have gone to sit with the result, where proximity says
      what they belong to, and the groups that remain are named where they
      stand. Loudness carries the rest: one filled control, the action ⌘↩
      performs, and everything else quiet until reached for.
    -->
    <div class="toolbar" role="toolbar" :aria-label="$t('query.groupStatement')">
      <div class="toolbar__group" role="group" :aria-label="$t('query.groupStatement')">
        <!--
          One control, three scopes. The face performs whichever ⌘↩ performs;
          the chevron opens the others — including Dispatch, which is where a
          statement goes when the answer matters more than the wait.
        -->
        <div
          v-if="!running"
          class="toolbar__pair"
          role="group"
          :aria-label="$t('query.runScope')"
        >
          <PressButton
            v-tip="`${primaryRun.label} — ${shortcutLabel('query.run')}`"
            variant="primary"
            size="sm"
            :disabled="!primaryRun.ready"
            @click="primaryRun.run"
          >
            <AppIcon name="play" :size="11" />
            {{ primaryRun.label }}
            <kbd class="key">⌘↩</kbd>
          </PressButton>
          <button
            ref="runButton"
            v-tip="$t('query.runScope')"
            type="button"
            class="toolbar__action toolbar__action--icon focus-fill query__scope"
            :disabled="!text.trim()"
            :aria-label="$t('query.runScope')"
            :aria-expanded="runMenuOpen"
            aria-haspopup="menu"
            @click="openRunMenu"
          >
            <AppIcon
              class="query__chevron"
              :class="{ 'query__chevron--open': runMenuOpen }"
              name="chevron"
              :size="10"
            />
          </button>
        </div>

        <!--
          The running state takes the same slot and the same shape as the pair
          it replaces: a readout where Run was, the action attached to it where
          Run current was. The clock had been a second label crammed inside the
          Cancel button, which put a number that changes twenty times a second
          inside the one control you are trying to hit — the button breathed,
          and the bar shifted with it.

          Split, each half does one job. The left is a live readout, tonal and
          sized once for its widest reading so nothing moves. The right is the
          only thing to press.
        -->
        <div
          v-else
          class="toolbar__pair query__pair"
          role="group"
          :aria-label="$t('query.running')"
        >
          <!--
            The control's own edge, lit and travelling. A query has no progress
            to report, so what is shown is not how far through it is but *which
            thing* is working — and the answer is this control, both halves of
            it: the clock counting and the button that stops what it counts.
          -->
          <CircuitRing />

          <span class="query__running">
            <span class="query__pulse" aria-hidden="true" />
            <span
              class="query__clock"
              role="timer"
              :aria-label="$t('query.elapsed', { time: elapsedLabel(elapsed) })"
              >{{ elapsedLabel(elapsed) }}</span
            >
          </span>
          <PressButton variant="danger" size="sm" @click="cancel">
            {{ $t('action.cancel') }}
          </PressButton>
        </div>

        <!--
          How many rows to bring back, chosen before the run rather than typed
          into Settings afterwards. It is a modifier on Run, so it stands beside
          it.
        -->
        <!--
          Disabled while a statement is out. It decides what the *next* run
          fetches, and a control that looks live while the thing it governs is
          already in flight is a control that lies about what it is doing.
        -->
        <div v-tip="$t('settings.maxRows')" class="query__limit">
          <SelectMenu
            v-model="rowLimit"
            :options="rowLimits"
            :disabled="running"
            :aria-label="$t('settings.maxRows')"
          />
        </div>

        <!--
          Only where there is a grammar to format against. The formatter parses
          SQL and nothing else, so offering it over a Mongo pipeline is offering
          a button that can only fail.
        -->
        <!--
          Icons on the verbs, and a name that says what is being saved. "Save"
          in a row that also writes files and exports rows is three different
          things; "Save Query" is one. The glyph is what makes the row scannable
          — at a glance you look for the shape, not the word.

          Grouped, because the row needs a rhythm rather than one flat gap
          everywhere: the verbs act on the text above and the two controls to
          their left act on the run, and spacing is what says so.
        -->
        <div class="query__verbs">
          <button
            v-if="capabilities?.sql"
            v-tip="$t('query.formatHint')"
            type="button"
            class="toolbar__action focus-fill"
            :disabled="!text.trim()"
            @click="formatQuery"
          >
            <AppIcon name="structure" :size="12" />
            {{ $t('action.format') }}
          </button>

          <button
            v-if="capabilities?.sql"
            v-tip="$t('query.explainHint')"
            type="button"
            class="toolbar__action focus-fill"
            :disabled="!text.trim() || explaining"
            @click="explain"
          >
            <AppIcon name="diagram" :size="12" />
            {{ explaining ? $t('query.planning') : $t('action.explain') }}
          </button>

          <button
            v-tip="$t('query.saveHint')"
            type="button"
            class="toolbar__action focus-fill"
            :disabled="!text.trim()"
            @click="saveQuery"
          >
            <AppIcon name="star" :size="12" />
            {{ savedId ? $t('action.update') : $t('action.saveQuery') }}
          </button>
        </div>
      </div>

      <span class="toolbar__spacer" />

      <!--
        Stated the way round it is actually true: writes commit as they run
        unless you say otherwise, so the control is "Auto commit" and it starts
        on. "Manual commit, off" was a double negative to be read backwards.

        A switch rather than a button, because it is a setting that takes effect
        the moment it moves and stays in force — which is precisely what the
        Cupertino shape means and what a press-button does not.

        Everything the switch enables appears to its *left*. The switch is the
        one thing always present, so anchoring it to the end means turning it
        off adds controls without moving the control you just touched — and the
        pointer is still over it if you want to turn it straight back on.
      -->
      <div
        v-if="capabilities?.transactions"
        class="toolbar__group"
        role="group"
        :aria-label="$t('query.groupTransaction')"
      >
        <template v-if="!autoCommit">
          <span v-if="transactionOpen" class="toolbar__txn" role="status">{{
            $t('query.transactionOpen')
          }}</span>

          <PressButton
            v-if="!transactionOpen"
            v-tip="$t('query.beginHint')"
            size="sm"
            @click="beginTransaction"
          >
            {{ $t('query.begin') }}
          </PressButton>
          <template v-else>
            <PressButton size="sm" @click="finishTransaction('rollback')">
              {{ $t('query.rollback') }}
            </PressButton>
            <PressButton size="sm" variant="primary" @click="finishTransaction('commit')">
              {{ $t('query.commit') }}
            </PressButton>
          </template>
        </template>

        <label v-tip="$t('query.autoCommitHint')" class="query__auto">
          <span>{{ $t('query.autoCommit') }}</span>
          <ToggleSwitch
            v-model="autoCommit"
            :disabled="transactionOpen"
            :aria-label="$t('query.autoCommit')"
          />
        </label>
      </div>
    </div>

    <div class="results">
      <!--
        The result's own bar, and the reason the one above it got shorter.
        Which row number a grid starts at and where its rows are exported to are
        properties of *this* result, and they were sitting five words away from
        "Format" — where they were also, for the whole of a query tab's empty
        life, two permanently disabled words with nothing to act on. Here they
        appear with the thing they act on and are absent until it exists.
      -->
      <div
        v-if="results.length > 0"
        class="toolbar results__bar"
        role="toolbar"
        :aria-label="$t('query.resultsBar')"
      >
        <div class="toolbar__group" role="group" :aria-label="$t('query.groupResult')">
          <template v-if="results.length > 1">
            <button
              v-for="(set, index) in results"
              :key="index"
              type="button"
              class="toolbar__mode focus-fill"
              :class="{ 'toolbar__mode--on': index === selectedResult }"
              :aria-pressed="index === selectedResult"
              @click="selectedResult = index"
            >
              {{ $t('query.result', { index: index + 1 }) }}
              <span class="toolbar__count">{{ set.rowCount }}</span>
            </button>
          </template>
          <span v-else-if="summary" class="results__summary">{{ summary }}</span>
        </div>

        <span class="toolbar__spacer" />

        <RowIndexToggle />

        <button
          type="button"
          class="toolbar__action focus-fill"
          :disabled="!rows.length"
          @click="exporting = true"
        >
          {{ $t('action.export') }}
        </button>
      </div>

      <p v-if="error" class="results__error" role="alert">
        {{ error }}
      </p>

      <div v-else-if="running" class="results__running">
        <ProgressBar />
        <!--
          The shape of what is coming, not the word "Running". A skeleton says
          rows, in columns, into this space — and it is replaced by something
          the same size, so the pane does not lurch when the answer lands.
        -->
        <GridSkeleton />
        <p class="results__note results__note--running">
          <span>{{ $t('query.running') }}</span>
          <!--
            `role="timer"` rather than a live region: it changes ten times a
            second, and a polite live region would queue every one of them for
            announcement. A timer is announced when asked for.
          -->
          <span
            class="results__clock"
            role="timer"
            :aria-label="$t('query.elapsed', { time: elapsedLabel(elapsed) })"
            >{{ elapsedLabel(elapsed) }}</span
          >
        </p>
      </div>

      <div v-else-if="results.length === 0" class="results__note">
        <span>{{ $t('query.writeAndPress') }}</span>
        <kbd class="key">⌘↩</kbd>
      </div>

      <p v-else-if="fields.length === 0" class="results__note">
        {{ summary || $t('query.completed') }}
      </p>

      <DataGrid v-else ref="grid" :fields="fields" :rows="rows" :loading="running" />
    </div>

    <NameSheet
      v-model="saving"
      v-model:name="savedName"
      :title="$t('query.saveTitle')"
      :label="$t('connection.name')"
      :help="$t('query.saveNameHelp')"
      :confirm="$t('action.save')"
      :sql="text"
      @confirm="confirmSave"
    />

    <NameSheet
      v-model="dispatching"
      v-model:name="jobName"
      :title="$t('jobs.nameTitle')"
      :label="$t('jobs.nameLabel')"
      :help="$t('jobs.nameHelp')"
      :confirm="$t('action.dispatch')"
      :sql="currentStatement?.text ?? text"
      @confirm="confirmDispatch"
    />

    <ContextMenu
      v-model="runMenuOpen"
      :items="runMenuItems"
      :at="runMenuAt"
      @choose="chooseRun"
    />

    <!--
      In front of the results, not instead of them: reading a plan and reading
      the rows it produced are two things you do about one statement, and making
      them the same slot meant one always cost the other.
    -->
    <PlanSheet v-model="planOpen" :plan="plan" />

    <ExportSheet
      v-model="exporting"
      :fields="fields"
      :rows="rows as readonly Record<string, CellValue>[]"
      :name="exportName"
      :write-file="lastRunText ? writeResultsToFile : undefined"
      :truncated="activeResult?.truncated === true"
    />

    <Teleport v-if="active" to="#statusbar-slot" defer>
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
        <span v-if="editorStats.selected > 0" class="tabstatus__item">{{
          $t('query.selected', { count: editorStats.selected })
        }}</span>

        <!--
          The app's own list. A native `<select>` gives its popup to the
          operating system to draw, and this one sat in the status bar where a
          system menu opening over the working pane is at its most obvious.
        -->
        <SelectMenu
          v-if="results.length > 1"
          v-model="selectedResultValue"
          class="tabstatus__select"
          :options="resultOptions"
          :aria-label="$t('query.result', { index: selectedResult + 1 })"
        />
        <span v-if="summary" class="tabstatus__item">{{ summary }}</span>
        <span v-if="transactionOpen" class="tabstatus__txn">{{
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
 * The pane stack, in one order.
 *
 * Reading down: the editor is a shallow well because it is something you type
 * into, the control bar is on the working surface with a hairline either side
 * so it reads as the divider it is, and the results are the working surface
 * itself. The editor is sized by the drag handle and the results take whatever
 * is left — which is what makes the grid measurable at all: given no height it
 * builds against a zero box and draws nothing.
 */
.editor-pane {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
  background-color: var(--surface-well);
}

/*
 * The switch and its name, as one target. A label wrapping the control means
 * the words are part of the thing you press, which is what makes a setting row
 * feel like a row rather than like a control with a caption near it.
 */
.query__auto {
  display: inline-flex;
  align-items: center;
  gap: var(--gap);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  cursor: pointer;
  white-space: nowrap;
}

/* The bar above it is the divider now, so the results need no line of their own. */
.results {
  display: flex;
  flex: 1;
  flex-direction: column;
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
  /* The row was as tight against the window's edge as its controls were against
     each other, which made the whole strip read as crowded. */
  padding-inline: var(--gap-loose);
  border-block: 1px solid var(--separator);
}

/*
 * An open transaction is stated calmly and permanently rather than shouted: it
 * is a mode you are in, not an error, and a red banner would train people to
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
 * The readout half of the running pair. Tonal rather than filled: it is not a
 * control, and a second filled surface beside the one real button would compete
 * with it.
 */
/* The ring is drawn on this box's outline, so it has to be the box the ring is
   positioned against. */
.query__pair {
  position: relative;
}

/*
 * The pair flattens the seam between its halves by position — first child, last
 * child — and the ring is an overlay that now sits in front of the first of
 * them. It has no surface of its own, so it takes the flattening harmlessly and
 * the readout stops receiving it; said here rather than by teaching the shared
 * rule about a decoration only this one bar has.
 */
.query__pair > .query__running {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.query__running {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--field-h);
  padding-inline: var(--gap-loose) var(--gap);
  /*
   * Its own radius, which the pair then flattens on the side it butts against.
   * Without one the span painted a square corner over the rounded box of the
   * group around it, and the left edge of the running chip was a right angle.
   */
  border-radius: var(--control-radius);
  /*
   * A step stronger than the quiet half of the Run pair, so the two parts of
   * this one read apart: the readout is a surface carrying a state, and Cancel
   * is a quiet action sitting beside it rather than more of the same tone.
   */
  background: var(--fill-3);
}

/*
 * Sized for `mm:ss.hh` and centred in it, so the hundredths turning over move
 * nothing at all. Tabular figures are what make that true — proportional ones
 * change width digit by digit, which is the same jitter one level down.
 */
.query__clock {
  min-width: 4.25rem;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-align: center;
  color: var(--color-base-content);
}

/*
 * A dot that breathes, which is the whole of the "still working" signal here —
 * the progress bar over the results says it at length, and this is the corner
 * of the screen the eye is already in. It pulses in opacity and scale together
 * so it reads as one thing pulsing rather than two properties animating.
 */
.query__pulse {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary);
  animation: query-pulse 1.4s var(--ease-out) infinite;
}

@keyframes query-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

/*
 * The chevron beside Run. Filled like the button it belongs to, with the seam
 * drawn in the accent's own darker edge rather than a grey hairline — a grey
 * line across a filled control reads as a crack in it.
 */
/*
 * Scoped *and* descended, because `.toolbar__pair > .toolbar__action` in the
 * shared stylesheet gives the quiet half of a pair a tonal fill — which is
 * right for the pair whose halves are both quiet and wrong for this one, where
 * the chevron is part of the filled control. Equal specificity would leave the
 * winner to source order, which is not a thing to rely on.
 */
.toolbar__pair > .query__scope {
  background: var(--color-primary);
  color: var(--color-primary-content);
  /* Everything behind it needs a statement, so it greys out with the half it is
     attached to rather than staying lit beside a disabled button. */
  transition:
    background-color var(--t-hover) var(--ease-out),
    filter var(--t-hover) var(--ease-out);
  box-shadow: inset 1px 0 0 color-mix(in oklab, black 14%, transparent);
  transition: filter var(--t-hover) var(--ease-out);
}

.toolbar__pair > .query__scope:disabled {
  background: var(--fill-3);
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  box-shadow: none;
}

@media (hover: hover) and (pointer: fine) {
  .toolbar__pair > .query__scope:not(:disabled):hover {
    filter: brightness(1.08);
  }
}

.query__chevron {
  transform: rotate(90deg);
  transition: transform var(--t-pop) var(--ease-sheet);
}

/* Points at the menu it opened, and turns back when it closes. */
.query__chevron--open {
  transform: rotate(-90deg);
}

/* Over the skeleton rather than instead of it, so the pane is never empty. */
.results__note--running {
  flex: 0 0 auto;
  height: auto;
  padding-block: var(--gap-loose);
}

.results__clock {
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

/*
 * Wide enough for "10,000 rows" and no wider; the bar is not a form. The gap
 * before it is wider than the one inside the Run pair and narrower than the one
 * before the verbs — three distances for three degrees of relatedness, where
 * everything used to sit at the same hairline gap and read as one undifferen-
 * tiated row.
 */
.query__limit {
  width: 7.5rem;
  margin-inline-start: var(--gap);
}

/* Their own cluster: they act on the text above, not on the run. */
.query__verbs {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
  margin-inline-start: var(--gap-loose);
}

/*
 * The dot stops rather than the signal disappearing: the bar over the results
 * already says work is happening, and a pulse that keeps breathing is exactly
 * the slow oscillation reduced motion exists to remove.
 */
@media (prefers-reduced-motion: reduce) {
  .query__pulse {
    animation: none;
    opacity: 0.9;
  }

  .query__chevron {
    transition: none;
  }
}

/*
 * No rule of its own: the bar above already carries one on its lower edge, and
 * a second hairline a row later would divide the results from themselves.
 */
.results__bar {
  flex: 0 0 auto;
}

.results__summary {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
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

/*
 * The readout half of the running pair. Tonal rather than filled: it is not a
 * control, and a second filled surface beside the one real button would compete
 * with it.
 */
/* The ring is drawn on this box's outline, so it has to be the box the ring is
   positioned against. */
.query__pair {
  position: relative;
}

/*
 * The pair flattens the seam between its halves by position — first child, last
 * child — and the ring is an overlay that now sits in front of the first of
 * them. It has no surface of its own, so it takes the flattening harmlessly and
 * the readout stops receiving it; said here rather than by teaching the shared
 * rule about a decoration only this one bar has.
 */
.query__pair > .query__running {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.query__running {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--field-h);
  padding-inline: var(--gap-loose) var(--gap);
  /*
   * Its own radius, which the pair then flattens on the side it butts against.
   * Without one the span painted a square corner over the rounded box of the
   * group around it, and the left edge of the running chip was a right angle.
   */
  border-radius: var(--control-radius);
  /*
   * A step stronger than the quiet half of the Run pair, so the two parts of
   * this one read apart: the readout is a surface carrying a state, and Cancel
   * is a quiet action sitting beside it rather than more of the same tone.
   */
  background: var(--fill-3);
}

/*
 * Sized for `mm:ss.hh` and centred in it, so the hundredths turning over move
 * nothing at all. Tabular figures are what make that true — proportional ones
 * change width digit by digit, which is the same jitter one level down.
 */
.query__clock {
  min-width: 4.25rem;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-align: center;
  color: var(--color-base-content);
}

/*
 * A dot that breathes, which is the whole of the "still working" signal here —
 * the progress bar over the results says it at length, and this is the corner
 * of the screen the eye is already in. It pulses in opacity and scale together
 * so it reads as one thing pulsing rather than two properties animating.
 */
.query__pulse {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary);
  animation: query-pulse 1.4s var(--ease-out) infinite;
}

@keyframes query-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.results__clock {
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
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

/*
 * The dot stops rather than the signal disappearing: the bar over the results
 * already says work is happening, and a pulse that keeps breathing is exactly
 * the slow oscillation reduced motion exists to remove.
 */
@media (prefers-reduced-motion: reduce) {
  .query__pulse {
    animation: none;
    opacity: 0.9;
  }

  .query__chevron {
    transition: none;
  }
}

.tabstatus__txn {
  padding-inline: var(--gap);
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.625rem;
}
</style>
