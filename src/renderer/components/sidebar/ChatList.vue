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
import AppIcon from '../ui/AppIcon.vue';
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

const shown = computed(() => {
  const needle = assistant.search.trim().toLowerCase();
  if (!needle) return assistant.chats;
  return assistant.chats.filter((chat) => chat.title.toLowerCase().includes(needle));
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
    <p
      v-if="assistant.chats.length === 0"
      class="chats__note type-label"
    >
      {{ $t('chats.empty') }}
    </p>

    <p
      v-else-if="shown.length === 0"
      class="chats__note type-label"
    >
      {{ $t('chats.noMatch') }}
    </p>

    <ul
      v-else
      class="chats__list"
    >
      <li
        v-for="chat in shown"
        :key="chat.id"
      >
        <div
          class="chatcard"
          :class="{ 'chatcard--open': tabs.tabs.some((tab) => tab.chatId === chat.id) }"
        >
          <!--
            The whole card opens it. A row that is a button is a row where the
            gap between two words is not a dead spot.
          -->
          <button
            type="button"
            class="chatcard__face focus-fill"
            @click="open(chat)"
          >
            <input
              v-if="editing === chat.id"
              ref="field"
              v-model="draft"
              class="chatcard__field"
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
              class="chatcard__name"
              @click.stop="onNameClick(chat)"
              @dblclick.stop="startRename(chat)"
            >{{ chat.title }}</span>

            <span class="chatcard__when">{{ when(chat.updatedAt) }}</span>
          </button>

          <!--
            An overlay, not a column — the same arrangement the job card uses,
            and for the same reason: the name is clamped, so a control that
            takes its width out of the row on hover re-wraps the name and grows
            the card under the hand reaching for it.
          -->
          <span class="chatcard__tools">
            <button
              v-tip="$t('chats.discard')"
              type="button"
              class="chatcard__tool focus-fill"
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
.chats {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.chats__note {
  padding: var(--gap-loose) var(--gap-section);
  opacity: 0.55;
  line-height: 1.5;
}

.chats__list {
  display: flex;
  flex-direction: column;
  gap: var(--gap-hair);
  margin: 0;
  padding: 0 var(--gap) var(--gap);
  list-style: none;
}

/*
 * The same container a job card is.
 *
 * Not a resemblance — the same object: a thing that ran, has a name you can
 * change, and can be thrown away. It had drifted into something else, with a
 * sparkle glyph on every row saying "this is a chat" in a list of nothing but
 * chats, a trash can in the text flow, and one card in three growing a second
 * line of timestamps and standing taller than its neighbours.
 */
.chatcard {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: var(--control-radius);
  background: var(--fill-4);
  transition: background-color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .chatcard:hover {
    background: var(--fill-3);
  }
}

/* The one on screen, marked the way the open tab is: tonal, not outlined. */
.chatcard--open {
  background: var(--fill-2);
}

.chatcard__face {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap-hair);
  min-width: 0;
  /* The trailing room is the overlay's, always. */
  padding: var(--gap) calc(var(--hit-min) + var(--gap)) var(--gap) var(--gap);
  border-radius: var(--control-radius);
  text-align: start;
}

.chatcard__name {
  align-self: stretch;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* A question with a long identifier in it has nowhere else to break. */
  overflow-wrap: anywhere;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.35;
  min-height: calc(2 * 1.35em);
  color: var(--color-base-content);
}

/*
 * The editor stands exactly where the name stood — same width, same two lines
 * of height — so beginning to rename moves neither the card nor the list.
 */
.chatcard__field {
  align-self: stretch;
  min-width: 0;
  min-height: calc(2 * 1.35em);
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--color-primary);
  background: transparent;
  outline: none;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.35;
  color: var(--color-base-content);
}

/*
 * One time, not two.
 *
 * There were two — when it was last added to, and when it started — printed
 * side by side, which wrapped onto a second line on any card narrow enough or
 * old enough and made that card taller than the rest of the column. The second
 * fact is the weaker of the two by a distance: a list of conversations is
 * ordered by the first one, and nobody looks down it for when something began.
 */
.chatcard__when {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.chatcard__tools {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  display: flex;
  align-items: flex-start;
  /* The same inset from the top as from the right. */
  padding: var(--gap) var(--gap) 0 0;
  opacity: 0;
  transition: opacity 140ms var(--ease-out);
}

/* On focus as well as hover: a control only a pointer can reach is not one. */
.chatcard:hover .chatcard__tools,
.chatcard:focus-within .chatcard__tools {
  opacity: 1;
}

.chatcard__tool {
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

.chatcard:hover .chatcard__tool,
.chatcard:focus-within .chatcard__tool {
  transform: none;
}

@media (hover: hover) and (pointer: fine) {
  .chatcard__tool:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }
}

/* The press, not the release. */
.chatcard__tool:active {
  background: var(--fill-1);
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .chatcard,
  .chatcard__tools,
  .chatcard__tool {
    transition: none;
  }

  .chatcard__tool {
    transform: none;
  }
}
</style>
