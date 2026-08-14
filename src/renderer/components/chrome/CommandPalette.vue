<script setup lang="ts">
/**
 * The command palette.
 *
 * It opens on recent tabs rather than an empty list, because the most likely
 * thing you want is something you were just looking at. Matching is subsequence
 * rather than substring, so "albsum" finds "album_summary" — the way people
 * actually type when they are aiming rather than reading.
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { Entity } from '@drivers/types';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useTabs } from '../../stores/tabs';
import { useTranslation } from 'i18next-vue';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ openSettings: [] }>();

const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();
const { t } = useTranslation();

interface Command {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly group: string;
  readonly run: () => void;
}

const query = ref('');
const selected = ref(0);
const input = ref<HTMLInputElement>();

const actions = computed<Command[]>(() => [
  {
    id: 'action:new-query',
    label: t('palette.newQuery'),
    group: t('palette.actions'),
    detail: '⌘T',
    run: () => tabs.openQuery(),
  },
  {
    id: 'action:erd',
    label: t('palette.openDiagram'),
    group: t('palette.actions'),
    run: () => tabs.openErd(),
  },
  {
    id: 'action:refresh',
    label: t('palette.refreshSchema'),
    group: t('palette.actions'),
    detail: 'F5',
    run: () => void entities.refresh(),
  },
  {
    id: 'action:settings',
    label: t('action.settings'),
    group: t('palette.actions'),
    detail: '⌘,',
    run: () => emit('openSettings'),
  },
  {
    id: 'action:disconnect',
    label: t('palette.disconnectFrom', { name: connections.active?.name ?? '' }),
    group: t('palette.actions'),
    run: () => void connections.disconnect(),
  },
]);

function entityCommands(entity: Entity): Command[] {
  const ref_ = { name: entity.name, ...(entity.schema ? { schema: entity.schema } : {}) };
  const key = entity.schema ? `${entity.schema}.${entity.name}` : entity.name;

  return [
    {
      id: `data:${key}`,
      label: entity.name,
      detail: entity.schema ?? entity.kind,
      group: connections.active?.capabilities.nouns.entity ?? 'Tables',
      run: () => tabs.openEntity('table', ref_),
    },
  ];
}

const candidates = computed<Command[]>(() => [
  ...tabs.tabs.map((tab) => ({
    id: `tab:${tab.id}`,
    label: tab.title,
    detail: tab.subtitle ?? tab.kind,
    group: t('palette.openTabs'),
    run: () => tabs.focus(tab.id),
  })),
  ...entities.entities.flatMap(entityCommands),
  ...actions.value,
]);

/** Subsequence match, scored so earlier and tighter matches rank higher. */
function score(text: string, needle: string): number | null {
  if (!needle) return 0;

  const haystack = text.toLowerCase();
  const pattern = needle.toLowerCase();

  let index = 0;
  let previous = -1;
  let points = 0;

  for (const char of pattern) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return null;

    // Adjacent characters are worth more than scattered ones, and a match at a
    // word boundary is worth more than one in the middle.
    if (found === previous + 1) points += 3;
    if (found === 0 || /[\s_.-]/.test(haystack[found - 1] ?? '')) points += 2;

    previous = found;
    index = found + 1;
  }

  // Shorter targets win ties: "album" should beat "album_summary" for "album".
  return points - haystack.length * 0.01;
}

const matches = computed(() => {
  const needle = query.value.trim();

  if (!needle) {
    // Empty means "where was I", not "everything".
    return candidates.value
      .filter((command) => command.group === t('palette.openTabs'))
      .slice(0, 8);
  }

  return candidates.value
    .map((command) => ({ command, points: score(command.label, needle) }))
    .filter((entry): entry is { command: Command; points: number } => entry.points !== null)
    .sort((a, b) => b.points - a.points)
    .slice(0, 40)
    .map((entry) => entry.command);
});

/**
 * The same list, in sections.
 *
 * Every row used to carry its own group name on the right — "OPEN TABS" printed
 * once per row, five times over, for a heading that changes twice in the list.
 * The sections keep the flat `matches` array as the source of truth for
 * selection and keyboard movement, so the index a row reports is still its
 * index in that array.
 */
const sections = computed(() => {
  const groups: { group: string; items: { command: Command; index: number }[] }[] = [];

  matches.value.forEach((command, index) => {
    const last = groups[groups.length - 1];
    if (last?.group === command.group) last.items.push({ command, index });
    else groups.push({ group: command.group, items: [{ command, index }] });
  });

  return groups;
});

watch(matches, () => (selected.value = 0));

