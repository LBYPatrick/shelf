<script setup lang="ts">
/**
 * Statements that have been run.
 *
 * Each entry shows what it did — rows, time, whether it worked — because that
 * is usually how you recognise the one you are looking for, faster than reading
 * the SQL back.
 */
import { useTranslation } from 'i18next-vue';
import { elapsedSince } from '@shared/elapsed';
import { useQueries } from '../../stores/queries';
import { useTabs } from '../../stores/tabs';
import AppIcon from '../ui/AppIcon.vue';
import CheckBox from '../ui/CheckBox.vue';

const queries = useQueries();
const tabs = useTabs();
const { t } = useTranslation();

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

/**
 * When it happened, as a person would say it.
 *
 * The arithmetic is `shared/elapsed.ts`; only the wording is here, and it is
 * the same wording the other two lists use. Relative up to a week, because that
 * is the range in which "yesterday" is more use than a date, and absolute after
 * — "37 days ago" is not a fact anyone can do anything with.
 */
function ago(at: number): string {
  const since = elapsedSince(at, Date.now());
  switch (since.unit) {
    case 'now':
      return t('time.justNow');
    case 'minutes':
      return t('time.minutesAgo', { count: since.count });
    case 'hours':
      return t('time.hoursAgo', { count: since.count });
    case 'days':
      return t('time.daysAgo', { count: since.count });
    case 'date':
      return new Date(since.at).toLocaleDateString();
  }
}
</script>

<template>
  <div class="entries">
    <div class="entries__head">
      <CheckBox
        v-model="queries.showAll"
        class="entries__toggle"
        :label="$t('history.allConnections')"
        @change="queries.refresh()"
      />

      <button
        class="entries__clear"
        @click="queries.clearHistory()"
      >
        {{ $t('history.clear') }}
      </button>
    </div>

    <p
      v-if="queries.visibleHistory.length === 0"
      class="entries__empty type-label"
    >
      {{ $t('history.empty') }}
    </p>

    <div
      v-for="(entry, index) in queries.visibleHistory"
      :key="entry.id"
      class="entry"
      :style="{ '--index': index }"
      role="button"
      tabindex="0"
      :title="entry.text"
      @dblclick="tabs.openQuery(entry.text)"
      @keydown.enter="tabs.openQuery(entry.text)"
    >
      <AppIcon
        class="entry__state"
        :class="entry.succeeded ? 'entry__state--ok' : 'entry__state--bad'"
        :name="entry.succeeded ? 'check' : 'warning'"
        :size="11"
      />

      <span class="entry__text">{{ excerpt(entry.text) }}</span>

      <span class="entry__meta">
        <span v-if="entry.rowCount !== null">{{ entry.rowCount }} rows</span>
        <span v-if="entry.durationMs !== null">{{ Math.round(entry.durationMs) }} ms</span>
        <span>{{ ago(entry.executedAt) }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.entries {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--gap);
}

.entries__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--gap) var(--gap-tight);
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
}

.entries__toggle {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.entries__clear:hover {
  color: var(--color-error);
}

.entries__empty {
  padding: var(--gap) var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.entry {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--gap-tight);
  padding: var(--gap-tight) var(--gap);
  margin-inline: var(--gap-tight);
  border-radius: 0.4rem;
  cursor: default;
  animation: entry-in 260ms var(--ease-out) backwards;
  animation-delay: calc(min(var(--index) * 25ms, 240ms));
  transition: background-color var(--t-press) var(--ease-out);
}

@keyframes entry-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

.entry__state {
  margin-top: 2px;
}

.entry__state--ok {
  color: color-mix(in oklab, var(--color-success) 80%, var(--color-base-content));
}

.entry__state--bad {
  color: var(--color-error);
}

.entry__text {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.4;
  color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.entry__meta {
  grid-column: 2;
  display: flex;
  gap: var(--gap);
  font-size: 0.5625rem;
  color: color-mix(in oklab, var(--color-base-content) 40%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .entry:hover {
    background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .entry {
    animation: none;
  }
}
</style>
