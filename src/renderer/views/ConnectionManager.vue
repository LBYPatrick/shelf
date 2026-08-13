<script setup lang="ts">
/**
 * The start screen.
 *
 * One task, centred, with nothing else competing for attention. The first thing
 * offered is a paste field, because most people arrive with a connection string
 * already on the clipboard and disassembling it into six fields by hand is work
 * the interface can do instead.
 *
 * Saved connections are cards rather than a list: an engine mark and a label
 * colour identify a database faster than reading its name does.
 */
import { computed, onMounted, ref } from 'vue';
import type { SaveConnectionInput, SavedConnection } from '@shared/connections';
import { looksLikeUrl, parseConnectionUrl, type ParsedConnection } from '@shared/connectionUrl';
import ConnectionCard from '../components/connection/ConnectionCard.vue';
import ConnectionEditor from '../components/connection/ConnectionEditor.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import PressButton from '../components/ui/PressButton.vue';
import SettingsSheet from '../components/settings/SettingsSheet.vue';
import { useConnections } from '../stores/connections';

const connections = useConnections();

const search = ref('');
const editing = ref<SavedConnection | null | undefined>(undefined);
const seed = ref<ParsedConnection | undefined>(undefined);
const opening = ref<string | null>(null);
const sampling = ref(false);
const settingsOpen = ref(false);

async function openSample(): Promise<void> {
  sampling.value = true;
  try {
    await connections.exploreSample();
  } finally {
    sampling.value = false;
  }
}

onMounted(() => void connections.refresh());

const parsed = computed(() =>
  looksLikeUrl(search.value) ? parseConnectionUrl(search.value) : undefined
);

