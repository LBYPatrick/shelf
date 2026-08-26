<script setup lang="ts">
/**
 * Dispatched queries, newest first.
 *
 * A list rather than a tab per job: most of them are finished and will never be
 * opened again, and a workspace that grows a tab for every dispatch is a
 * workspace you have to tidy. Opening one is a deliberate act, and it opens
 * where every other result opens.
 *
 * The name is editable in place. It starts as the database and the moment,
 * which is the only default that is never wrong, and becomes whatever the
 * reader calls the thing they were actually asking — "june refunds" beats
 * "production-20260819-090405" the moment there are three of them.
 *
 * A hundred are kept, so the list is also a log, and a log is read by
 * *searching* it. The field is in the sidebar's head where every other rail
 * keeps one; the four questions a name cannot answer — how did it end, when did
 * it start, when did it finish, how long did it take — fold away behind the
 * button beside it, and the predicate they drive is in `shared/jobFilter.ts`.
 */
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { jobDuration, narrowedBy, tracksTheClock } from '@shared/jobFilter';
import { explainStatement } from '@shared/explain';
import { slugify } from '@shared/fileNames';
import { useJobs, type Job } from '../../stores/jobs';
import { useConnections } from '../../stores/connections';
import { useTabs } from '../../stores/tabs';
import { useToasts } from '../../stores/toasts';
import { host } from '../../lib/host';
import AppIcon from '../ui/AppIcon.vue';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';
import ExportSheet from '../grid/ExportSheet.vue';
import FilterChips from './FilterChips.vue';

const jobs = useJobs();
const connections = useConnections();
const tabs = useTabs();
const toasts = useToasts();
const { t } = useTranslation();

const editing = ref<string | null>(null);
const draft = ref('');
/*
 * A callback ref, because the input lives inside the `v-for` over the jobs: a
 * string ref there collects every element that carried it into an *array*, so
 * `field.value?.select()` was reaching for `select` on a list and finding
 * nothing — the box opened without the caret in it, and without its text
 * selected. Only one is ever mounted, so the callback is the whole of the
 * bookkeeping.
 */
let field: HTMLInputElement | null = null;

function bindField(el: unknown): void {
  field = (el as HTMLInputElement | null) ?? null;
}

/** The four states, named. Flat keys, because the bundles are two levels deep. */
function statusLabel(status: Job['status']): string {
  return t(`jobs.status${status[0]!.toUpperCase()}${status.slice(1)}`);
}

function open(job: Job): void {
  if (job.status !== 'done' || !job.path) return;
  tabs.openJob(job.id, job.name);
}

/**
 * The one element on the card with two meanings, and the only one that pays for
 * it.
 *
 * Opening is a click and renaming is two, so a click on the name cannot be
 * acted on until it is known not to be the first of a pair. Everywhere else on
 * the card opens at once, because nothing there is ambiguous — the cost of
 * telling one gesture from another is charged where the ambiguity actually is,
 * and nowhere else.
 *
 * Without this the rename could not be reached at all on a finished job: the
 * first click opened its tab, the grid inside took the caret, and the box that
 * had just opened blurred and committed before a key could reach it.
 */
const DOUBLE_CLICK_MS = 250;
let pendingOpen: ReturnType<typeof setTimeout> | undefined;

function forgetPendingOpen(): void {
  if (pendingOpen === undefined) return;
  clearTimeout(pendingOpen);
  pendingOpen = undefined;
}

function openAfterGrace(job: Job): void {
  forgetPendingOpen();
  pendingOpen = setTimeout(() => {
    pendingOpen = undefined;
    open(job);
  }, DOUBLE_CLICK_MS);
}

async function beginRename(job: Job): Promise<void> {
  forgetPendingOpen();
  editing.value = job.id;
  draft.value = job.name;
  await nextTick();
  field?.focus();
  field?.select();
}

function commitRename(): void {
  if (editing.value) jobs.rename(editing.value, draft.value);
  editing.value = null;
}

async function discard(job: Job): Promise<void> {
  tabs.closeJob(job.id);
  await jobs.remove(job.id);
  toasts.show({ tone: 'info', message: t('jobs.discarded', { name: job.name }) });
}

