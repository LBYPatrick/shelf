<script setup lang="ts">
/**
 * One thing the assistant produced.
 *
 * A turn is a list of these rather than a block of text, which is what lets a
 * query be a query and a set of rows be a table.
 *
 * The rule that shapes this file is **what folds away**. A turn that answers a
 * question properly may run four queries on the way to it, and a transcript
 * that shows four tables of intermediate counting buries the one table that was
 * asked for. So a query the model marked as working collapses to a single row —
 * its name, what it returned, a chevron at the end — and a query it marked as
 * the answer is open. Either can be opened or shut by hand; the mark only
 * decides where it starts.
 *
 * What is *inside* is identical in both cases, and it is ordered by what was
 * asked for: the **rows first**, and the statement behind a second fold of its
 * own. Someone opening a step wants to see what came back; the SQL is how it
 * came back, which is a different question and a rarer one. Closing the outer
 * fold closes the inner one with it, so a step reopened later is the step as it
 * was first offered rather than however it was last left.
 *
 * The statement itself is the same container everywhere — the same colouring,
 * the same two actions — whether it was run or written out in prose. Two
 * containers for one idea is how an interface starts reading as assembled
 * rather than designed.
 */
import { computed, ref, watch } from 'vue';
import type { AiItem } from '@shared/ai';
import AppIcon from '../ui/AppIcon.vue';
import MarkdownText from './MarkdownText.vue';
import ResultTable from './ResultTable.vue';
import SqlBlock from './SqlBlock.vue';

const props = defineProps<{ item: AiItem; streaming: boolean }>();
const emit = defineEmits<{ open: [sql: string, title: string] }>();

/**
 * Whether the fold is open, once the reader has said.
 *
 * Three states rather than a boolean seeded from the intent, because the item
 * arrives *before* its intent is known — a step is emitted the moment the call
 * starts and updated when it returns — so a fold initialised from the early
 * value would snap shut under a reader who had already opened it.
 */
const said = ref<boolean | null>(null);

const isAnswer = computed(() => props.item.kind === 'step' && props.item.intent === 'answer');

/** A failure opens whatever it was for: nobody marks their own error as the point. */
const wentWrong = computed(
  () =>
    props.item.kind === 'step' &&
    (props.item.state === 'failed' || props.item.state === 'denied')
);

const open = computed(() => said.value ?? (isAnswer.value || wentWrong.value));

/** A step with nothing inside it is a row and nothing else. */
const expandable = computed(
  () =>
    props.item.kind === 'step' &&
    (props.item.sql !== undefined || props.item.rows !== undefined)
);

/**
 * Whether the statement behind the rows is showing.
 *
 * It is a fold of its own only when there are rows to put in front of it. A
 * step that failed, or one that was refused, has nothing *but* its statement,
 * and making the reader open two things to reach the one thing there is would
 * be a fold kept for the sake of symmetry.
 */
const sqlFolds = computed(() => props.item.kind === 'step' && props.item.rows !== undefined);
const sqlOpen = ref(false);

// Closing the step closes the statement inside it, so a step reopened later is
// the step as it was first offered rather than however it was last left. Both
// animate at once, which reads as one thing shutting rather than two.
watch(open, (now) => {
  if (!now) sqlOpen.value = false;
});

const STATE_ICON: Record<string, string> = {
  done: 'check',
  failed: 'warning',
  denied: 'warning',
};
</script>

