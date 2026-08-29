<script setup lang="ts">
/**
 * How to sign in to a command-line assistant.
 *
 * The one failure this app can name exactly and cannot fix. Claude Code and
 * Codex hold their own accounts — that is the whole reason they need no key,
 * and Shelf never reads their credentials — so the fix is a command in a
 * terminal, and no button here can press it.
 *
 * What the sheet can do is make the trip short: the command in one place, ready
 * to copy, and a way to come back and check without having to ask a question
 * again to find out. Before this, an unauthenticated CLI was an indefinite wait
 * with no message at all.
 *
 * **It is one instruction, not three steps.** It was a numbered list — open a
 * terminal, run this, come back — and two of those three are not steps. They
 * are what "run this in a terminal" already means, given numbers and circles
 * and a column of their own, so the one line anybody came here for was the
 * middle third of a procedure. The command is the whole content now: it is the
 * largest thing on the sheet, it is selectable as well as copyable, and the
 * sentence under it says where to put it.
 *
 * The list also wore `.steps` and `.step`, which are daisyUI's — so the
 * framework drew its own numbered circles down the other side of the sheet and
 * centred every line between the two sets. The gate has a rule about taking a
 * framework's class name and could not see this one, because it looks at what
 * is on screen and this sheet only opens for a CLI nobody is signed in to.
 * `tests/unit/classNames.test.ts` reads the templates instead.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { AiDriverKind, AiSignInState } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { host } from '../../lib/host';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';

const props = defineProps<{ kind: AiDriverKind | null }>();
const open = defineModel<boolean>({ required: true });

const { t } = useTranslation();

const info = computed(() => (props.kind ? driverInfo(props.kind) : null));
const command = computed(() => info.value?.signInCommand ?? '');

/** What the last check said, or nothing until one has been made. */
const checked = ref<AiSignInState | 'failed' | null>(null);
const checking = ref(false);

// A sheet reopened for another provider must not show the last one's verdict.
watch([open, () => props.kind], () => (checked.value = null));

const copied = ref(false);
let forget: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(command.value).catch(() => undefined);
  copied.value = true;
  clearTimeout(forget);
  forget = setTimeout(() => (copied.value = false), 1600);
}

/**
 * Asks the same question the next turn will ask.
 *
 * The same channel and the same status command, so a tick here and a failure a
 * moment later cannot disagree — a "check" that consulted anything else would
 * be a second opinion, which is worse than none.
 */
async function check(): Promise<void> {
  if (!props.kind || checking.value) return;
  checking.value = true;
  try {
    checked.value = await host.call('ai/signedIn', { kind: props.kind });
  } catch {
    checked.value = 'failed';
  } finally {
    checking.value = false;
  }
}

const verdict = computed(() => {
  const name = info.value?.label ?? '';
  if (checked.value === 'in') return { tone: 'ok', text: t('assistant.signInOk', { name }) };
  if (checked.value === 'out')
    return { tone: 'bad', text: t('assistant.signInStill', { name }) };
  if (checked.value === null) return null;
  return { tone: 'unsure', text: t('assistant.signInUnknown') };
});
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('assistant.signInTitle', { name: info?.label ?? '' })"
    :subtitle="$t('assistant.title')"
    icon="terminal"
  >
    <div v-if="info" class="signin">
      <p class="signin__why selectable">
        {{ $t('assistant.signInWhy', { name: info.label }) }}
      </p>

      <!--
        The command is the content, so it is drawn like content rather than like
        a field: bigger than the prose around it, in the one place the eye lands
        after the paragraph, with the sentence that places it directly beneath.
        Proximity is what ties the two together — a caption a gap away from what
        it captions is a second paragraph.

        Selectable as well as copyable. The root of this app turns selection off,
        which is right for chrome and wrong for the one string on screen that
        somebody may want to take a word out of.
      -->
      <div class="command">
        <code class="command__text selectable">{{ command }}</code>
        <button
          type="button"
          class="command__copy focus-fill"
          :class="{ 'command__copy--done': copied }"
          :aria-label="copied ? $t('action.copied') : $t('action.copy')"
          @click="copy"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" :size="13" />
        </button>
      </div>

      <p class="signin__where">
        {{ $t('assistant.signInRun') }}
      </p>

      <!--
        The check and what it said, on one row: a control belongs beside the
        thing it changes, and the verdict is the whole of what pressing it
        produces. Its colour agrees with its words rather than being a constant.
      -->
      <div class="check">
        <PressButton size="sm" :disabled="checking" @click="check">
          <AppIcon name="refresh" :size="13" />
          {{ $t('assistant.signInCheck') }}
        </PressButton>

        <p v-if="verdict" class="verdict" :class="`verdict--${verdict.tone}`" role="status">
          <AppIcon :name="verdict.tone === 'ok' ? 'check' : 'warning'" :size="13" />
          {{ verdict.text }}
        </p>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.signin {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}

