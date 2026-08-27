<script setup lang="ts">
/**
 * The head of the sidebar: which database you are in, and the two things you
 * start by doing in it.
 *
 * It sits here rather than in a title bar because this is where the rest of the
 * database lives — the connection is the root of that tree, not a separate
 * piece of window furniture.
 *
 * **The row was a disconnect button.** Clicking your own connection name closed
 * the connection, and the only thing that said so was an OS tooltip after a
 * second and a half — the exact affordance this codebase bans everywhere else,
 * carrying the one action in the window you least want taken by accident. The
 * chevron said "menu" and did something else. So the row is a disclosure now,
 * it opens a menu, and leaving is an item in it with a name.
 *
 * **What it says has an order.** Identity first and largest, because "which
 * database am I pointed at" is the question this corner exists to answer.
 * State second and quiet: live or connecting, the engine and its version, and
 * whether writes are refused. Actions last, because they are what you do once
 * the first two have told you where you are.
 */
import { computed, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { engineDescriptor } from '@shared/engines';
import AppIcon from '../ui/AppIcon.vue';
import ContextMenu, { type MenuItem } from '../ui/ContextMenu.vue';
import PressButton from '../ui/PressButton.vue';
import { useConnections } from '../../stores/connections';
import { useTabs } from '../../stores/tabs';

const connections = useConnections();
const tabs = useTabs();
const { t } = useTranslation();

const engine = computed(() =>
  connections.active ? engineDescriptor(connections.active.engine) : undefined
);

/**
 * The engine and its version, as one line.
 *
 * The engine's name is dropped when the connection is already called that:
 * repeating a word directly beneath itself tells the reader nothing. The
 * version stays either way — it is the fact that decides whether a syntax is
 * available, and it was previously only in a tooltip.
 */
const detail = computed(() => {
  const active = connections.active;
  if (!active) return '';

  const label = engine.value?.name;
  const version = active.version && active.version !== 'unknown' ? active.version : '';
  return [label !== active.name ? label : '', version].filter(Boolean).join(' ');
});

/**
 * Live, arriving, or broken.
 *
 * The same three states the status bar shows, said again here because this is
 * where someone looks when they wonder whether the app is still talking to
 * anything. A dot rather than a word: it is beside the engine's name, and two
 * words there would push the version off the end.
 */
const state = computed<'live' | 'connecting' | 'failed'>(() => {
  if (connections.status.state === 'connecting') return 'connecting';
  if (connections.status.state === 'error') return 'failed';
  return 'live';
});

const menuOpen = ref(false);
const menuAt = ref({ x: 0, y: 0 });
const row = ref<HTMLElement>();

const menuItems = computed<MenuItem[]>(() => [
  {
    id: 'disconnect',
    label: t('palette.disconnectFrom', { name: connections.active?.name ?? '' }),
    icon: 'close',
  },
]);

/**
 * Under the row rather than at the pointer.
 *
 * A menu belonging to a control opens from that control, so the relationship
 * between the two is visible in where it appears — the same rule the select's
 * list follows.
 */
function openMenu(): void {
  const box = row.value?.getBoundingClientRect();
  if (box) menuAt.value = { x: box.left, y: box.bottom + 4 };
  menuOpen.value = true;
}

function onChoose(id: string): void {
  if (id === 'disconnect') void connections.disconnect();
}
</script>

<template>
  <div
    v-if="connections.active"
    class="switcher drag-region"
  >
    <button
      ref="row"
      class="switcher__row no-drag"
      :class="{ 'switcher__row--open': menuOpen }"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      :style="
        connections.active.labelColor ? { '--label': connections.active.labelColor } : undefined
      "
      @click="openMenu"
    >
      <span
        class="switcher__mark"
        :style="{ '--engine-hue': engine?.hue ?? 250 }"
        aria-hidden="true"
      >{{ engine?.mark }}</span>

      <span class="switcher__text">
        <span class="switcher__name">{{ connections.active.name }}</span>
        <span class="switcher__state">
          <span
            class="switcher__dot"
            :class="`switcher__dot--${state}`"
            aria-hidden="true"
          />
          <span class="switcher__detail">{{ detail }}</span>
          <!--
            Not a badge in the corner. "Read-only" is a fact about the
            connection, in the line that holds the facts about the connection —
            a pill floating away from the words it qualifies reads as a
            decoration rather than as part of the sentence.
          -->
          <span
            v-if="connections.active.readOnly"
            class="switcher__flag"
          >{{
            $t('workspace.readOnly')
          }}</span>
        </span>
      </span>

      <AppIcon
        class="switcher__chevron"
        :class="{ 'switcher__chevron--open': menuOpen }"
        name="chevron"
        :size="12"
      />
    </button>

    <!--
      The two things you start by doing.
      ──────────────────────────────────
      One filled and one tonal, not two filled: a bar with two accents in it has
      no primary action, it has two things shouting. Writing a query is what
      this app is for and it goes first; asking is the other way in, and sits
      beside it at the same size because it is a peer, not a footnote.
    -->
    <div class="switcher__actions">
      <PressButton
        class="switcher__action"
        variant="primary"
        @click="tabs.openQuery()"
      >
        <AppIcon
          name="query"
          :size="13"
        />
        <span>{{ $t('workspace.newQuery') }}</span>
      </PressButton>

      <PressButton
        class="switcher__action"
        variant="glass"
        @click="tabs.openChat()"
      >
        <AppIcon
          name="assistant"
          :size="13"
        />
        <span>{{ $t('assistant.newChat') }}</span>
      </PressButton>
    </div>

    <ContextMenu
      v-model="menuOpen"
      :items="menuItems"
      :at="menuAt"
      @choose="onChoose"
    />
  </div>
</template>

<style scoped>
.switcher {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  padding: var(--gap-tight);
}

.switcher__row {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  min-height: var(--header-h);
  padding-inline: var(--gap) var(--gap-tight);
  border-radius: 0.625rem;
  text-align: start;
  transition:
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.switcher__row:active {
  transform: scale(0.985);
}

/* Held open while its menu is, so the row and the menu read as one object. */
.switcher__row--open {
  background: var(--fill-3);
}

.switcher__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.4375rem;
  font-size: 0.5625rem;
  font-weight: 650;
  color: oklch(99% 0 0);
  background: var(
    --label,
    linear-gradient(
      145deg,
      oklch(64% 0.16 var(--engine-hue)),
      oklch(52% 0.17 var(--engine-hue))
    )
  );
}

.switcher__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  line-height: 1.25;
}