<template>
  <!--
    The answer, as the markdown it is. It was plain text, which put `**bold**`
    on screen with its asterisks and a bulleted list as lines beginning with a
    hyphen — models write markdown whether or not they are asked to.
  -->
  <MarkdownText
    v-if="item.kind === 'text'"
    class="prose"
    :text="item.text"
    :streaming="streaming"
  />

  <SqlBlock
    v-else-if="item.kind === 'sql'"
    :sql="item.sql"
    :title="item.title"
    @open="(sql, title) => emit('open', sql, title)"
  />

  <!--
    Reasoning. A button rather than `<details>` so the caret, the label and the
    state are one control with one focus ring, and so the fold can be animated
    on the grid-rows trick rather than snapping.
  -->
  <div
    v-else-if="item.kind === 'thinking'"
    class="aside"
  >
    <button
      type="button"
      class="aside__head"
      :aria-expanded="open"
      @click="said = !open"
    >
      <AppIcon
        class="aside__caret"
        :class="{ 'aside__caret--open': open }"
        name="chevron"
        :size="11"
      />
      <span class="aside__label">{{
        streaming ? $t('assistant.thinking') : $t('assistant.thought')
      }}</span>
      <span
        v-if="streaming"
        class="aside__pulse"
        aria-hidden="true"
      />
    </button>

    <div
      class="aside__fold"
      :class="{ 'aside__fold--open': open }"
    >
      <div class="aside__inner">
        <p class="aside__text">
          {{ item.text }}
        </p>
      </div>
    </div>
  </div>

  <!-- A step it took: reading the schema, or running a query. -->
  <div
    v-else-if="item.kind === 'step'"
    class="aside"
    :class="[`aside--${item.state}`, { 'aside--answer': isAnswer }]"
  >
    <button
      type="button"
      class="aside__head"
      :disabled="!expandable"
      :aria-expanded="expandable ? open : undefined"
      @click="said = !open"
    >
      <span
        v-if="item.state === 'running'"
        class="aside__pulse"
        aria-hidden="true"
      />
      <AppIcon
        v-else
        class="aside__glyph"
        :name="STATE_ICON[item.state] ?? 'info'"
        :size="11"
      />

      <span class="aside__label">{{ item.label }}</span>
      <span
        v-if="item.detail"
        class="aside__detail"
      >{{ item.detail }}</span>

      <!--
        The chevron sits at the end of the row, which is where the collapsed
        form puts the one thing it can be asked to reveal.
      -->
      <AppIcon
        v-if="expandable"
        class="aside__caret aside__caret--trail"
        :class="{ 'aside__caret--open': open }"
        name="chevron"
        :size="11"
      />
    </button>

    <div
      v-if="expandable"
      class="aside__fold"
      :class="{ 'aside__fold--open': open }"
    >
      <div class="aside__inner">
        <div class="aside__body">
          <!-- What came back, first: it is what the step was opened for. -->
          <ResultTable
            v-if="item.rows"
            :fields="item.rows.fields"
            :rows="item.rows.rows"
            :truncated="item.rows.truncated"
            :duration-ms="item.rows.durationMs"
          />

          <template v-if="item.sql">
            <button
              v-if="sqlFolds"
              type="button"
              class="aside__inner-head"
              :aria-expanded="sqlOpen"
              @click="sqlOpen = !sqlOpen"
            >
              <AppIcon
                class="aside__caret"
                :class="{ 'aside__caret--open': sqlOpen }"
                name="chevron"
                :size="10"
              />
              <span>{{ $t('assistant.theQuery') }}</span>
            </button>

            <div
              class="aside__fold"
              :class="{ 'aside__fold--open': !sqlFolds || sqlOpen }"
            >
              <div class="aside__inner">
                <div class="aside__reveal">
                  <SqlBlock
                    :sql="item.sql"
                    :title="item.label"
                    @open="(sql, title) => emit('open', sql, title)"
                  />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <p
      v-if="item.error"
      class="aside__error"
    >
      {{ item.error }}
    </p>
  </div>

  <p
    v-else-if="item.kind === 'error'"
    class="failure"
  >
    <AppIcon
      name="warning"
      :size="13"
    />
    <span>{{ item.message }}</span>
  </p>
</template>

<style scoped>
.prose {
  margin: 0 0 var(--gap);
}

.aside {
  margin: var(--gap-tight) 0;
}

.aside__head {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  width: 100%;
  min-height: var(--hit-min);
  padding-inline: var(--gap-tight);
  border-radius: var(--radius-field);
  font-size: 0.6875rem;
  text-align: start;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
}

.aside__head:not(:disabled):hover {
  background: var(--fill-1);
  color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
}

/*
 * The row above the answer is louder than the working above it: it is a heading
 * for the table under it rather than a footnote about how it was reached.
 */
.aside--answer .aside__head {
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 82%, transparent);
}

.aside--failed .aside__head,
.aside--denied .aside__head {
  color: var(--color-warning, var(--color-base-content));
}

