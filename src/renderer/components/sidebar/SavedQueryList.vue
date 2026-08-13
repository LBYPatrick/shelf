<script setup lang="ts">
/**
 * Queries worth keeping.
 *
 * Double-click opens one in a new tab. Saving happens from the query tab, so
 * this stays a list rather than becoming a second editor.
 */
import { useQueries } from '../../stores/queries';
import { useTabs } from '../../stores/tabs';
import AppIcon from '../ui/AppIcon.vue';

const queries = useQueries();
const tabs = useTabs();

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}
</script>

<template>
  <div class="list">
    <p
      v-if="queries.visibleSaved.length === 0"
      class="list__empty type-label"
    >
      Nothing saved. Write a query and press ⌘S.
    </p>

    <div
      v-for="(query, index) in queries.visibleSaved"
      :key="query.id"
      class="entry"
      :style="{ '--index': index }"
      role="button"
      tabindex="0"
      :title="query.text"
      @dblclick="tabs.openQuery(query.text)"
      @keydown.enter="tabs.openQuery(query.text)"
    >
      <AppIcon
        class="entry__icon"
        name="star"
        :size="12"
      />

      <span class="entry__body">
        <span class="entry__name">{{ query.name }}</span>
        <span class="entry__text">{{ excerpt(query.text) }}</span>
      </span>

      <button
        class="entry__remove"
        :aria-label="`Delete ${query.name}`"
        @click.stop="queries.remove(query.id)"
      >
        <AppIcon
          name="close"
          :size="10"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--gap);
}

.list__empty {
  padding: var(--gap) var(--gap-loose);
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.entry {
  display: flex;
  align-items: flex-start;
  gap: var(--gap-tight);
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

.entry__icon {
  margin-top: 3px;
  color: color-mix(in oklab, var(--color-warning) 80%, var(--color-base-content));
}

.entry__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.entry__name {
  font-size: 0.75rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry__text {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry__remove {
  opacity: 0;
  padding: 2px;
  border-radius: 0.25rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition:
    opacity var(--t-press) var(--ease-out),
    color var(--t-press) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .entry:hover {
    background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  }

  .entry:hover .entry__remove,
  .entry__remove:focus-visible {
    opacity: 1;
  }

  .entry__remove:hover {
    color: var(--color-error);
  }
}

@media (prefers-reduced-motion: reduce) {
  .entry {
    animation: none;
  }
}
</style>