/* ------------------------------------------------------------- the menu */

/**
 * Right-click, for the things a card two lines tall has no room to offer.
 *
 * The card carried one button and one action. A cross in the corner is the
 * right shape for the destructive one — it is the action you want without
 * hunting — but "export what this returned" and "why was this slow" have
 * nowhere to live up there, and a job that ran for four minutes is exactly the
 * one worth asking both about.
 */
const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const menuOn = ref<Job | null>(null);

const exportOf = ref<Job | null>(null);
const exportOpen = ref(false);

const menuItems = computed<MenuItem[]>(() => {
  const job = menuOn.value;
  const finished = job?.status === 'done' && job.path !== undefined;
  return [
    { id: 'open', label: t('jobs.openRows'), icon: 'table', disabled: !finished },
    {
      id: 'export',
      label: t('menu.exportData'),
      icon: 'download',
      disabled: !finished,
      startsGroup: true,
    },
    { id: 'explain', label: t('jobs.explain'), icon: 'chart' },
    { id: 'discard', label: t('jobs.discard'), icon: 'trash', startsGroup: true },
  ];
});

function openMenu(event: MouseEvent, job: Job): void {
  event.preventDefault();
  forgetPendingOpen();
  menuOn.value = job;
  menuAt.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function onChoose(id: string): void {
  const job = menuOn.value;
  if (!job) return;

  if (id === 'open') open(job);
  else if (id === 'discard') void discard(job);
  else if (id === 'export') {
    exportOf.value = job;
    exportOpen.value = true;
  } else if (id === 'explain') {
    /*
     * Opened as a statement rather than run here. A job outlives the connection
     * it ran on — the list is a log — so "explain this" cannot assume there is
     * a server to ask. Putting the statement in an editor works whether or not
     * there is, and running it is then the same gesture as running anything.
     */
    const engine = connections.active?.engine ?? 'postgres';
    const tab = tabs.openQuery(explainStatement(engine, job.sql));
    tabs.rename(tab.id, t('jobs.explainOf', { name: job.name }));
  }
}

/**
 * The rows a job spooled, written to a file.
 *
 * Straight from the spool: nothing is re-run and no row enters this process,
 * which is the whole reason it was dispatched rather than run.
 */
async function writeJobToFile(
  path: string,
  format: 'csv' | 'json' | 'jsonl' | 'sql'
): Promise<void> {
  const job = exportOf.value;
  if (!job?.path) return;
  await host.call('job/export', { path: job.path, target: path, format });
}

/** The sheet reads rows from the file, not from here. */
const NO_ROWS: readonly Record<string, never>[] = [];

/**
 * Twice a second while something is running, and every quarter minute while a
 * filter is measured against the clock.
 *
 * A job runs for minutes, is read at a glance, and is one of a list of them —
 * so the readout carries tenths rather than the query bar's hundredths, and the
 * tick matches: a clock updated more often than its last digit can change is
 * work done to redraw the same string. "Started in the last hour" moves at the
 * scale of minutes, and holding a list of a hundred to a two-a-second redraw
 * for a boundary that crosses once a minute is the same waste in the other
 * direction. The list is mounted only while the rail is showing it, so "on
 * screen" needs no further asking.
 */
const TICK_MS = 500;
const WINDOW_MS = 15_000;

/**
 * The clock a running job is read by, and the one its window is measured from.
 *
 * `Date.now()` inside the template is not a reason for Vue to draw again, so
 * the number was whatever the clock said the last time something *else* changed
 * — a job that ran for a minute showed the tenth of a second it had reached
 * when the list was last touched, and looked stopped. The tick is the reactive
 * thing, and it only runs while there is something to count.
 */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;

/*
 * `status`, which is what the field is called. Keyed on a `state` that no job
 * has, this was always false: the ticker never started, and the clock showed
 * whatever it had said when something else last redrew the list.
 */
const cadence = computed(() => {
  if (jobs.running.length > 0) return TICK_MS;
  return tracksTheClock(jobs.filter) ? WINDOW_MS : 0;
});

watch(
  cadence,
  (ms) => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
    if (ms === 0) return;

    // Read at once as well as on the interval: a filter chosen just now is
    // answered against this moment, not against the last time anything ticked.
    now.value = Date.now();
    ticker = setInterval(() => (now.value = Date.now()), ms);
  },
  { immediate: true }
);

