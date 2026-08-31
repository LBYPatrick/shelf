<script setup lang="ts">
/**
 * What the server has been spending its time on.
 *
 * Two sections, and the popup that contains it decides which one is showing.
 * *Queries* answers "which statements cost the most, and lately or ever";
 * *Server* answers "is the machine healthy". They are separate because the
 * first is something you act on by rewriting a query and the second by changing
 * a setting, and mixing them produces a dashboard where neither is findable.
 *
 * It lives in the database's Properties popup rather than in a tab of its own.
 * This is reference material — you come to check what is slow and then go and
 * change something — and a tab is the wrong shape for that, in the same way and
 * for the same reason the structure view stopped being one.
 *
 * The time windows are the part worth explaining. No engine keeps a history:
 * `pg_stat_statements` and `events_statements_summary_by_digest` both hold one
 * running total per statement since the counters were last reset, so "the last
 * hour" does not exist to be asked for. The app keeps its own readings and
 * differences them — see `shared/queryStats.ts` — which means a window is only
 * as good as the history behind it, and the tab says so rather than presenting
 * a narrower answer as the one that was asked for.
 */
import { computed, onBeforeUnmount, onMounted, shallowRef, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { ServerMetrics, StatementSample } from '@drivers/types';
import { formatBytes } from '@shared/bytes';
import { formatDuration } from '@shared/duration';
import { errorMessage } from '@shared/errors';
import {
  WINDOWS,
  bucketize,
  intervals,
  rangeOf,
  retain,
  windowOf,
  windowLength,
  type StatementDelta,
  type WindowId,
} from '@shared/queryStats';
import { host } from '../../lib/host';
import { saveSetting } from '../../lib/settings';
import { useConnections } from '../../stores/connections';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import RankedBars, { type Bar } from '../viz/RankedBars.vue';
import ShareDonut from '../viz/ShareDonut.vue';
import StatementHistogram from '../viz/StatementHistogram.vue';

const props = defineProps<{ section: 'queries' | 'server'; active: boolean }>();

const connections = useConnections();
const tabs = useTabs();
const toasts = useToasts();
const { t } = useTranslation();

const section = computed(() => props.section);
const windowId = ref<WindowId>('hour');
const loading = ref(false);
const error = ref<string | null>(null);
const problem = ref<{ kind: string; detail?: string } | null>(null);

/*
 * Shallow, and for a reason beyond cost. A deep ref hands back Proxies, and a
 * Proxy cannot be structured-cloned — so writing the history back to the
 * application database threw "an object could not be cloned" on every reading,
 * silently, leaving every window permanently one sample deep.
 */
const history = shallowRef<readonly StatementSample[]>([]);
const metrics = ref<ServerMetrics | null>(null);
const selected = ref<string | null>(null);

const windows = computed(() =>
  WINDOWS.map((entry) => ({ value: entry.id, label: t(`analyzeWindow.${entry.id}`) }))
);

/**
 * The readings survive the tab being closed and the app being restarted.
 *
 * Kept per connection in the application database rather than in memory,
 * because a window of a week is only meaningful if something was recording a
 * week ago — and the app is the only thing recording.
 */
const storageKey = computed(() => `stats:${connections.active?.id ?? 'none'}`);

async function loadHistory(): Promise<void> {
  history.value = await window.shelf.db
    .getSetting<readonly StatementSample[]>(storageKey.value, [])
    .catch(() => []);
}

async function refresh(): Promise<void> {
  if (!connections.active) return;

  loading.value = true;
  error.value = null;

  try {
    const connectionId = connections.requireId();
    const [statements, server] = await Promise.all([
      host.call('stats/statements', { connectionId }),
      host.call('stats/metrics', { connectionId }),
    ]);

    metrics.value = server;

    if (statements.ok) {
      problem.value = null;
      const next = retain(history.value, statements.sample);
      history.value = next;
      void saveSetting(storageKey.value, next).catch(() => undefined);
    } else {
      problem.value = {
        kind: statements.problem,
        ...(statements.detail ? { detail: statements.detail } : {}),
      };
    }
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

/* ------------------------------------------------------------------ queries */

/**
 * The span dragged out on the histogram, or null for the window as chosen.
 *
 * Everything downstream reads `result`, so a selection re-answers the ranking,
 * the table and the totals rather than only shading the chart — a brush that
 * changed nothing but the chart would be decoration.
 */
const selection = ref<readonly [number, number] | null>(null);

const result = computed(() =>
  selection.value
    ? rangeOf(history.value, selection.value[0], selection.value[1])
    : windowOf(history.value, windowId.value)
);
const statements = computed<readonly StatementDelta[]>(() => result.value?.statements ?? []);

// A window is a different stretch of time, so a selection drawn over the old
// one describes nothing in the new one.
watch(windowId, () => (selection.value = null));

const TOP = 10;

/** What a Postgres server needs before it will report anything at all. */
const SETUP = `shared_preload_libraries = 'pg_stat_statements'
CREATE EXTENSION pg_stat_statements;`;

/** The two problems those two lines actually fix. */
const needsSetup = computed(
  () => problem.value?.kind === 'not-installed' || problem.value?.kind === 'not-loaded'
);

const bars = computed<Bar[]>(() =>
  statements.value.slice(0, TOP).map((statement) => ({
    id: statement.id,
    label: oneLine(statement.text),
    value: statement.totalMs,
    display: formatDuration(statement.totalMs),
  }))
);

const chosen = computed(
  () => statements.value.find((statement) => statement.id === selected.value) ?? null
);

/**
 * The work done between each pair of readings, laid onto equal columns.
 *
 * The columns are decided by the window rather than by a control, because the
 * useful width of one is a property of the span being looked at: five minutes
 * of an hour and a day of a month are the same picture at two scales. Forty is
 * about as many as read as columns rather than as a comb at the widths this
 * panel gets.
 */
const COLUMNS = 40;

const series = computed(() => intervals(history.value));

const chartSpan = computed<readonly [number, number] | null>(() => {
  const samples = history.value;
  const last = samples[samples.length - 1];
  if (!last || samples.length < 2) return null;

  const length = windowLength(windowId.value);
  const earliest = samples[0]!.takenAt;
  const from = Number.isFinite(length) ? Math.max(earliest, last.takenAt - length) : earliest;

  // A window wider than the history is drawn as the history, not as a wall of
  // empty columns with the data crushed into the last of them.
  return from >= last.takenAt ? [earliest, last.takenAt] : [from, last.takenAt];
});

const buckets = computed(() => {
  const range = chartSpan.value;
  return range ? bucketize(series.value, range[0], range[1], COLUMNS) : [];
});

/** What the current answer covers, whether it came from a window or a drag. */
const spentMs = computed(() =>
  statements.value.reduce((sum, statement) => sum + statement.totalMs, 0)
);

const callCount = computed(() =>
  statements.value.reduce((sum, statement) => sum + statement.calls, 0)
);

/**
 * Anything shown as code can be taken away.
 *
 * The setup commands are the case that matters: the whole point of printing
 * them is that the reader runs them somewhere else, and a block you have to
 * retype is a block that gets retyped wrong.
 */
async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  toasts.show({ tone: 'success', message: t('action.copied') });
}

/** The statement text as one line, so a bar label is a bar label. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayAndClock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * A moment on the chart's axis, in the smallest form that stays unambiguous.
 *
 * Inside a day the date is noise on every label; beyond one, the time of day
 * alone would put Tuesday's 09:00 and Wednesday's 09:00 under the same word.
 */
function formatMoment(at: number): string {
  const range = chartSpan.value;
  const span = range ? range[1] - range[0] : 0;
  return (span > 24 * 3_600_000 ? dayAndClock : clock).format(new Date(at));
}

/** Statement time per second of observed wall clock; see the histogram. */
function formatRate(msPerSecond: number): string {
  if (msPerSecond >= 1000) return `${(msPerSecond / 1000).toFixed(1)}×`;
  if (msPerSecond >= 1) return `${Math.round(msPerSecond)} ms/s`;
  return `${msPerSecond.toFixed(1)} ms/s`;
}

/** Elapsed time, in the largest unit that leaves a number worth reading. */
function formatElapsed(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

function formatMetric(value: number, unit: string): string {
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'ratio') return `${(value * 100).toFixed(2)}%`;
  if (unit === 'ms') return formatDuration(value);
  if (unit === 'seconds') return formatElapsed(value);
  if (unit === 'perSecond') return `${compact.format(Math.round(value))}/s`;
  return value.toLocaleString();
}

/** A gauge is only worth colouring when the driver said what "bad" looks like. */
function isAlarming(gauge: { value: number; warnAbove?: number; warnBelow?: number }) {
  if (gauge.warnAbove !== undefined && gauge.value > gauge.warnAbove) return true;
  return gauge.warnBelow !== undefined && gauge.value < gauge.warnBelow;
}

function labelFor(prefix: string, key: string): string {
  const translated = t(`${prefix}.${key}`);
  return translated === `${prefix}.${key}` ? key : translated;
}

const spanLabel = computed(() => {
  const window = result.value;
  if (!window) return '';
  if (!window.from) return t('analyzeSpan.single');

  const minutes = Math.round((window.to - window.from) / 60_000);
  if (minutes < 60) return t('analyzeSpan.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('analyzeSpan.hours', { count: hours });
  return t('analyzeSpan.days', { count: Math.round(hours / 24) });
});

/* ------------------------------------------------------------------- server */

const tableBars = computed<Bar[]>(
  () =>
    metrics.value?.largestTables.map((table) => ({
      id: `${table.entity.schema ?? ''}.${table.entity.name}`,
      label: table.entity.name,
      value: table.totalBytes,
      display: formatBytes(table.totalBytes),
      // Dead rows are a part of the size rather than a number beside it, so
      // they are drawn inside the bar they are inflating.
      ...(table.deadRatio ? { inner: table.totalBytes * table.deadRatio } : {}),
    })) ?? []
);

const activity = computed(
  () =>
    metrics.value?.activity.map((entry) => ({
      id: entry.state,
      label: entry.state,
      value: entry.count,
    })) ?? []
);

const connectionCount = computed(() =>
  activity.value.reduce((sum, entry) => sum + entry.value, 0)
);

/* --------------------------------------------------------------- refreshing */

/**
 * Ten minutes, and only while the tab is on screen.
 *
 * Each tick is a reading, so the interval is also the finest resolution any
 * window can have — and reading `pg_stat_statements` is a scan of every entry
 * the server holds, which is not something to do every second in the
 * background. Ten minutes fills an hour with six points and a day with a
 * hundred and forty, which is more than the chart can draw.
 */
const SAMPLE_INTERVAL = 600_000;
let timer: ReturnType<typeof setInterval> | undefined;

function startSampling(): void {
  stopSampling();
  timer = setInterval(() => void refresh(), SAMPLE_INTERVAL);
}

function stopSampling(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      void refresh();
      startSampling();
    } else stopSampling();
  }
);

onMounted(async () => {
  await loadHistory();
  if (props.active) {
    await refresh();
    startSampling();
  }
});

onBeforeUnmount(stopSampling);
</script>

<template>
  <div class="analyze">
    <p v-if="error" class="analyze__error" role="alert">
      {{ error }}
    </p>

    <div v-else class="analyze__body">
      <!-- ------------------------------------------------------- queries -->
      <template v-if="section === 'queries'">
        <!--
          The extension is not installed by default and needs a server restart
          to enable, so its absence is the normal case rather than a failure.
          The two lines that fix it are given here, because the alternative is
          the reader leaving to find them.
        -->
        <div v-if="problem" class="analyze__empty">
          <p class="type-title">
            {{ $t(`analyzeProblem.${problem.kind}`) }}
          </p>
          <!--
            The install commands are the answer to exactly two of these and
            actively misleading for the rest: a server that is recording
            thousands of statements for another database does not need the
            extension creating again. What every one of them gets instead is the
            server's own numbers, below.
          -->
          <p v-if="needsSetup" class="analyze__hint">
            {{ $t('analyzeProblem.hint') }}
          </p>
          <div v-if="needsSetup" class="snippet">
            <pre class="analyze__code selectable">{{ SETUP }}</pre>
            <button
              type="button"
              class="snippet__copy"
              :aria-label="$t('action.copy')"
              :title="$t('action.copy')"
              @click="copy(SETUP)"
            >
              <AppIcon name="copy" :size="13" />
            </button>
          </div>
          <p v-if="problem.detail" class="analyze__detail">
            {{ problem.detail }}
          </p>
        </div>

        <template v-else>
          <div class="analyze__windows">
            <SegmentedControl
              v-model="windowId"
              :options="windows"
              :aria-label="$t('analyze.windowLabel')"
            />
            <span class="analyze__span">{{ spanLabel }}</span>
            <span class="analyze__grow" />
            <button type="button" class="analyze__refresh" :disabled="loading" @click="refresh">
              <AppIcon name="refresh" :size="12" />
              {{ loading ? $t('analyze.reading') : $t('action.refresh') }}
            </button>
          </div>

          <!--
            Said plainly rather than hidden behind an icon. A window computed
            from a history shorter than the window is a real answer to a
            slightly different question, and quietly showing it as the answer
            asked for is the one thing this tab must not do.
          -->
          <p v-if="result?.caveat" class="analyze__caveat">
            <AppIcon name="info" :size="12" />
            {{ $t(`analyzeCaveat.${result.caveat}`) }}
          </p>

          <section v-if="buckets.length > 0" class="panel">
            <div class="panel__head">
              <h2 class="panel__title type-label">
                {{ $t('analyze.trend') }}
              </h2>
              <span class="analyze__totals">{{
                $t('analyze.totals', {
                  time: formatDuration(spentMs),
                  calls: compact.format(Math.round(callCount)),
                })
              }}</span>
            </div>
            <StatementHistogram
              :buckets="buckets"
              :selection="selection"
              :label="$t('analyze.trend')"
              :format="formatRate"
              :format-time="formatMoment"
              @select="selection = $event"
            />
          </section>

          <section v-if="statements.length > 0" class="panel">
            <h2 class="panel__title type-label">
              {{ $t('analyze.slowest') }}
            </h2>
            <RankedBars
              :bars="bars"
              :label="$t('analyze.slowest')"
              :selected="selected"
              @pick="selected = $event"
            />
          </section>

          <section v-if="statements.length > 0" class="panel panel--flush">
            <table class="stats">
              <colgroup>
                <col span="1" style="width: 44%" />
                <col span="1" style="width: 11%" />
                <col span="1" style="width: 12%" />
                <col span="1" style="width: 11%" />
                <col span="1" style="width: 11%" />
                <col span="1" style="width: 11%" />
              </colgroup>
              <thead>
                <tr>
                  <th>{{ $t('analyze.statement') }}</th>
                  <th class="stats__number">
                    {{ $t('analyze.calls') }}
                  </th>
                  <th class="stats__number">
                    {{ $t('analyze.totalTime') }}
                  </th>
                  <th class="stats__number">
                    {{ $t('analyze.meanTime') }}
                  </th>
                  <th class="stats__number">
                    {{ $t('analyze.maxTime') }}
                  </th>
                  <th class="stats__number">
                    {{ $t('analyze.share') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="statement in statements"
                  :key="statement.id"
                  :class="{ 'stats__row--on': statement.id === selected }"
                  @click="selected = statement.id === selected ? null : statement.id"
                >
                  <td class="stats__text">
                    <span class="stats__query">{{ oneLine(statement.text) }}</span>
                    <span v-if="statement.firstSeen" class="stats__badge">{{
                      $t('analyze.new')
                    }}</span>
                  </td>
                  <td class="stats__number">
                    {{ compact.format(statement.calls) }}
                  </td>
                  <td class="stats__number stats__number--strong">
                    {{ formatDuration(statement.totalMs) }}
                  </td>
                  <td class="stats__number">
                    {{ formatDuration(statement.meanMs) }}
                  </td>
                  <td class="stats__number">
                    {{ statement.maxMs === undefined ? '—' : formatDuration(statement.maxMs) }}
                  </td>
                  <td class="stats__number">{{ (statement.share * 100).toFixed(1) }}%</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!--
            The chosen statement in full, and a way out of the tab: reading a
            slow query is the beginning of rewriting it, and retyping it into
            the editor is the step nobody should have to take.
          -->
          <section v-if="chosen" class="panel">
            <div class="panel__head">
              <h2 class="panel__title type-label">
                {{ $t('analyze.statement') }}
              </h2>
              <PressButton size="sm" variant="glass" @click="tabs.openQuery(chosen.text)">
                <AppIcon name="query" :size="12" />
                {{ $t('analyze.openInEditor') }}
              </PressButton>
            </div>
            <div class="snippet">
              <pre class="analyze__code analyze__code--wide selectable">{{ chosen.text }}</pre>
              <button
                type="button"
                class="snippet__copy"
                :aria-label="$t('action.copy')"
                :title="$t('action.copy')"
                @click="copy(chosen.text)"
              >
                <AppIcon name="copy" :size="13" />
              </button>
            </div>
          </section>

          <!--
            Three different silences, said as three different sentences. "The
            extension is installed and nothing has run" and "nothing has been
            recorded yet, come back in ten minutes" are not the same news, and
            the panel used to give both of them the same four words — which read
            as a broken screen on a server that was plainly busy.
          -->
          <p v-if="statements.length === 0" class="analyze__note">
            {{
              loading
                ? $t('workspace.loading')
                : history.length === 0
                  ? $t('analyze.noReadings')
                  : selection
                    ? $t('analyze.quietSelection')
                    : $t('analyze.quiet')
            }}
          </p>
        </template>
      </template>

      <!-- -------------------------------------------------------- server -->
      <template v-else>
        <div class="analyze__windows">
          <span class="analyze__grow" />
          <button type="button" class="analyze__refresh" :disabled="loading" @click="refresh">
            <AppIcon name="refresh" :size="12" />
            {{ loading ? $t('analyze.reading') : $t('action.refresh') }}
          </button>
        </div>

        <div v-if="metrics" class="gauges">
          <div
            v-for="gauge in metrics.gauges"
            :key="gauge.key"
            class="gauges__item"
            :class="{ 'gauges__item--warn': isAlarming(gauge) }"
          >
            <span class="type-label gauges__label">{{ labelFor('metric', gauge.key) }}</span>
            <span class="gauges__value">{{ formatMetric(gauge.value, gauge.unit) }}</span>
          </div>
        </div>

        <section v-if="activity.length > 0" class="panel">
          <h2 class="panel__title type-label">
            {{ $t('analyze.activity') }}
          </h2>
          <ShareDonut
            :slices="activity"
            :total="connectionCount.toLocaleString()"
            :caption="$t('analyze.activity')"
          />
        </section>

        <section v-if="tableBars.length > 0" class="panel">
          <h2 class="panel__title type-label">
            {{ $t('analyze.largestTables') }}
          </h2>
          <RankedBars :bars="tableBars" :label="$t('analyze.largestTables')" />
          <p class="analyze__hint">
            {{ $t('analyze.deadRows') }}
          </p>
        </section>

        <section v-if="metrics && metrics.unusedIndexes.length > 0" class="panel">
          <h2 class="panel__title type-label">
            {{ $t('analyze.unusedIndexes') }}
          </h2>
          <ul class="unused">
            <li
              v-for="index in metrics.unusedIndexes"
              :key="`${index.entity.schema ?? ''}.${index.name}`"
              class="unused__row"
            >
              <span class="unused__name">{{ index.name }}</span>
              <span class="unused__table">{{ index.entity.name }}</span>
              <span class="unused__size">{{
                index.sizeBytes > 0 ? formatBytes(index.sizeBytes) : '—'
              }}</span>
            </li>
          </ul>
          <p class="analyze__hint">
            {{ $t('analyze.unusedHint') }}
          </p>
        </section>

        <p v-if="!metrics" class="analyze__note">
          {{ $t('workspace.loading') }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
/*
 * Fills whatever it is put in. As a tab's only child that was automatic; inside
 * the Properties popup it is a flex item, where the default is to be sized by
 * its own content — so the widest bar label decided how wide the panel was and
 * the table ran off the edge of the sheet.
 */
.analyze {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.analyze__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.analyze__windows {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  min-width: 0;
  padding-bottom: var(--gap);
}

.analyze__span {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}

.analyze__caveat {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  margin: 0 0 var(--gap-loose);
  padding: var(--gap-tight) var(--gap);
  border-radius: var(--radius-field);
  background: color-mix(in oklab, var(--color-warning) 14%, transparent);
  font-size: 0.75rem;
}

.analyze__grow {
  flex: 1;
}

/*
 * The one action in the panel, at the quiet end of the toolbar language: a
 * refresh repeats what the panel already did on its own, and the popup's own
 * footer holds the button that ends the task.
 */
.analyze__refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  font-size: 0.75rem;
  font-weight: 500;
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  transition: background-color var(--t-hover) var(--ease-out);
}

.analyze__refresh:disabled {
  opacity: 0.5;
}

@media (hover: hover) and (pointer: fine) {
  .analyze__refresh:not(:disabled):hover {
    background-color: var(--fill-3);
    color: var(--color-base-content);
  }
}

.analyze__error {
  margin-block: var(--gap-loose);
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-field);
  background: color-mix(in oklab, var(--color-error) 15%, transparent);
  font-size: 0.8125rem;
}

.analyze__note {
  padding: var(--gap-section);
  margin-inline: auto;
  max-width: 44ch;
  text-align: center;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-soft);
}

/*
 * The sum of whatever is currently being answered, beside the title of the
 * chart that chooses it. It sits here rather than under the chart because it is
 * the number the drag is *for*: the shape says when, and this says how much.
 */
.analyze__totals {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}

.analyze__empty {
  display: grid;
  place-items: center;
  gap: var(--gap);
  padding-block: var(--gap-section);
  text-align: center;
}

.analyze__hint,
.analyze__detail {
  margin: var(--gap-tight) 0 0;
  max-width: 34rem;
  font-size: 0.75rem;
  color: var(--text-soft);
}

/*
 * The button sits on the block rather than beside it: a snippet is as wide as
 * the pane and a control in a column of its own would take that width from the
 * code, which is the thing being read.
 */
.snippet {
  position: relative;
  width: 100%;
}

.snippet__copy {
  position: absolute;
  top: var(--gap-tight);
  inset-inline-end: var(--gap-tight);
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  background: var(--fill-3);
  color: var(--text-soft);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .snippet__copy:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }
}

.analyze__code {
  margin: 0;
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  text-align: start;
  white-space: pre-wrap;
  word-break: break-word;
  padding-inline-end: calc(var(--hit-min) + var(--gap-loose));
}

.analyze__code--wide {
  width: 100%;
}

.panel {
  min-width: 0;
  margin-bottom: var(--gap-section);
  padding: var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
}

/* A table paints to its own edges; padding around it would leave the header
   band floating inside a card instead of capping it. */
.panel--flush {
  padding: 0;
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
}

.panel__title {
  margin: 0 0 var(--gap);
  text-transform: uppercase;
  color: var(--text-soft);
}

.panel__head .panel__title {
  margin-bottom: var(--gap);
}

.gauges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: var(--gap);
  margin-bottom: var(--gap-section);
}