.switcher__name {
  font-size: 0.8125rem;
  font-weight: 550;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switcher__state {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
  min-width: 0;
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.switcher__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switcher__dot {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  margin-inline-end: 1px;
  border-radius: 999px;
  background: var(--color-success, oklch(72% 0.17 150));
}

.switcher__dot--connecting {
  background: var(--color-warning);
  animation: switcher-pulse 1.4s var(--ease-in-out) infinite;
}

.switcher__dot--failed {
  background: var(--color-error);
}

@keyframes switcher-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.switcher__flag {
  flex: 0 0 auto;
  padding-inline: 4px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.switcher__chevron {
  flex: 0 0 auto;
  color: color-mix(in oklab, var(--color-base-content) 32%, transparent);
  transform: rotate(90deg);
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.switcher__chevron--open {
  transform: rotate(-90deg);
}

/*
 * Equal halves. Neither is the afterthought, and a row where one button is
 * wider says one of them is the real one.
 */
.switcher__actions {
  display: flex;
  gap: var(--gap-tight);
}

.switcher__action {
  flex: 1 1 0;
  min-width: 0;
  justify-content: center;
}

@media (hover: hover) and (pointer: fine) {
  .switcher__row:hover {
    background: var(--fill-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .switcher__row:active {
    transform: none;
  }

  .switcher__chevron {
    transition: none;
  }

  .switcher__dot--connecting {
    animation: none;
    opacity: 1;
  }
}
</style>