onScopeDispose(() => {
  if (ticker !== undefined) clearInterval(ticker);
  forgetPendingOpen();
});

const shown = computed(() => jobs.matching(now.value));

/** Whether anything at all is being asked of the list, the text included. */
const narrowed = computed(() => narrowedBy(jobs.filter) > 0 || jobs.filter.text.trim() !== '');

/**
 * How long it took, or how long it has been going — the same measure the length
 * filter is applied to, so a job found under "over a minute" cannot be one whose
 * card says fifty seconds.
 */
function duration(job: Job): string {
  const seconds = jobDuration(job, now.value) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayAndClock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * When it went out, in the smallest form that stays unambiguous.
 *
 * Inside today the date is noise on every card; beyond it, the time of day
 * alone would put Tuesday's 09:00 and Wednesday's 09:00 under the same word —
 * which is exactly the confusion a list kept a hundred deep invites.
 */
function startedAt(job: Job): string {
  const at = new Date(job.startedAt);
  const midnight = new Date(now.value);
  midnight.setHours(0, 0, 0, 0);
  return (job.startedAt >= midnight.getTime() ? clock : dayAndClock).format(at);
}
</script>

<template>
  <div class="joblist">
    <!--
      The conditions, in the open.
      ────────────────────────────
      They were four selects behind a fold. Four controls saying "any" is four
      controls' worth of chrome reporting that nothing is happening, and folding
      them away to fix that hides the one thing worth seeing — what the list is
      currently not showing you.
    -->
    <FilterChips v-model="jobs.filter" />

    <!--
          The count, and the way back. A list that is missing rows says so on
          the same surface that is missing them — and the way to see all of them
          again is next to the sentence explaining why you cannot.
        -->
    <div
      v-if="narrowed"
      class="joblist__tally"
    >
      <span class="type-label">{{
        $t('jobs.matchCount', { shown: shown.length, total: jobs.ordered.length })
      }}</span>
      <button
        type="button"
        class="joblist__clear focus-fill"
        @click="jobs.clearFilter()"
      >
        {{ $t('action.clear') }}
      </button>
    </div>

    <div class="joblist__scroll">
      <p
        v-if="jobs.ordered.length === 0"
        class="joblist__empty"
      >
        {{ $t('jobs.empty') }}
      </p>

      <!-- Nothing matched, which is a different fact from nothing existing. -->
      <p
        v-else-if="shown.length === 0"
        class="joblist__empty"
      >
        {{ $t('jobs.noMatches') }}
        <button
          type="button"
          class="joblist__clear focus-fill"
          @click="jobs.clearFilter()"
        >
          {{ $t('jobs.clearFilters') }}
        </button>
      </p>

      <div
        v-for="job in shown"
        :key="job.id"
        class="job"
        @contextmenu="openMenu($event, job)"
      >
        <!--
          Not a `<button>`, because the name inside it has to hear a double-click
          and a disabled button delivers no events to its children — so a failed
          job, the one most likely to be worth renaming, could not be renamed at
          all. `aria-disabled` on a div with a button role does the same thing to
          anything that respects it, so a job that cannot be opened is not given
          the role in the first place: it is text, and text can be double-clicked.
        -->
        <div
          class="job__face focus-fill"
          :role="job.status === 'done' ? 'button' : undefined"
          :tabindex="job.status === 'done' ? 0 : undefined"
          :aria-label="
            job.status === 'done' ? t('jobs.openResult', { name: job.name }) : undefined
          "
          @click="open(job)"
          @keydown.enter="open(job)"
        >
          <!--
            The name has the row to itself.
            ───────────────────────────────
            It used to share the line with the status, which left a generated
            name — a database, a date and a time, in one unbreakable token —
            about half the width of an already narrow column: every job in the
            list read `production-20…`, and the one thing that tells two of them
            apart was the part that had been cut off. The status moved under it,
            where it costs a line and hides nothing.
          -->
          <span
            v-if="editing === job.id"
            class="job__editor"
            @click.stop
            @dblclick.stop
          >
            <input
              :ref="(el) => bindField(el)"
              v-model="draft"
              class="job__rename"
              :aria-label="$t('jobs.rename')"
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="editing = null"
              @blur="commitRename"
            >
            <!--
              The way out, inside the thing you are editing.
              ──────────────────────────────────────────────
              Return commits and Escape abandons, but a field with no visible way
              to say "done" is a field the reader has to already know the rules
              of. `mousedown` is prevented so pressing it does not blur the input
              first — a button that dismisses itself before its own click lands is
              a button that works by accident.
            -->
            <button
              type="button"
              class="job__confirm focus-fill"
              :aria-label="$t('action.confirm')"
              @mousedown.prevent
              @click.stop="commitRename"
            >
              <AppIcon
                name="check"
                :size="12"
              />
            </button>
          </span>
          <span
            v-else
            class="job__name"
            @click.stop="openAfterGrace(job)"
            @dblclick.stop="beginRename(job)"
          >{{ job.name }}</span>

          <span class="job__line">
            <!--
              Status as a word in its own colour, with the mark that says which
              kind of word it is.
              ─────────────────────────────────────────────────────────────────
              It was a chip: a filled, rounded container inside a card that is
              already a container, drawn at the weight of a button for something
              that cannot be pressed. The colour and the glyph were doing the
              work; the box around them was just taking the room the figures
              needed. A job still in flight has no glyph — it has a dot that
              breathes, because "working" is the one state that is a *now* rather
              than an outcome.
            -->
            <span
              class="job__status"
              :class="`job__status--${job.status}`"
            >
              <span
                v-if="job.status === 'done' || job.status === 'failed'"
                class="job__status-mark"
              >
                <AppIcon
                  :name="job.status === 'done' ? 'check' : 'warning'"
                  :size="11"
                />
              </span>
              <span
                v-else
                class="job__status-mark job__status-mark--live"
                aria-hidden="true"
              />
              {{ statusLabel(job.status) }}
            </span>
            <span
              v-if="job.status === 'done'"
              class="job__meta"
            >{{
              $t('jobs.rowCount', { rows: job.rows.toLocaleString() })
            }}</span>
          </span>

          <!--
            When it went out, and how long it held on.
            ──────────────────────────────────────────
            The two facts a finished job is looked back at for, and neither was
            on the card: the length shared a phrase with the row count, and the
            moment was only in the default name — which is the first thing
            renaming a job throws away. They are the same two things the filter
            asks about, so a list narrowed by them shows what it was narrowed on.
          -->
          <span class="job__when">
            <span>{{ $t('jobs.startedAt', { time: startedAt(job) }) }}</span>
            <span
              class="job__dot"
              aria-hidden="true"
            >·</span>
            <span>{{ $t('jobs.tookTime', { time: duration(job) }) }}</span>
          </span>

          <!--
            And the reason, in full-ish. A driver's message is a sentence, not a
            label: given one line it was cut at the width of the column, which is
            reliably before the part naming what went wrong.
          -->
          <span
            v-if="job.status === 'failed' && job.error"
            class="job__error"
          >{{
            job.error
          }}</span>
        </div>

        <!--
          An overlay, not a column.
          ─────────────────────────
          It used to be a flex sibling whose width animated open on hover, which
          took that width out of the face beside it — and the name is clamped to
          two lines, so a card whose title fitted on one line at rest wrapped to
          two the moment the pointer touched it. The card changed height under
          the hand that was reaching for it.

          Out of the flow it cannot do that. The room it needs is reserved on
          the face permanently instead: a constant, and a constant is something
          the eye stops seeing, where a card that resizes is something it cannot
          stop seeing.
        -->
        <span class="job__tools">
          <button
            v-tip="$t('jobs.discard')"
            type="button"
            class="job__tool focus-fill"
            :aria-label="$t('jobs.discard')"
            @click="discard(job)"
          >
            <AppIcon
              name="close"
              :size="12"
            />
          </button>
        </span>
      </div>
    </div>

    <ContextMenu
      v-model="menuOpen"
      :items="menuItems"
      :at="menuAt"
      @choose="onChoose"
    />

    <ExportSheet
      v-if="exportOf"
      v-model="exportOpen"
      :fields="exportOf.fields"
      :rows="NO_ROWS"
      :name="slugify(exportOf.name)"
      :write-file="writeJobToFile"
    />
  </div>
</template>

<style scoped>
.joblist {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* Only the list scrolls: the choices stay where they were put. */
.joblist__scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--gap-tight);
  min-height: 0;
  padding: var(--gap-tight);
  overflow-y: auto;
}

