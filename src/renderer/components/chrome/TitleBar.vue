<script setup lang="ts">
/**
 * The window's top edge.
 *
 * A frameless title bar is otherwise a dead strip of pixels, so it carries the
 * thing you most need to know at a glance: which database you are pointed at.
 * The connection's own colour is on the pill, which is what stops a query from
 * being run against production by mistake.
 */
import { onUnmounted, ref } from 'vue';
import { engineDescriptor } from '@shared/engines';
import { usePlatform } from '../../composables/usePlatform';
import { useConnections } from '../../stores/connections';
import AppIcon from '../ui/AppIcon.vue';

const platform = usePlatform();
const connections = useConnections();

const maximized = ref(false);

void window.shelf.window.isMaximized().then((value) => (maximized.value = value));
const stopListening = window.shelf.window.onMaximizedChanged(
  (value) => (maximized.value = value)
);
onUnmounted(stopListening);
</script>

<template>
  <header
    class="bar drag-region"
    :style="{ paddingInlineStart: `max(var(--gap), ${platform.info.windowControlsInset}px)` }"
    @dblclick="window.shelf.window.toggleMaximize()"
  >
    <Transition name="pill">
      <button
        v-if="connections.active"
        class="pill no-drag"
        :style="
          connections.active.labelColor
            ? { '--label': connections.active.labelColor }
            : undefined
        "
        :title="`${connections.active.version} — click to disconnect`"
        @click="connections.disconnect()"
      >
        <span
          class="pill__mark"
          :style="{ '--engine-hue': engineDescriptor(connections.active.engine).hue }"
          aria-hidden="true"
        >{{ engineDescriptor(connections.active.engine).mark }}</span>

        <span class="pill__name">{{ connections.active.name }}</span>

        <span
          v-if="connections.active.readOnly"
          class="pill__flag"
        >read-only</span>
      </button>

      <span
        v-else
        class="wordmark"
      >Shelf</span>
    </Transition>

    <div class="bar__spacer" />

    <!-- macOS draws its own controls; every other platform gets ours. -->
    <div
      v-if="!platform.info.nativeWindowControls"
      class="no-drag controls"
    >
      <button
        class="control"
        aria-label="Minimize"
        @click="window.shelf.window.minimize()"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M0 5h10"
            stroke="currentColor"
          />
        </svg>
      </button>
      <button
        class="control"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        @click="window.shelf.window.toggleMaximize()"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            fill="none"
            stroke="currentColor"
          />
        </svg>
      </button>
      <button
        class="control control--close"
        aria-label="Close"
        @click="window.shelf.window.close()"
      >
        <AppIcon
          name="close"
          :size="10"
        />
      </button>
    </div>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: var(--gap);
  flex-shrink: 0;
  height: var(--titlebar-h);
  padding-inline-end: 0;
  /* No fill and no border: the window's own material shows through, and the
     content beneath scrolls under it rather than stopping at a line. */
  background: transparent;
}

.bar__spacer {
  flex: 1;
}

.wordmark {
  font-size: 0.75rem;
  font-weight: 550;
  letter-spacing: -0.005em;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.pill {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--hit-min);
  padding-inline: 4px var(--gap);
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--color-base-content) 10%, transparent);
  background: color-mix(in oklab, var(--color-base-100) 62%, transparent);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  backdrop-filter: blur(16px) saturate(180%);
  transition:
    background-color var(--t-hover) var(--ease-out),
    border-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.pill:active {
  transform: scale(0.97);
}

/* The connection's colour, on the mark you look at first. */
.pill__mark {
  display: grid;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.375rem;
  font-size: 0.5rem;
  font-weight: 700;
  color: oklch(99% 0 0);
  background: var(--label, oklch(58% 0.16 var(--engine-hue)));
}

.pill__name {
  font-size: 0.75rem;
  font-weight: 500;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill__flag {
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 30%, transparent);
  font-size: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.controls {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.control {
  display: grid;
  place-items: center;
  width: 2.75rem;
  color: var(--color-base-content);
  opacity: 0.65;
  transition:
    background-color var(--t-press) var(--ease-out),
    opacity var(--t-press) var(--ease-out);
}

.pill-enter-active,
.pill-leave-active {
  transition:
    opacity var(--t-pop) var(--ease-out),
    transform var(--t-pop) var(--ease-out);
}

.pill-enter-from,
.pill-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (hover: hover) and (pointer: fine) {
  .pill:hover {
    background: color-mix(in oklab, var(--color-base-100) 85%, transparent);
    border-color: color-mix(in oklab, var(--color-base-content) 18%, transparent);
  }

  .control:hover {
    background: color-mix(in oklab, var(--color-base-content) 10%, transparent);
    opacity: 1;
  }

  .control--close:hover {
    background: var(--color-error);
    color: var(--color-error-content);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pill:active {
    transform: none;
  }

  .pill-enter-from,
  .pill-leave-to {
    transform: none;
  }
}
</style>
