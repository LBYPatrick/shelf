<script setup lang="ts">
/**
 * Queries worth keeping.
 *
 * One click opens one in a tab; two on the name rename it. Both are the same
 * gestures the jobs and the chats use, which is the point — three lists of
 * named things you can open and rename should not be three sets of rules.
 *
 * Saving happens from the query tab, so this stays a list rather than becoming
 * a second editor.
 */
import { nextTick, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { SavedQuery } from '@shared/appdb';
import { useQueries } from '../../stores/queries';
import { useTabs } from '../../stores/tabs';
import AppIcon from '../ui/AppIcon.vue';
import { vTip } from '../../lib/hoverTip';

const queries = useQueries();
const tabs = useTabs();
const { t } = useTranslation();

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}

/** Which one's name is being edited, and what it currently says. */
const editing = ref<string | null>(null);
const draft = ref('');
const field = ref<HTMLInputElement>();

/**
 * The interval a double click has to arrive within.
 *
 * Held on the *name* and nowhere else, the way the job and chat cards do it:
 * charged to the whole tile it would be a quarter-second added to the
 * commonest action in the list, and charged nowhere the rename could not be
 * started at all, because the first click would open a tab and take the focus
 * with it.
 */
const DOUBLE_MS = 250;
let pending: ReturnType<typeof setTimeout> | undefined;

/*
 * Opened *as* the saved query, not as a copy of its text.
 *
 * The tab carries the id, so Save updates this query rather than filing a
 * second one under the same name, and the dot on the tab means "differs from
 * what is saved" rather than nothing at all. It also takes the name: a tab is
 * named for what is in it, and "Query 4" is the one thing the reader already
 * knows.
 */
function open(query: SavedQuery): void {
  tabs.openQuery(query.text, { savedQueryId: query.id, title: query.name });
}

function onNameClick(query: SavedQuery): void {
  clearTimeout(pending);
  pending = setTimeout(() => open(query), DOUBLE_MS);
}

function startRename(query: SavedQuery): void {
  clearTimeout(pending);
  editing.value = query.id;
  draft.value = query.name;
  void nextTick(() => {
    field.value?.focus();
    field.value?.select();
  });
}

/**
 * Committed on the way out, whichever way that is.
 *
 * Having typed a name and looked elsewhere is not an instruction to discard it
 * — which is what every rename-in-place on the platform does.
 */
function commit(): void {
  const id = editing.value;
  const query = queries.visibleSaved.find((entry) => entry.id === id);
  editing.value = null;
  if (!id || !query) return;

  const name = draft.value.trim();
  if (name && name !== query.name) void queries.save(name, query.text, id);
}
</script>

<template>
  <div class="entries">
    <p v-if="queries.visibleSaved.length === 0" class="tilelist__note">
      <!--
        It says ⌘S again, and now that is true. It said it once when nothing was
        bound to it, was corrected to name the button instead, and the chord has
        since been made real — which is the better answer, because a shortcut is
        what an empty state is for teaching.
      -->
      {{ $t('saved.empty') }}
    </p>

    <ul v-else class="tilelist">
      <li v-for="query in queries.visibleSaved" :key="query.id">
        <div class="tile">
          <div
            v-tip="query.text"
            class="tile__face focus-fill"
            role="button"
            tabindex="0"
            :aria-label="query.name"
            @click="open(query)"
            @keydown.enter="open(query)"
          >
            <input
              v-if="editing === query.id"
              ref="field"
              v-model="draft"
              class="tile__field"
              :aria-label="$t('saved.rename')"
              spellcheck="false"
              @click.stop
              @keydown.enter.prevent="commit"
              @keydown.esc.prevent="editing = null"
              @blur="commit"
            />
            <span
              v-else
              class="tile__name"
              @click.stop="onNameClick(query)"
              @dblclick.stop="startRename(query)"
              >{{ query.name }}</span
            >

            <span class="tile__meta">{{ excerpt(query.text) }}</span>
          </div>

          <span class="tile__tools">
            <button
              v-tip="$t('saved.duplicate')"
              type="button"
              class="tile__tool focus-fill"
              :aria-label="$t('saved.duplicate')"
              @click="queries.duplicate(query, t('noun.copy'))"
            >
              <AppIcon name="copy" :size="12" />
            </button>
            <button
              v-tip="$t('saved.discard')"
              type="button"
              class="tile__tool focus-fill"
              :aria-label="$t('saved.discard')"
              @click="queries.remove(query.id)"
            >
              <AppIcon name="close" :size="12" />
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