.joblist__tally {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-tight);
  padding: 0 var(--gap) var(--gap-tight) var(--gap);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  font-variant-numeric: tabular-nums;
}

.joblist__clear {
  border-radius: var(--control-radius);
  padding: 2px 6px;
  color: var(--color-primary-text, var(--color-primary));
  font-size: 0.6875rem;
  font-weight: 500;
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .joblist__clear:hover {
    background: color-mix(in oklab, var(--color-primary) 14%, transparent);
  }
}

.joblist__empty {
  padding: var(--gap-section) var(--gap-loose);
  font-size: 0.75rem;
  line-height: 1.5;
  text-align: center;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

/*
 * A card each, rather than rows in a list.
 *
 * A job carries five facts — what it was called, how it ended, how much it
 * brought back, when it went out and how long it took — and a row wide enough
 * for one of them shows one of them. Given a card they all fit, stacked, and
 * the card is also what makes a list of them scannable: the eye counts objects
 * far faster than it counts lines of text.
 *
 * Shaped like a tab, because it is the same kind of object: a tonal tile with
 * no drawn edge, at the radius every control in the app is drawn at. The
 * hairline it used to carry was doing the separating the fill is there to do,
 * which left a column of outlined boxes — the look of a form rather than of a
 * list of things you can open.
 */
.job {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: var(--control-radius);
  background: var(--fill-4);
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .job:hover {
    background: var(--fill-3);
  }
}

.job__face {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-hair);
  min-width: 0;
  /*
   * The trailing room is the overlay's, always. Reserved rather than yielded on
   * hover: see the note on `.job__tools`.
   */
  padding: var(--gap) calc(var(--hit-min) + var(--gap)) var(--gap) var(--gap);
  border-radius: var(--control-radius);
  text-align: start;
}

