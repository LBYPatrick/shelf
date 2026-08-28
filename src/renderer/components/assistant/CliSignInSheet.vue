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
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { AiDriverKind, AiSignInState } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';
import { host } from '../../lib/host';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';
import ProviderMark from './ProviderMark.vue';

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

/*
 * The steps, as one list rather than three blocks.
 *
 * The middle one carries the command, so it is the only one that is not just a
 * line of prose — which is why the command sits inside the step and not above
 * the list. A code block floating over a numbered list is a second thing to
 * work out the order of.
 */
const steps = computed(() => [
  t('assistant.signInStep1'),
  t('assistant.signInStep2'),
  t('assistant.signInStep3'),
]);
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('assistant.signInTitle', { name: info?.label ?? '' })"
    :subtitle="$t('assistant.title')"
    icon="terminal"
  >
    <div v-if="info" class="signin">
      <p class="signin__why">
        <ProviderMark class="signin__mark" :driver="info.kind" :size="18" />
        <span>{{ $t('assistant.signInWhy', { name: info.label }) }}</span>
      </p>

      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step" class="step">
          <span class="step__number" aria-hidden="true">{{ index + 1 }}</span>
          <span class="step__body">
            <span class="step__text">{{ step }}</span>

            <!--
              The command belongs to its step, not to the sheet. Copy is beside
              it because the next thing anybody does with a command they cannot
              run here is take it somewhere they can.
            -->
            <span v-if="index === 1 && command" class="command">
              <code class="command__text">{{ command }}</code>
              <button
                type="button"
                class="command__copy focus-fill"
                :aria-label="$t('action.copy')"
                @click="copy"
              >
                <AppIcon :name="copied ? 'check' : 'copy'" :size="13" />
              </button>
            </span>
          </span>
        </li>
      </ol>

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

.signin__why {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  margin: 0;
  color: var(--color-base-content);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.signin__mark {
  flex: none;
  margin-block-start: 0.1rem;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
}

/* A drawn number rather than a marker, so it keeps its own column when the
   text beside it wraps to three lines. */
.step__number {
  display: grid;
  flex: none;
  place-items: center;
  inline-size: 1.25rem;
  block-size: 1.25rem;
  border-radius: 50%;
  background: var(--fill-2);
  color: var(--color-base-content);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.step__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--gap-tight);
  min-inline-size: 0;
}

.step__text {
  color: var(--color-base-content);
  font-size: 0.8125rem;
  line-height: 1.35;
}

.command {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  padding: var(--gap-tight) var(--gap);
  border: 1px solid var(--fill-2);
  border-radius: var(--radius-field);
  background: var(--surface-well);
}

.command__text {
  flex: 1;
  overflow-x: auto;
  color: var(--color-base-content);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
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
  color: var(--color-base-content);
  cursor: pointer;
  opacity: 0.7;
}

.command__copy:hover {
  opacity: 1;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--gap);
  flex-wrap: wrap;
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