/*
 * The paragraph, and then the caption under the command.
 *
 * Two sizes, and the difference between them is the hierarchy: the reason this
 * sheet exists is read once, and the line placing the command is read at a
 * glance beside the thing it places. Leading is looser on the longer one, which
 * is the way round it goes — tight on large and short, comfortable on small and
 * long.
 */
.signin__why {
  margin: 0;
  color: color-mix(in oklab, var(--color-base-content) 86%, transparent);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.signin__where {
  margin: calc(var(--gap-loose) * -1 + var(--gap-tight)) 0 0;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
  font-size: 0.75rem;
  line-height: 1.4;
}

/*
 * The one thing on this sheet worth taking away, drawn as such.
 *
 * Sunk into the pane rather than raised off it, because it is a quotation of
 * something that lives somewhere else — and `--surface-well` is what a sunk
 * surface is called here rather than a fill spelled at the call site.
 */
.command {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding: var(--gap) var(--gap-tight) var(--gap) var(--gap-loose);
  border: 1px solid var(--separator);
  border-radius: var(--radius-field);
  background: var(--surface-well);
}

/*
 * Bigger than the prose around it, and tracked out very slightly.
 *
 * A monospace face at a small size in a sheet of proportional text reads
 * cramped; a hair of positive tracking is what small text wants, and a command
 * is read character by character rather than by word shape.
 */
.command__text {
  flex: 1;
  min-inline-size: 0;
  overflow-x: auto;
  color: var(--color-base-content);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.command__copy {
  display: grid;
  flex: none;
  place-items: center;
  inline-size: var(--hit-min);
  block-size: var(--hit-min);
  border: 0;
  border-radius: var(--radius-selector);
  background: none;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  cursor: pointer;
  transition:
    color var(--t-hover) var(--ease-out),
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

/* The press, not the release: a control that waits for the click to acknowledge
   a press has already felt slow by the time it does. */
.command__copy:active {
  transform: scale(0.92);
}

/* It went green on copy and back to grey a second and a half later, which is a
   colour change nobody asked about — the glyph becoming a tick is the whole
   message, and it says it without a second signal. */
.command__copy--done {
  color: var(--color-success);
}

@media (hover: hover) and (pointer: fine) {
  .command__copy:hover {
    background: var(--fill-4);
    color: var(--color-base-content);
  }
}

/*
 * Separated from the instruction above it by a rule, because it is a different
 * kind of thing: everything above is what to go and do, and this is what to do
 * once it is done.
 */
.check {
  display: flex;
  align-items: center;
  gap: var(--gap);
  flex-wrap: wrap;
  padding-block-start: var(--gap-loose);
  border-block-start: 1px solid var(--separator);
}

.verdict {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  margin: 0;
  font-size: 0.8125rem;
}

.verdict--ok {
  color: var(--color-success, var(--color-base-content));
}

.verdict--bad {
  color: var(--color-error, var(--color-base-content));
}

.verdict--unsure {
  color: var(--color-base-content);
  opacity: 0.75;
}
</style>
