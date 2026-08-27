<script setup lang="ts">
/**
 * The conversations, as cards.
 *
 * A card rather than a row because a conversation has more than a name: when it
 * started, when it was last added to, and — the thing a list of forty titles
 * cannot tell you — which one you were in this morning. Two timestamps is what
 * separates "a list of chats" from "the chat I want".
 *
 * They are drawn the way a job card is, and that is deliberate rather than
 * convenient: the two are the same kind of object in this app — a thing that
 * ran, has a name you can change, and can be thrown away — so they are the same
 * container, and someone who has learned one has learned the other.
 *
 * Renaming follows the rule the job list already established. The card opens on
 * one click and the *name* renames on two, so the quarter-second it costs to
 * tell those apart is charged to the name and to nothing else.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { SavedChat } from '@shared/appdb';
import { elapsedSince } from '@shared/elapsed';
import { recordMatches, type CriterionKind } from '@shared/jobFilter';
import AppIcon from '../ui/AppIcon.vue';
import FilterChips from './FilterChips.vue';
import { useAssistant } from '../../stores/assistant';
import { useConnections } from '../../stores/connections';
import { useTabs } from '../../stores/tabs';
import { vTip } from '../../lib/hoverTip';

const assistant = useAssistant();
const connections = useConnections();
const tabs = useTabs();
const { t } = useTranslation();

/*
 * Read when the list is opened, not once per window.
 *
 * The rail destroys and rebuilds this component every time it is switched to,
 * so this is the moment the list is about to be looked at — and it is the only
 * moment that can be right. Read once at launch, a conversation saved in
 * another window never appears until this one is relaunched, and the list gets
 * quietly, invisibly wrong the longer the app stays open.
 */
onMounted(() => {
  void assistant.refreshChats(connections.active?.id ?? null);
});

/*
 * The same narrowing the jobs get, asked of the facts a chat has.
 *
 * A conversation is a thing with a name and a moment, which is all the shared
 * matcher needs; what differs between the two lists is only which questions
 * each can answer, and that is the `kinds` the chips are given.
 */
/** A chat has one moment worth bracketing: when it was last added to. */
const CHAT_KINDS: readonly CriterionKind[] = ['updated'];

const shown = computed(() => {
  const now = Date.now();
  return assistant.chats.filter((chat) =>
    recordMatches({ name: chat.title, at: chat.updatedAt }, assistant.filter, now)
  );
});

/** Which card's name is being edited, and what it currently says. */
const editing = ref<string | null>(null);
const draft = ref('');
const field = ref<HTMLInputElement>();

/**
 * The interval a double click has to arrive within.
 *
 * The open is held for exactly this long on the *name* and nowhere else. Held
 * on the whole card it would be a quarter-second added to the commonest action
 * in the list; held nowhere, a rename could not be started at all, because the
 * first click would open the tab and take the focus with it.
 */
const DOUBLE_MS = 250;
let pending: ReturnType<typeof setTimeout> | undefined;

function open(chat: SavedChat): void {
  const tab = tabs.openChat(undefined, chat.title);
  tab.chatId = chat.id;
  void assistant.adopt(tab.id, chat);
}

function onNameClick(chat: SavedChat): void {
  clearTimeout(pending);
  pending = setTimeout(() => open(chat), DOUBLE_MS);
}

function startRename(chat: SavedChat): void {
  clearTimeout(pending);
  editing.value = chat.id;
  draft.value = chat.title;
  void nextTick(() => {
    field.value?.focus();
    field.value?.select();
  });
}

function commit(): void {
  const id = editing.value;
  editing.value = null;
  if (!id) return;
  const next = draft.value.trim();
  if (next) void assistant.rename(id, next);
}

function discard(chat: SavedChat): void {
  void assistant.discard(chat.id, connections.active?.id ?? null);
}

/**
 * When it happened, as a person would say it.
 *
 * The arithmetic is `shared/elapsed.ts`; only the wording is here, and it is
 * the same wording the other two lists use. Relative up to a week, because that
 * is the range in which "yesterday" is more use than a date, and absolute after
 * — "37 days ago" is not a fact anyone can do anything with.
 */
function when(at: number): string {
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
  <div class="chats">
    <FilterChips
      v-model="assistant.filter"
      :kinds="CHAT_KINDS"
    />

    <p
      v-if="assistant.chats.length === 0"
      class="tilelist__note"
    >
      {{ $t('chats.empty') }}
    </p>

    <p
      v-else-if="shown.length === 0"
      class="tilelist__note"
    >
      {{ $t('chats.noMatch') }}
    </p>

    <ul
      v-else
      class="tilelist"
    >
      <li
        v-for="chat in shown"
        :key="chat.id"
      >
        <div
          class="tile"
          :class="{ 'tile--on': tabs.tabs.some((tab) => tab.chatId === chat.id) }"
        >
          <!--
            The whole card opens it. A row that is a button is a row where the
            gap between two words is not a dead spot.
          -->
          <button
            type="button"
            class="tile__face focus-fill"
            @click="open(chat)"
          >
            <input
              v-if="editing === chat.id"
              ref="field"
              v-model="draft"
              class="tile__field"
              :aria-label="$t('chats.rename')"
              spellcheck="false"
              @click.stop
              @keydown.enter.prevent="commit"
              @keydown.esc.prevent="editing = null"
              @blur="commit"
            >
            <!--
              Two lines' worth of room, used or not.
              ──────────────────────────────────────
              A chat is named after the question that started it, so the names
              here are sentences and one line cuts most of them mid-word. Two
              lines held whether or not both are needed is what makes the column
              scan: a list whose rows are three different heights has to be read
              row by row, where an even one can be swept.
            -->
            <span
              v-else
              class="tile__name"
              @click.stop="onNameClick(chat)"
              @dblclick.stop="startRename(chat)"
            >{{ chat.title }}</span>

            <span class="tile__meta">{{ when(chat.updatedAt) }}</span>
          </button>

          <!--
            An overlay, not a column — the same arrangement the job card uses,
            and for the same reason: the name is clamped, so a control that
            takes its width out of the row on hover re-wraps the name and grows
            the card under the hand reaching for it.
          -->
          <span class="tile__tools">
            <button
              v-tip="$t('chats.discard')"
              type="button"
              class="tile__tool focus-fill"
              :aria-label="$t('chats.discard')"
              @click="discard(chat)"
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
/*
 * The list and its rows are `.tilelist` and `.tile`, defined once in
 * `controls.css` and shared with the jobs, the saved queries and the history.
 * They are the same kind of object — a thing that ran, has a name you can
 * change, and can be thrown away — so they are the same object.
 */
.chats {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
</style>
