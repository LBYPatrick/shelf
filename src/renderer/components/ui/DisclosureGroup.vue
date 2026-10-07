<script setup lang="ts">
/**
 * A disclosure.
 *
 * The native `<details>` marker is a platform triangle that matches nothing
 * else on screen and cannot be animated. This draws its own chevron and
 * animates the height, so opening reads as the panel unfolding rather than the
 * page jumping.
 *
 * Height is animated from a measured pixel value rather than `auto`, because
 * `auto` is not an animatable length — the usual reason disclosures snap open.
 */
import { ref } from 'vue';
import { pointerMotion, useReducedMotion } from '../../composables/useMotion';

defineProps<{ label: string; hint?: string }>();
const open = defineModel<boolean>({ default: false });

const content = ref<HTMLElement>();
const reducedMotion = useReducedMotion();
const instant = ref(true);
function toggle(event: MouseEvent): void {
  instant.value = !pointerMotion(event);
  open.value = !open.value;
}

let interruptedHeight: number | undefined;
function cancelled(element: Element): void {
  interruptedHeight = element.getBoundingClientRect().height;
}

function enter(element: Element): void {
  const el = element as HTMLElement;
  if (instant.value || reducedMotion.value) {
    interruptedHeight = undefined;
    el.style.height = open.value ? 'auto' : '0px';
    return;
  }
  el.style.height = `${interruptedHeight ?? 0}px`;
  interruptedHeight = undefined;
  // Force a reflow so the browser has a start value to animate from.
  void el.offsetHeight;
  el.style.height = `${el.scrollHeight}px`;
}

function afterEnter(element: Element): void {
  // Back to auto once open, so the panel grows with its content afterwards.
  (element as HTMLElement).style.height = 'auto';
}

function leave(element: Element): void {
  const el = element as HTMLElement;
  if (instant.value || reducedMotion.value) {
    interruptedHeight = undefined;
    el.style.height = open.value ? 'auto' : '0px';
    return;
  }
  el.style.height = `${interruptedHeight ?? el.getBoundingClientRect().height}px`;
  interruptedHeight = undefined;
  void el.offsetHeight;
  el.style.height = '0px';
}
</script>

<template>
  <div class="disclosure" :class="{ 'disclosure--instant': instant || reducedMotion }">
    <button class="disclosure__trigger" type="button" :aria-expanded="open" @click="toggle">
      <svg
        class="disclosure__chevron"
        :class="{ 'disclosure__chevron--open': open }"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path
          d="M4.5 2.5 L8 6 L4.5 9.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="type-label">{{ label }}</span>
      <span v-if="hint" class="disclosure__hint">{{ hint }}</span>
    </button>

    <Transition
      name="disclose"
      @enter="enter"
      @after-enter="afterEnter"
      @leave="leave"
      @enter-cancelled="cancelled"
      @leave-cancelled="cancelled"
    >
      <div v-show="open" ref="content" class="disclosure__panel">
        <div class="disclosure__inner">
          <slot />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.disclosure__trigger {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  width: 100%;
  padding: var(--gap-tight) 0;
  color: var(--text-soft);
  transition: color var(--t-hover) var(--ease-out);
}

/* How much is inside, without having to open it. */
.disclosure__hint {
  margin-inline-start: auto;
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  color: var(--text-soft);
}

.disclosure__chevron {
  width: 0.75rem;
  height: 0.75rem;
  transition: transform var(--t-pop) var(--ease-out);
}

.disclosure__chevron--open {
  transform: rotate(90deg);
}

.disclosure__panel {
  overflow: hidden;
  transition: height var(--t-pop) var(--ease-out);
}

.disclosure__inner {
  padding-top: var(--gap);
}

/* Content fades slightly behind the height so it does not appear squashed. */
.disclose-enter-active .disclosure__inner,
.disclose-leave-active .disclosure__inner {
  transition: opacity var(--t-pop) var(--ease-out);
}

.disclose-enter-from .disclosure__inner,
.disclose-leave-to .disclosure__inner {
  opacity: 0;
}

@media (hover: hover) and (pointer: fine) {
  .disclosure__trigger:hover {
    color: var(--color-base-content);
  }
}

.disclosure--instant .disclosure__panel,
.disclosure--instant .disclosure__chevron,
.disclosure--instant .disclosure__inner {
  transition: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .disclosure__panel,
  .disclosure__chevron {
    transition-duration: 0ms;
  }
}
</style>