watch(open, async (isOpen) => {
  if (!isOpen) return;
  query.value = '';
  selected.value = 0;
  await nextTick();
  input.value?.focus();
});

function move(delta: number): void {
  const count = matches.value.length;
  if (count === 0) return;
  selected.value = (selected.value + delta + count) % count;
}

function commit(): void {
  const command = matches.value[selected.value];
  if (!command) return;
  open.value = false;
  command.run();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="open"
        class="scrim"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('palette.label')"
        @click.self="open = false"
      >
        <div class="palette surface-sheet mat-edge-top">
          <input
            ref="input"
            v-model="query"
            class="palette__input"
            type="text"
            :placeholder="$t('palette.placeholder')"
            spellcheck="false"
            autocomplete="off"
            role="combobox"
            :aria-expanded="matches.length > 0"
            :aria-controls="matches.length ? 'palette-results' : undefined"
            :aria-activedescendant="matches.length ? `palette-option-${selected}` : undefined"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="commit"
            @keydown.esc.prevent="open = false"
          >

          <!--
            The list is only in the DOM when it has something in it, so the
            input's `aria-controls` and `aria-activedescendant` have to come and
            go with it — pointing either at an element that does not exist is
            what a screen reader reports as a broken control.
          -->
          <div
            v-if="matches.length"
            id="palette-results"
            class="palette__list"
            role="listbox"
          >
            <template
              v-for="section in sections"
              :key="section.group"
            >
              <p
                class="palette__section type-label"
                role="presentation"
              >
                {{ section.group }}
              </p>
              <div
                v-for="entry in section.items"
                :id="`palette-option-${entry.index}`"
                :key="entry.command.id"
                class="palette__item"
                :class="{ 'palette__item--on': entry.index === selected }"
                role="option"
                :aria-selected="entry.index === selected"
                @mouseenter="selected = entry.index"
                @click="commit()"
              >
                <span class="palette__label">{{ entry.command.label }}</span>
                <span
                  v-if="entry.command.detail"
                  class="palette__detail"
                >{{
                  entry.command.detail
                }}</span>
              </div>
            </template>
          </div>

          <p
            v-else
            class="palette__empty"
          >
            {{ query ? $t('palette.nothingMatches') : $t('palette.openSomething') }}
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: start center;
  padding-top: 14vh;
}

.palette {
  width: min(34rem, calc(100vw - 4rem));
  border-radius: 1rem;
  overflow: hidden;
  box-shadow:
    0 1px 2px oklch(0% 0 0 / 0.08),
    0 24px 64px oklch(0% 0 0 / 0.28);
}

.palette__input {
  width: 100%;
  height: 3rem;
  padding-inline: var(--gap-section);
  border: 0;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.9375rem;
}

/*
 * No ring. The input is focused the instant the palette opens and is the only
 * thing in it that can take focus, so the global focus outline had nothing to
 * distinguish — and being clipped by the panel's own `overflow: hidden` it drew
 * as a single accent line across the palette rather than a ring around
 * anything.
 */
.palette__input:focus-visible {
  outline: none;
}

.palette__input::placeholder {
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
}

.palette__list {
  max-height: 22rem;
  overflow-y: auto;
  border-top: 1px solid var(--separator);
  padding: var(--gap-tight) var(--gap-tight) var(--gap);
}

.palette__section {
  padding: var(--gap) var(--gap) var(--gap-hair);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  text-transform: uppercase;
}

.palette__section:first-child {
  padding-top: var(--gap-tight);
}

.palette__item {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: var(--hit-min);
  padding-inline: var(--gap);
  border-radius: var(--radius-field);
  font-size: 0.8125rem;
}

/*
 * A tint, not the accent at full strength.
 *
 * A saturated bar across a glass panel is the loudest thing on screen for a
 * row you are merely hovering past, and it takes the sub-label down with it:
 * the detail is drawn at 0.6 opacity, which over white-on-accent lands well
 * under the contrast floor. The tonal surface is the same one a selected row
 * wears everywhere else in the app.
 */
.palette__item--on {
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.palette__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette__detail {
  margin-inline-start: auto;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, currentColor 60%, transparent);
}

.palette__empty {
  padding: var(--gap-section);
  text-align: center;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  border-top: 1px solid var(--separator);
}

.palette-enter-active,
.palette-leave-active {
  transition: opacity 180ms ease-out;
}

.palette-enter-active .palette,
.palette-leave-active .palette {
  transition:
    transform 280ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 180ms ease-out;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}

.palette-enter-from .palette,
.palette-leave-to .palette {
  transform: translateY(-10px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .palette-enter-from .palette,
  .palette-leave-to .palette {
    transform: none;
  }
}
</style>