/** Typing filters the saved connections; pasting a URL offers to open it. */
const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle || parsed.value) return connections.saved;

  return connections.saved.filter((connection) => {
    const config = connection.config;
    const haystack = [
      connection.name,
      config.host,
      config.database,
      config.filePath,
      connection.engine,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
});

const empty = computed(() => connections.saved.length === 0);

function startNew(): void {
  seed.value = undefined;
  editing.value = null;
}

/** A pasted URL goes straight into the editor with its fields already filled. */
function useParsed(): void {
  if (!parsed.value) return;
  seed.value = parsed.value;
  editing.value = null;
}

async function open(connection: SavedConnection): Promise<void> {
  opening.value = connection.id;
  try {
    await connections.connect(connection);
  } finally {
    opening.value = null;
  }
}

async function saved(connection: SavedConnection, connect: boolean): Promise<void> {
  editing.value = undefined;
  search.value = '';
  if (connect) await open(connection);
}

async function remove(connection: SavedConnection): Promise<void> {
  await connections.remove(connection.id);
}

const failure = computed(() =>
  connections.status.state === 'failed' ? connections.status.message : null
);

function draftFor(input: SaveConnectionInput): void {
  void input;
}
</script>

<template>
  <div class="manager">
    <!-- Drag surface and traffic-light clearance, with no title bar. -->
    <div class="manager__chrome drag-region">
      <button
        class="manager__settings no-drag"
        :aria-label="$t('action.settings')"
        :title="$t('action.settings')"
        @click="settingsOpen = true"
      >
        <AppIcon name="settings" />
      </button>
    </div>

    <div class="manager__inner">
      <header class="hero">
        <h1 class="hero__title">
          {{ $t('app.name') }}
        </h1>
        <p class="hero__sub">
          {{ $t('app.tagline') }}
        </p>

        <div class="finder">
          <svg
            class="finder__icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle
              cx="7"
              cy="7"
              r="4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M10.5 10.5 L14 14"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>

          <input
            v-model="search"
            class="finder__input"
            type="text"
            :placeholder="$t('start.search')"
            spellcheck="false"
            autocomplete="off"
            :aria-label="$t('start.searchLabel')"
            @keydown.enter="parsed ? useParsed() : undefined"
          >

          <button
            v-if="search"
            class="finder__clear"
            :aria-label="$t('action.clear')"
            @click="search = ''"
          >
            ✕
          </button>
        </div>

        <Transition name="rise">
          <button
            v-if="parsed"
            class="parsed"
            @click="useParsed"
          >
            <span class="parsed__label">{{ $t('start.recognised') }}</span>
            <span class="parsed__name">{{ parsed.suggestedName }}</span>
            <span class="parsed__engine">{{ parsed.engine }}</span>
            <span class="parsed__go">{{ $t('start.setUp') }} ↩</span>
          </button>
        </Transition>
      </header>

      <Transition name="rise">
        <p
          v-if="failure"
          class="failure"
          role="alert"
        >
          {{ failure }}
        </p>
      </Transition>

      <section
        v-if="!empty"
        class="grid"
      >
        <TransitionGroup name="card">
          <ConnectionCard
            v-for="(connection, index) in filtered"
            :key="connection.id"
            :connection="connection"
            :busy="opening === connection.id"
            :style="{ '--index': index }"
            class="grid__item"
            @open="open(connection)"
            @edit="
              seed = undefined;
              editing = connection;
            "
            @remove="remove(connection)"
          />
        </TransitionGroup>

        <button
          key="new"
          class="tile"
          @click="startNew"
        >
          <span
            class="tile__plus"
            aria-hidden="true"
          >+</span>
          <span>{{ $t('start.newConnection') }}</span>
        </button>
      </section>

      <section
        v-else
        class="grid"
      >
        <button
          class="tile"
          type="button"
          @click="startNew"
        >
          <span
            class="tile__plus"
            aria-hidden="true"
          >+</span>
          <span>{{ $t('start.newConnection') }}</span>
        </button>
      </section>

      <!--
        The way in for someone who has nothing to connect to yet. It is a real
        feature rather than a demo hook: the same sample database backs the
        screenshots and the tests.
      -->
      <section class="sample">
        <div class="sample__text">
          <h2 class="sample__title">
            {{ $t('start.sampleTitle') }}
          </h2>
          <p class="sample__sub">
            {{ $t('start.sampleBody') }}
          </p>
        </div>

        <PressButton
          variant="glass"
          :disabled="sampling"
          @click="openSample"
        >
          {{ sampling ? $t('start.sampleOpening') : $t('start.sampleAction') }}
        </PressButton>
      </section>

      <p
        v-if="!connections.keyringAvailable"
        class="keyring"
      >
        {{ $t('start.noKeyring') }}
      </p>
    </div>

    <SettingsSheet v-model="settingsOpen" />

    <ConnectionEditor
      v-if="editing !== undefined"
      :editing="editing"
      :seed="seed"
      :keyring-available="connections.keyringAvailable"
      @close="editing = undefined"
      @saved="saved"
      @draft="draftFor"
    />
  </div>
</template>

<style scoped>
/*
 * The block is centred in the window rather than pinned near the top. With two
 * saved connections the old layout left two thirds of a large window empty
 * below the content, which reads as an unfinished page rather than a calm one.
 *
 * `justify-content: center` with `margin: auto` on the inner block centres it
 * when the content is short and lets it scroll normally once it is tall.
 */
.manager {
  position: relative;
  height: 100%;
  overflow-y: auto;
  display: flex;
}

.manager__chrome {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: 2;
  height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-inline: var(--gap);
}

.manager__settings {
  display: grid;
  place-items: center;
  width: 1.875rem;
  height: 1.875rem;
  border-radius: 0.5rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.manager__settings:active {
  transform: scale(0.92);
}

@media (hover: hover) and (pointer: fine) {
  .manager__settings:hover {
    background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
    color: var(--color-base-content);
  }
}

.manager__inner {
  width: 100%;
  max-width: 52rem;
  margin: auto;
  padding: 3.5rem var(--gap-section) var(--gap-section);
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  text-align: center;
}

/* Large text wants negative tracking; at this size the default reads loose. */
.hero__title {
  font-size: 2.25rem;
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.hero__sub {
  font-size: 0.875rem;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
  margin-bottom: var(--gap-loose);
}

.finder {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-base-100) 78%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid color-mix(in oklab, var(--color-base-content) 11%, transparent);
  box-shadow:
    inset 0 1px 2px oklch(0% 0 0 / 0.04),
    0 1px 2px oklch(0% 0 0 / 0.04);
  transition:
    border-color var(--t-hover) var(--ease-out),
    box-shadow var(--t-hover) var(--ease-out);
}

.finder:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow:
    inset 0 1px 2px oklch(0% 0 0 / 0.02),
    0 0 0 4px color-mix(in oklab, var(--color-primary) 18%, transparent);
}

.finder__icon {
  width: 1rem;
  height: 1rem;
  margin-inline-start: var(--gap-section);
  color: color-mix(in oklab, var(--color-base-content) 38%, transparent);
  flex: 0 0 auto;
}

.finder__input {
  flex: 1;
  min-width: 0;
  height: 3rem;
  padding-inline: var(--gap);
  border: 0;
  background: transparent;
  color: var(--color-base-content);
  font-size: 0.9375rem;
}

/* The wrapper owns the focus ring; the input drawing its own gives two. */
.finder__input:focus,
.finder__input:focus-visible {
  outline: none;
}

.finder__input::placeholder {
  color: color-mix(in oklab, var(--color-base-content) 36%, transparent);
}

.finder__clear {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  margin-inline-end: var(--gap);
  border-radius: 999px;
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.parsed {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  margin-top: var(--gap);
  padding: var(--gap) var(--gap-loose);
  border-radius: 0.875rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 40%, transparent);
  background: color-mix(in oklab, var(--color-primary) 10%, transparent);
  text-align: start;
  transition: background-color var(--t-hover) var(--ease-out);
}

.parsed__label {
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-primary-text, var(--color-primary));
}

