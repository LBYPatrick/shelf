<script setup lang="ts">
/**
 * A saved connection, as a card.
 *
 * The engine mark and the label colour do the identifying, so the difference
 * between staging and production is visible before you have read anything. The
 * card lifts on hover and yields on press: a thing you can pick up.
 */
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { SavedConnection } from '@shared/connections';
import { engineDescriptor } from '@shared/engines';

const props = defineProps<{ connection: SavedConnection; busy?: boolean }>();
defineEmits<{ open: []; edit: []; remove: [] }>();

const { t } = useTranslation();

const engine = computed(() => engineDescriptor(props.connection.engine));

/** What this connection actually points at, in one line. */
const subtitle = computed(() => {
  const config = props.connection.config;
  if (config.filePath) return config.filePath.split(/[\\/]/).slice(-2).join('/');
  if (config.host) {
    return config.database ? `${config.host}/${config.database}` : config.host;
  }
  return engine.value.name;
});

const lastUsed = computed(() => {
  const at = props.connection.lastUsedAt;
  if (!at) return t('start.neverOpened');

  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return t('start.justNow');
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
});
</script>

<template>
  <div
    class="conn"
    :class="{ 'conn--busy': busy }"
    :style="connection.labelColor ? { '--label': connection.labelColor } : undefined"
  >
    <button
      type="button"
      class="conn__open"
      :aria-label="$t('start.connectTo', { name: connection.name })"
      @click="$emit('open')"
    >
      <span
        class="conn__mark"
        :style="{ '--engine-hue': engine.hue }"
        aria-hidden="true"
      >{{
        engine.mark
      }}</span>

      <span class="conn__text">
        <span class="conn__name">{{ connection.name }}</span>
        <span class="conn__where">{{ subtitle }} · {{ lastUsed }}</span>
      </span>

      <span
        v-if="connection.readOnly"
        class="conn__flag"
      >{{ $t('workspace.readOnly') }}</span>
    </button>

    <div class="conn__actions">
      <button
        type="button"
        class="conn__action"
        :aria-label="$t('start.edit', { name: connection.name })"
        :title="$t('action.save')"
        @click.stop="$emit('edit')"
      >
        ✎
      </button>
      <button
        type="button"
        class="conn__action conn__action--danger"
        :aria-label="$t('start.remove', { name: connection.name })"
        :title="$t('action.delete')"
        @click.stop="$emit('remove')"
      >
        ✕
      </button>
    </div>

    <span
      v-if="busy"
      class="conn__progress"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.conn {
  position: relative;
  border-radius: 1rem;
  background: color-mix(in oklab, var(--color-base-100) 72%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--separator);
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.04);
  overflow: hidden;
  transition:
    transform var(--t-hover) var(--ease-out),
    box-shadow var(--t-hover) var(--ease-out),
    border-color var(--t-hover) var(--ease-out);
}

/* The connection's own colour, along the edge you read first. */
.conn::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--label, transparent);
}

.conn__open {
  display: flex;
  align-items: center;
  gap: var(--gap-loose);
  width: 100%;
  padding: var(--gap-loose) var(--gap-section) var(--gap-loose) var(--gap-loose);
  text-align: start;
}

.conn__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.7rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: oklch(99% 0 0);
  background: linear-gradient(
    145deg,
    oklch(64% 0.16 var(--engine-hue)),
    oklch(52% 0.17 var(--engine-hue))
  );
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.3);
  transition: transform var(--t-hover) var(--ease-out);
}

.conn__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.conn__name {
  font-size: 0.875rem;
  font-weight: 550;
  letter-spacing: -0.006em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn__where {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conn__flag {
  flex: 0 0 auto;
  align-self: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-warning) 26%, transparent);
  font-size: 0.5625rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.conn__actions {
  position: absolute;
  top: var(--gap-tight);
  inset-inline-end: var(--gap-tight);
  display: flex;
  gap: 1px;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    opacity var(--t-hover) var(--ease-out),
    transform var(--t-hover) var(--ease-out);
}

.conn__action {
  display: grid;
  place-items: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 0.4rem;
  font-size: 0.625rem;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  transition:
    background-color var(--t-press) var(--ease-out),
    color var(--t-press) var(--ease-out);
}

/*
 * A one-pixel line that sweeps the card while the connection is opening. It
 * says "working" without taking any space or moving anything else.
 */
.conn__progress {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  animation: sweep 1.1s var(--ease-in-out) infinite;
}

@keyframes sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}

.conn--busy {
  border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
}

.conn:active:not(.conn--busy) {
  transform: scale(0.985);
  transition-duration: var(--t-press);
}

.conn:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 50%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .conn:hover {
    transform: translateY(-2px);
    border-color: var(--separator);
    box-shadow:
      0 1px 2px oklch(0% 0 0 / 0.05),
      0 10px 30px oklch(0% 0 0 / 0.1);
  }

  .conn:hover .conn__mark {
    transform: scale(1.06);
  }

  .conn:hover .conn__actions,
  .conn:focus-within .conn__actions {
    opacity: 1;
    transform: translateY(0);
  }

  .conn__action:hover {
    background: var(--fill-2);
    color: var(--color-base-content);
  }

  .conn__action--danger:hover {
    background: var(--color-error);
    color: var(--color-error-content);
  }
}

@media (prefers-reduced-motion: reduce) {
  .conn,
  .conn__mark,
  .conn__actions {
    transition-duration: 120ms;
  }

  .conn:hover,
  .conn:active {
    transform: none;
  }

  .conn__progress {
    animation: none;
    opacity: 0.6;
  }
}
</style>
