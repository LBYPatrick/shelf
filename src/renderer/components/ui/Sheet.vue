<script setup lang="ts">
/**
 * A modal sheet.
 *
 * It arrives as a material rather than a fade: the blur and the scale animate
 * together, so it reads as a surface coming forward rather than a rectangle
 * appearing. The scrim dims what is behind it, because a modal task wants the
 * rest of the window pushed back rather than merely covered.
 *
 * Focus is trapped while it is open and returned to whatever had it before,
 * which is what keeps it usable without a mouse.
 */
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useDismiss } from '../../composables/useDismiss';

const props = defineProps<{ title: string; wide?: boolean }>();
const open = defineModel<boolean>({ required: true });

const panel = ref<HTMLElement>();
/**
 * The dialog is named by its own heading rather than a duplicated aria-label,
 * so the accessible name and the visible title cannot drift apart.
 */
const titleId = useId();
let previouslyFocused: HTMLElement | null = null;

function focusables(): HTMLElement[] {
  if (!panel.value) return [];
  return [
    ...panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ),
  ];
}

/*
 * Escape goes through the shared stack rather than a listener of this sheet's
 * own. Every overlay had one, at the window and in the capture phase, and they
 * all fired: a sheet opened from a sheet closed both at once.
 */
useDismiss(open);

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;

  const items = focusables();
  if (items.length === 0) return;

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const current = document.activeElement;

  // Wrap at both ends so Tab never escapes the sheet into the page behind it.
  if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    await nextTick();
    focusables()[0]?.focus();
  } else {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});

onBeforeUnmount(() => previouslyFocused?.focus());

void props;
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div
        v-if="open"
        class="scrim"
        @keydown="onKeydown"
        @click.self="open = false"
      >
        <div
          ref="panel"
          class="panel surface-sheet mat-edge-top"
          :class="{ 'panel--wide': wide }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header class="panel__head">
            <h2
              :id="titleId"
              class="type-title"
            >
              {{ title }}
            </h2>
            <button
              type="button"
              class="panel__close"
              aria-label="Close"
              @click="open = false"
            >
              ✕
            </button>
          </header>

          <div class="panel__body">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="panel__foot"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: start center;
  padding-block: 12vh 6vh;
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(34rem, calc(100vw - 4rem));
  max-height: 100%;
  border-radius: 1.25rem;
  overflow: hidden;
}

.panel--wide {
  width: min(48rem, calc(100vw - 4rem));
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-loose) var(--gap-section);
}

.panel__close {
  display: grid;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.panel__close:hover {
  background: var(--fill-3);
  color: var(--color-base-content);
}

/*
 * A scroll edge, not a hard cut.
 *
 * A sheet taller than the window used to guillotine its content against the
 * footer — the Settings pane ended mid-control with nothing to say there was
 * more. The mask fades the last few millimetres out where the content passes
 * under the chrome, which reads as "this continues" without spending a divider
 * on it. `animation-timeline: scroll()` fades the top edge in only once you
 * have actually scrolled, so a sheet that fits shows no edge at all.
 */
.panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--gap-section) var(--gap-section);
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--sheet-edge-top, 0px),
    #000 calc(100% - 1.25rem),
    transparent 100%
  );
}

@supports (animation-timeline: scroll()) {
  .panel__body {
    animation: sheet-edge-top linear both;
    animation-timeline: scroll(self block);
    animation-range: 0 1.25rem;
  }

  @keyframes sheet-edge-top {
    from {
      --sheet-edge-top: 0px;
    }
    to {
      --sheet-edge-top: 1.25rem;
    }
  }
}

.panel__foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap);
  padding: var(--gap-loose) var(--gap-section);
  border-top: 1px solid var(--separator);
}

/*
 * The material arrives: blur and scale move together so it reads as a surface
 * coming forward, not a rectangle fading up.
 */
.sheet-enter-active .panel,
.sheet-leave-active .panel {
  transition:
    transform 300ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 220ms ease-out;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease-out;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .panel,
.sheet-leave-to .panel {
  transform: translateY(-12px) scale(0.97);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-from .panel,
  .sheet-leave-to .panel {
    transform: none;
  }
}
</style>
