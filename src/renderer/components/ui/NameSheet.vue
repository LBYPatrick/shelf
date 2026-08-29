<script setup lang="ts">
/**
 * Asks for a name, and offers to write one.
 *
 * Two things in this app need a name at the moment they are made — a query
 * being saved and a statement being dispatched as a job — and they are the same
 * question asked twice. One sheet, so the field, the button beside it and the
 * key that commits are learned once. The caller supplies the words and what the
 * name is *for*; nothing about either flow is known here.
 *
 * **The field is never empty.** It opens on the best name the caller already
 * has — the tab's own name, or the job's stamp — because a dialog that demands
 * a name before it will do the thing is a dialog people learn to type "a" into.
 *
 * **The model fills the box; it does not fill the field.** The button writes
 * into the same box the reader is typing in, and what is stored is whatever is
 * left there when they commit. A generated name that saved itself would be a
 * name nobody read, in a list they have to recognise things in later. It is
 * offered only where a provider is configured — an always-visible button that
 * explains it cannot work is a button that is in the way.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { errorMessage } from '@shared/errors';
import { useAssistant } from '../../stores/assistant';
import { useToasts } from '../../stores/toasts';
import AppIcon from './AppIcon.vue';
import FormField from './FormField.vue';
import PressButton from './PressButton.vue';
import Sheet from './Sheet.vue';
import TextInput from './TextInput.vue';
import { vTip } from '../../lib/hoverTip';

const props = defineProps<{
  title: string;
  label: string;
  help?: string;
  /** What the button reads on the one action that commits. */
  confirm: string;
  /** The statement a generated name would describe. */
  sql: string;
}>();

const open = defineModel<boolean>({ required: true });
const name = defineModel<string>('name', { required: true });
const emit = defineEmits<{ confirm: [] }>();

const { t } = useTranslation();
const assistant = useAssistant();
const toasts = useToasts();

const field = useTemplateRef<InstanceType<typeof TextInput>>('field');
const thinking = ref(false);

/*
 * The whole field, selected, the moment it opens.
 *
 * It arrives holding a real name, and the two things anyone does next are
 * accept it and replace it. A caret at the end serves the first and makes the
 * second a select-all before a keystroke; a selection serves both, because
 * typing replaces it and any arrow key dismisses it.
 */
watch(open, async (showing) => {
  if (!showing) return;
  thinking.value = false;
  await nextTick();
  field.value?.$el?.select?.();
});

const canGenerate = computed(() => assistant.configured && props.sql.trim().length > 0);

async function generate(): Promise<void> {
  if (thinking.value || !canGenerate.value) return;
  thinking.value = true;

  try {
    const suggestion = await assistant.suggestName(props.sql);
    // Nothing usable came back, so the name that was already there stands.
    if (suggestion) name.value = suggestion;
  } catch (caught) {
    toasts.show({
      tone: 'error',
      title: t('name.generateFailed'),
      message: errorMessage(caught),
    });
  } finally {
    thinking.value = false;
  }
}

function commit(): void {
  if (!name.value.trim()) return;
  emit('confirm');
}
</script>

<template>
  <Sheet v-model="open" :title="title">
    <FormField v-slot="{ id }" :label="label" :help="help">
      <div class="named">
        <TextInput
          :id="id"
          ref="field"
          v-model="name"
          class="named__field"
          :disabled="thinking"
          @keydown.enter="commit"
        />

        <!--
          Beside the box rather than under it: it acts on what is *in* the box,
          and a control that acts on a field belongs on the field's own line.
          Icon-only, with a drawn label — the OS tooltip arrives a second and a
          half late in a corner of its own choosing.
        -->
        <button
          v-if="canGenerate"
          v-tip="$t('name.generateHint')"
          type="button"
          class="named__generate focus-fill"
          :class="{ 'named__generate--busy': thinking }"
          :disabled="thinking"
          :aria-label="$t('name.generate')"
          @click="generate"
        >
          <AppIcon name="assistant" :size="14" filled />
        </button>
      </div>
    </FormField>

    <template #footer>
      <PressButton @click="open = false">
        {{ $t('action.cancel') }}
      </PressButton>
      <PressButton variant="primary" :disabled="!name.trim() || thinking" @click="commit">
        {{ confirm }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.named {
  display: flex;
  gap: var(--gap-tight);
  align-items: center;
}

.named__field {
  flex: 1;
  min-width: 0;
}

/*
 * The same height and radius as the field it stands beside, because they are
 * one row and a control half a step out of line reads as a mistake rather than
 * as a different thing.
 */
.named__generate {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--field-h);
  height: var(--field-h);
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  border: 1px solid var(--separator);
  border-radius: var(--radius-field);
  color: var(--color-primary-text, var(--color-primary));
  transition:
    background-color var(--t-hover) var(--ease-out),
    border-color var(--t-hover) var(--ease-out),
    opacity var(--t-hover) var(--ease-out);
}

.named__generate:disabled {
  cursor: default;
}

/*
 * Waiting, said by the glyph rather than by a spinner beside it.
 *
 * A second shape appearing in the row would move the field, and the thing that
 * is working is the button — so the button is what shows it. Opacity only, so
 * a mark with four cusps does not shimmer at 14px.
 */
.named__generate--busy {
  animation: named-thinking 1.4s var(--ease-in-out) infinite;
}

@keyframes named-thinking {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

@media (hover: hover) and (pointer: fine) {
  .named__generate:hover:not(:disabled) {
    background: var(--fill-4);
    border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
  }
}
</style>