.gauges__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
}

/*
 * A number outside its bounds is tinted, not recoloured: the warning colour as
 * *text* on a wash of itself is the low-contrast pair the theme exists to
 * avoid, and the value has to stay as readable as its neighbours.
 */
.gauges__item--warn {
  background: color-mix(in oklab, var(--color-warning) 16%, transparent);
}

.gauges__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
  color: var(--text-soft);
}

.gauges__value {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.011em;
  font-variant-numeric: tabular-nums;
}

.stats {
  display: table;
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.stats th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: calc(var(--row-h) * 1.1);
  padding-inline: var(--gap);
  text-align: start;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-soft);
  background: var(--color-base-200);
  border-bottom: 1px solid var(--separator);
}

.stats td {
  height: calc(var(--row-h) * 1.1);
  padding-inline: var(--gap);
  border-bottom: 1px solid var(--separator);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats th:first-child,
.stats td:first-child {
  padding-inline-start: var(--gap-loose);
}

.stats th:last-child,
.stats td:last-child {
  padding-inline-end: var(--gap-loose);
}

.stats__number {
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.stats__number--strong {
  font-weight: 600;
}

.stats__text {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.stats__query {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
}

.stats__badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  color: var(--color-primary-text, var(--color-primary));
  font-size: 0.5625rem;
  font-weight: 500;
}

.stats tbody tr:hover {
  background: color-mix(in oklab, var(--color-primary) 7%, transparent);
}

.stats__row--on {
  background: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.unused {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.unused__row {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: var(--row-h);
  font-size: 0.75rem;
}

.unused__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.unused__table,
.unused__size {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}
</style>