/* A job with no rows to show is not a link; it still says what happened. */
.job__face:disabled {
  cursor: default;
}

.job__line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gap-tight);
  min-width: 0;
}

/*
 * Two lines, and it breaks *anywhere*: a default name is one token with no
 * spaces in it, so a wrap that only breaks at spaces cannot wrap it at all and
 * falls back to cutting it off.
 */
.job__name {
  align-self: stretch;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.35;
  /*
   * Two lines' worth of room, whether or not two lines are used.
   *
   * The tools open into the row on hover, which narrows this box, which can
   * push a name onto a second line — and the card grew taller under the
   * pointer that was reaching for it. The name may reflow; the card may not
   * move. Holding the height of the *text* is what makes the width safe to
   * animate at all.
   */
  min-height: calc(2 * 1.35em);
}

/*
 * The editor stands exactly where the name stood: same width, same two lines of
 * height, so beginning to rename does not move the card or anything under it.
 * The field is the box; the input inside it is just text, and the way out sits
 * at the end of the line where a caret arrives last.
 */
.job__editor {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: var(--gap-hair);
  min-width: 0;
  min-height: calc(2 * 1.35em);
  padding-inline: var(--gap-tight);
  border-radius: var(--control-radius);
  background: var(--color-base-100);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 70%, transparent);
}

.job__rename {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 0.75rem;
  font-weight: 500;
}

.job__rename:focus {
  outline: none;
}

