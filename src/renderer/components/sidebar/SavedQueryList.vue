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
import { vTip } from '../../lib/hoverTip';

const queries = useQueries();
const tabs = useTabs();

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}
</script>

<template>
  <div class="entries">
    <p
      v-if="queries.visibleSaved.length === 0"
      class="tilelist__note"
    >
      <!--
        It used to say "press ⌘S", which is a key nothing is bound to: saving a
        query is the button on the query tab's toolbar and always has been.
      -->
      {{ $t('saved.empty') }}
    </p>

    <ul
      v-else
      class="tilelist"
    >
      <li
        v-for="query in queries.visibleSaved"
        :key="query.id"
      >
        <div class="tile">
          <button
            v-tip="query.text"
            type="button"
            class="tile__face focus-fill"
            @click="tabs.openQuery(query.text)"
          >
            <span class="tile__name">{{ query.name }}</span>
            <span class="tile__meta">{{ excerpt(query.text) }}</span>
          </button>

          <span class="tile__tools">
            <button
              v-tip="$t('saved.discard')"
              type="button"
              class="tile__tool focus-fill"
              :aria-label="$t('saved.discard')"
              @click="queries.remove(query.id)"
            >
              <AppIcon
                name="close"
                :size="12"
              />
            </button>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The list and its rows are `.tilelist` and `.tile`, defined once in
   `controls.css`; this list adds nothing to them. */
.entries {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
</style>
