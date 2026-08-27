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
import { vTip } from '../../lib/hoverTip';

const queries = useQueries();
const tabs = useTabs();
const { t } = useTranslation();

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
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
    </div>

    <p v-if="queries.visibleHistory.length === 0" class="tilelist__note">
      {{ $t('history.empty') }}
    </p>

    <ul v-else class="tilelist">
      <li v-for="entry in queries.visibleHistory" :key="entry.id">
        <div class="tile">
          <!--
            One click, like every other tile in this window. It used to open on
            a double click, alone among the four lists — a gesture nobody
            discovers and one this list has no second meaning for.
          -->
          <button
            v-tip="entry.text"
            type="button"
            class="tile__face focus-fill"
            @click="tabs.openQuery(entry.text)"
          >
            <span class="tile__name">{{ excerpt(entry.text) }}</span>

            <span class="tile__meta">
              <AppIcon
                :class="entry.succeeded ? 'entry__state--ok' : 'entry__state--bad'"
                :name="entry.succeeded ? 'check' : 'warning'"
                :size="11"
              />
              <span v-if="entry.rowCount !== null">{{
                $t('jobs.rowCount', { rows: entry.rowCount.toLocaleString() })
              }}</span>
              <span class="tile__dot" aria-hidden="true">·</span>
              <span>{{ ago(entry.executedAt) }}</span>
            </span>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/*
 * The list is `.tilelist` and the rows are `.tile`, both defined once in
 * `controls.css`. What is left here is the one thing this list has that the
 * others do not: a switch for whether it shows every connection's history or
 * only this one's.
 */
.entries {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.entries__head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0 var(--gap) var(--gap-tight);
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
}

.entries__toggle {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
}

.entry__state--ok {
  color: var(--color-success, oklch(72% 0.17 150));
}

.entry__state--bad {
  color: var(--color-error);
}
</style>