.job__confirm {
  display: grid;
  place-items: center;
  flex: none;
  width: calc(var(--hit-min) - 6px);
  height: calc(var(--hit-min) - 6px);
  border-radius: calc(var(--control-radius) - 2px);
  color: var(--color-primary-text, var(--color-primary));
  transition:
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .job__confirm:hover {
    background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  }
}

.job__confirm:active {
  transform: scale(0.94);
}

/*
 * The status is type, not furniture: the tone is on the words themselves and
 * on the mark before them, and the row keeps the space a chip would have spent
 * on its own edges.
 */
.job__status {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-hair);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.job__status-mark {
  display: grid;
  place-items: center;
}

.job__status--done {
  color: var(--color-success);
}

.job__status--failed {
  color: var(--color-error);
}

.job__status--running,
.job__status--pending {
  color: color-mix(in oklab, var(--color-base-content) 65%, transparent);
}

/*
 * A dot that breathes, for the two states that are still happening. Opacity and
 * scale move together so it reads as one thing pulsing rather than two
 * properties animating — and slowly, because this sits in a list somebody is
 * reading past, not on the control they are waiting at.
 */
.job__status-mark--live {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-primary);
  animation: job-breathe 1.8s var(--ease-out) infinite;
}

.job__status--pending .job__status-mark--live {
  background: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

@keyframes job-breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.78);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .job__status-mark--live {
    animation: none;
    opacity: 0.9;
  }
}

.job__meta {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  white-space: nowrap;
}

/*
 * The times are the quietest line on the card: they are what you read once you
 * have found the job, not what you find it by. A step down in weight from the
 * status above them is what keeps three stacked lines from reading as three
 * equal claims on the eye.
 */
.job__when {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.3em;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.job__dot {
  opacity: 0.7;
}

/* Three lines of it: enough for the sentence a driver actually writes, and a
   bound so one broken job cannot push the rest of the list off the screen. */
.job__error {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: var(--color-error);
}

/*
 * The tools take no room until they are wanted.
 *
 * They used to hold their place always — invisible but occupying it — on the
 * argument that the name would otherwise re-wrap when the pointer arrived. That
 * bought stillness at the cost of a permanent bite out of every card: the one
 * thing on a job worth reading is its name, and a fifth of the width was
 * reserved for two buttons that are not there.
 *
 * So the column opens instead. Width is not a property to animate lightly — it
 * is laid out every frame — but this is two buttons in a sidebar, on a hover,
 * and the alternative is a permanent tax on the content. The curve decelerates
 * so the room arrives rather than snapping open, and the icons follow it in
 * from the edge they will leave by.
 */
.job__tools {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--gap-hair);
  /*
   * The same inset from the top as from the right. Pulling the buttons up to
   * sit optically on the first line of text put them closer to one edge of the
   * card than the other, and a corner with two different margins is the thing
   * the eye notices before anything the corner contains.
   */
  padding: var(--gap) var(--gap) 0 0;
  opacity: 0;
  /* Only opacity and the glyph's slide: neither is laid out, so neither can
     move anything else on the card. */
  transition: opacity 140ms var(--ease-out);
}

.job:hover .job__tools,
.job:focus-within .job__tools {
  opacity: 1;
}

/*
 * Both the same square, both the same radius, both showing the same fill under
 * the pointer. One of them having a surface and the other not is what made them
 * look misaligned when they are in fact the same size.
 */
.job__tool {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  transform: translateX(6px);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.job:hover .job__tool,
.job:focus-within .job__tool {
  transform: none;
}

@media (hover: hover) and (pointer: fine) {
  .job__tool:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }
}

/* The press, not the release. */
.job__tool:active {
  background: var(--fill-1);
  transform: scale(0.94);
}

/*
 * Reduced motion keeps the room and loses the travel: the column still has to
 * open, because the buttons cannot be pressed inside a box of zero width — it
 * simply opens at once rather than arriving.
 */
@media (prefers-reduced-motion: reduce) {
  .job__tools,
  .job__tool {
    transition: opacity 120ms linear;
    transform: none;
  }
}
</style>