.aside__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aside__detail {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.aside__glyph {
  flex: 0 0 auto;
  opacity: 0.8;
}

.aside__caret {
  flex: 0 0 auto;
  opacity: 0.6;
  transition: transform var(--t-hover) var(--ease-out);
}

.aside__caret--trail {
  margin-inline-start: auto;
}

.aside__caret--open {
  transform: rotate(90deg);
}

/*
 * A dot that breathes while something is happening.
 *
 * A spinner would be the obvious choice and is the wrong one here: a rotating
 * element beside every step of a multi-step turn is four things spinning at
 * once in a column somebody is trying to read. Scale and opacity on one dot are
 * composited, quiet, and unambiguous.
 */
.aside__pulse {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-inline: 2px;
  border-radius: 999px;
  background: var(--color-primary);
  animation: breathe 1.4s var(--ease-in-out) infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(0.7);
    opacity: 0.45;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

/*
 * The fold is a grid row animating between zero and one fraction, which is the
 * only way to transition to a height that is not known in advance without
 * measuring it every time the content changes.
 */
.aside__fold {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--t-pop) var(--ease-out);
}

.aside__fold--open {
  grid-template-rows: 1fr;
}

.aside__inner {
  overflow: hidden;
}

/*
 * The height opens and the content arrives *into* it.
 *
 * Height alone was the whole animation, and a box growing to reveal content
 * already at full opacity reads as a clipping mask sliding off rather than as
 * something appearing — the table's first row is fully drawn before there is
 * room for a second. Fading and a few pixels of travel give it somewhere to
 * come from, and both are composited, so a table with two hundred cells in it
 * costs no more to reveal than an empty box.
 *
 * The travel is *upward-from* rather than downward-into: the fold grows down,
 * so content that starts slightly high and settles moves with the edge that is
 * moving instead of against it.
 */
.aside__body,
.aside__reveal {
  opacity: 0;
  transform: translateY(-0.25rem);
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.aside__fold--open > .aside__inner > .aside__body,
.aside__fold--open > .aside__inner > .aside__reveal {
  opacity: 1;
  transform: none;
}

/* Indented under the row that produced it, so the two read as one thing. */
.aside__body {
  padding-inline-start: var(--gap);
}

/*
 * The statement, behind the rows.
 *
 * Quieter than the step's own row and quieter again than the answer above it:
 * this is the third thing down a hierarchy, and it is the only control here
 * whose label is a noun rather than a description of what happened.
 */
.aside__inner-head {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-height: var(--hit-min);
  padding-inline: var(--gap-tight);
  border-radius: var(--radius-field);
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
}

.aside__inner-head:hover {
  background: var(--fill-1);
  color: color-mix(in oklab, var(--color-base-content) 75%, transparent);
}

.aside__text {
  margin: 0;
  padding: var(--gap-tight) var(--gap-loose) var(--gap);
  border-inline-start: 2px solid var(--separator);
  margin-inline-start: var(--gap);
  font-size: 0.75rem;
  line-height: 1.55;
  white-space: pre-wrap;
  opacity: 0.7;
}

.aside__error {
  margin: 0 0 var(--gap) var(--gap-loose);
  font-size: 0.6875rem;
  color: var(--color-error, var(--color-base-content));
}

.failure {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  margin: var(--gap) 0;
  padding: var(--gap-loose);
  border-radius: 0.75rem;
  background: color-mix(in oklab, var(--color-error, var(--color-primary)) 10%, transparent);
  font-size: 0.75rem;
  color: var(--color-error, var(--color-base-content));
}

@media (prefers-reduced-motion: reduce) {
  .aside__pulse {
    animation: none;
    opacity: 0.8;
  }

  /*
   * Reduced motion keeps the *change*, not the travel: the fold still opens and
   * the content still appears, both at once and without moving. A disclosure
   * that snaps with nothing to say it snapped is a disclosure people press
   * twice.
   */
  .aside__fold,
  .aside__caret {
    transition: none;
  }

  .aside__body,
  .aside__reveal {
    transform: none;
    transition: opacity var(--t-hover) var(--ease-out);
  }
}
</style>
