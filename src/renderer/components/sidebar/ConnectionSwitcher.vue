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
import { useConnections } from '../../stores/connections';

/**
 * The sheets are the workspace's, not this row's.
 *
 * Both of them are reachable from the command palette as well as from here, and
 * a surface owned by whichever control happens to open it can only ever be
 * opened by that one. The row asks; the window answers.
 */
const emit = defineEmits<{ diagnose: []; 'new-connection': [] }>();

const connections = useConnections();
const { t } = useTranslation();

const engine = computed(() =>
  connections.active ? engineDescriptor(connections.active.engine) : undefined
);

/**
 * What this connection is, in as few words as are true.
 *
 * Every driver's version string already names its engine — `PostgreSQL 16.2`,
 * `SQLite 3.45` — so putting the engine's own label beside it printed the word
 * twice. And a server that will not say which version it is comes back as
 * "PostgreSQL unknown", which is a sentence with a shrug on the end: the engine
 * alone is the honest version of it.
 */
const detail = computed(() => {
  const version = (connections.active?.version ?? '').replace(/\s+unknown$/i, '').trim();
  return version || engine.value?.name || '';
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

/**
 * Where else you could be, then what you can do here.
 *
 * The menu held one item — "Disconnect from Sample data" — which is a strange
 * thing for the only menu attached to the connection to say, and it said the
 * connection's name twice: once in the row that opened the menu and again in
 * the item. The row is the subject; the item is the verb.
 *
 * The others are the questions a person actually has at this corner of the
 * window. *Somewhere else* is the commonest by a distance, and it was a
 * three-step round trip through disconnecting and the start screen. *A new one*
 * is the same sheet the start screen opens, over the workspace, because there
 * is no reason saving a connection should cost you the one you are in. And
 * *is this thing well* is the question that sends people looking for a log.
 */
const others = computed(() =>
  connections.saved
    .filter((connection) => connection.id !== connections.active?.id)
    .slice()
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
);

/**
 * Long enough to hold what anybody switches between, short enough that the menu
 * does not become the start screen with a scrollbar. Past this the row says how
 * many are not shown and sends you to the list that holds all of them.
 */
const SHOWN = 6;

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = others.value.slice(0, SHOWN).map((connection) => ({
    id: `open:${connection.id}`,
    label: connection.name,
    icon: 'database',
  }));

  if (others.value.length > SHOWN) {
    items.push({
      id: 'all',
      label: t('connection.andMore', { count: others.value.length - SHOWN }),
      icon: 'more',
    });
  }

  items.push({
    id: 'new',
    label: t('connection.new'),
    icon: 'plus',
    startsGroup: items.length > 0,
  });

  items.push({
    id: 'diagnose',
    label: t('diagnose.action'),
    icon: 'chart',
    startsGroup: true,
  });

  items.push({ id: 'disconnect', label: t('action.disconnect'), icon: 'close' });

  return items;
});

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
  if (id === 'disconnect') {
    void connections.disconnect();
    return;
  }

  if (id === 'diagnose') {
    emit('diagnose');
    return;
  }

  if (id === 'new') {
    emit('new-connection');
    return;
  }

  // Everything past the list goes to the list, which is the start screen — the
  // one place every saved connection is, with its search.
  if (id === 'all') {
    void connections.disconnect();
    return;
  }

  const openId = id.startsWith('open:') ? id.slice('open:'.length) : '';
  const target = connections.saved.find((connection) => connection.id === openId);
  if (target) void connections.connect(target);
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
      <!--
        The badge sits in a box exactly as wide as the rail.
        ──────────────────────────────────────────────────
        Not centred in the row: the row is as wide as the columns are, and the
        columns are what the sidebar toggle animates — so a centred badge slid
        left across a quarter of a second every time the sidebar closed, while
        the five icons under it stayed exactly where they were. Given the
        rail's own width it is on the rail's own centre line at every frame of
        that animation, and the collapse moves nothing.
      -->
      <span class="switcher__slot">
        <span
          class="switcher__mark"
          :style="{ '--engine-hue': engine?.hue ?? 250 }"
          aria-hidden="true"
        >{{ engine?.mark }}</span>
      </span>

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
  /*
   * The same inset the panel header below uses, so the head of the sidebar is
   * one block rather than two that nearly line up. It was `--gap-tight` all
   * round against the header's `--gap`, which put the search field a couple of
   * pixels further in than the buttons above it.
   */
  padding: var(--gap-tight) var(--gap-tight) 0 0;
}

.switcher__row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--header-h);
  padding-inline: 0 var(--gap-tight);
  border-start-end-radius: 0.625rem;
  border-end-end-radius: 0.625rem;
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

.switcher__slot {
  display: grid;
  place-items: center;
  flex: 0 0 var(--rail-w);
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

/*
 * At rail width the row is the mark and nothing else.
 *
 * Everything but the badge is hidden rather than allowed to clip, because a
 * name cut off mid-word reads as a rendering fault where an icon alone reads as
 * a deliberate small state — and the row is still the disclosure, so the menu
 * that switches or leaves the connection is one click away either way.
 */
.leftpanel--tight .switcher__row {
  padding-inline: 0;
}

.leftpanel--tight .switcher__text,
.leftpanel--tight .switcher__chevron {
  display: none;
}

.switcher__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  /* Starts where the sidebar's own content starts, one column over. */
  margin-inline: var(--gap-tight) var(--gap);
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