.parsed__name {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parsed__engine {
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 22%, transparent);
  font-size: 0.625rem;
}

.parsed__go {
  margin-inline-start: auto;
  font-size: 0.6875rem;
  color: var(--color-primary-text, var(--color-primary));
  white-space: nowrap;
}

.failure {
  padding: var(--gap) var(--gap-loose);
  border-radius: 0.75rem;
  background: color-mix(in oklab, var(--color-error) 14%, transparent);
  font-size: 0.75rem;
}

.grid {
  display: grid;
  /* Three across on a wide window, so two connections do not stretch into
     banners the width of the screen. */
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: var(--gap);
}

/*
 * Cards cascade in rather than appearing together. The delay is capped so a
 * long list never makes the screen feel slow to settle.
 */
.grid__item {
  animation: rise-in 320ms var(--ease-out) backwards;
  animation-delay: calc(min(var(--index) * 40ms, 320ms));
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap);
  min-height: 4.5rem;
  border-radius: 1rem;
  border: 1px dashed color-mix(in oklab, var(--color-base-content) 20%, transparent);
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  font-size: 0.8125rem;
  transition:
    border-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.tile--wide {
  width: 100%;
  min-height: 5.5rem;
}

.tile__plus {
  font-size: 1.125rem;
  line-height: 1;
}

.tile:active {
  transform: scale(0.985);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-loose);
}

.empty__text {
  font-size: 0.8125rem;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
  text-align: center;
}

.sample {
  display: flex;
  align-items: center;
  gap: var(--gap-section);
  padding: var(--gap-loose) var(--gap-section);
  border-radius: 1rem;
  border: 1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent);
  background: color-mix(in oklab, var(--color-base-100) 55%, transparent);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  backdrop-filter: blur(16px) saturate(160%);
}

.sample__text {
  flex: 1;
  min-width: 0;
}

.sample__title {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.006em;
}

.sample__sub {
  font-size: 0.75rem;
  line-height: 1.45;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.keyring {
  text-align: center;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-warning) 90%, var(--color-base-content));
}

/* Enter and exit along the same path, so the two read as one movement. */
.rise-enter-active,
.rise-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.card-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
  position: absolute;
}

.card-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.card-move {
  transition: transform var(--t-sheet) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .finder__clear:hover {
    background: color-mix(in oklab, var(--color-base-content) 12%, transparent);
    color: var(--color-base-content);
  }

  .parsed:hover {
    background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  }

  .tile:hover {
    border-color: color-mix(in oklab, var(--color-primary) 50%, transparent);
    background: color-mix(in oklab, var(--color-primary) 6%, transparent);
    color: var(--color-primary-text, var(--color-primary));
  }
}

@media (prefers-reduced-motion: reduce) {
  .grid__item {
    animation: none;
  }

  .rise-enter-from,
  .rise-leave-to {
    transform: none;
  }

  .tile:active {
    transform: none;
  }
}
</style>
