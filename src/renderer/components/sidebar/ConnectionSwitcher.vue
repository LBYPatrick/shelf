<script setup lang="ts">
/**
 * Which database you are pointed at, at the top of the sidebar.
 *
 * It sits here rather than in a title bar because this is where the rest of the
 * database's structure lives — the connection is the root of that tree, not a
 * separate piece of window furniture. On macOS the traffic lights float over
 * this area, so the row leaves room for them.
 */
import { computed } from 'vue';
import { engineDescriptor } from '@shared/engines';
import { usePlatform } from '../../composables/usePlatform';
import { useConnections } from '../../stores/connections';
import AppIcon from '../ui/AppIcon.vue';

const platform = usePlatform();
const connections = useConnections();

const engine = computed(() =>
  connections.active ? engineDescriptor(connections.active.engine) : undefined
);

/**
 * The engine name, unless the connection is already called that — repeating a
 * word directly beneath itself tells the reader nothing.
 */
const subtitle = computed(() => {
  const name = connections.active?.name;
  const label = engine.value?.name;
  return label && label !== name ? label : undefined;
});
</script>

<template>
  <div
    class="switcher drag-region"
    :style="{
      paddingTop: platform.info.nativeWindowControls ? 'var(--rail-top)' : 'var(--gap-tight)',
    }"
  >
    <button
      v-if="connections.active"
      class="switcher__button no-drag"
      :style="
        connections.active.labelColor ? { '--label': connections.active.labelColor } : undefined
      "
      :title="`${connections.active.version} — ${$t('workspace.disconnectHint')}`"
      @click="connections.disconnect()"
    >
      <span
        class="switcher__mark"
        :style="{ '--engine-hue': engine?.hue ?? 250 }"
        aria-hidden="true"
      >{{ engine?.mark }}</span>

      <span class="switcher__text">
        <span class="switcher__name">{{ connections.active.name }}</span>
        <span
          v-if="subtitle"
          class="switcher__engine"
        >{{ subtitle }}</span>
      </span>

      <span
        v-if="connections.active.readOnly"
        class="switcher__flag"
      >{{
        $t('workspace.readOnly')
      }}</span>

      <AppIcon
        class="switcher__chevron"
        name="chevron"
        :size="12"
      />
    </button>
  </div>
</template>

<style scoped>
.switcher {
  flex: 0 0 auto;
  padding-inline: var(--gap-tight);
  padding-bottom: var(--gap-tight);
}

.switcher__button {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  height: var(--header-h);
  padding-inline: var(--gap) var(--gap-tight);
  border-radius: 0.625rem;
  text-align: start;
  transition:
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.switcher__button:active {
  transform: scale(0.985);
}

.switcher__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1.375rem;
  height: 1.375rem;
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

.switcher__engine {
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switcher__flag {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.switcher__chevron {
  flex: 0 0 auto;
  color: color-mix(in oklab, var(--color-base-content) 32%, transparent);
  transform: rotate(90deg);
}

@media (hover: hover) and (pointer: fine) {
  .switcher__button:hover {
    background: var(--fill-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .switcher__button:active {
    transform: none;
  }
}
</style>
