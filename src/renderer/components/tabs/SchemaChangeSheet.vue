<script setup lang="ts">
/**
 * Confirming a schema change.
 *
 * The generated statement is shown, not summarised — a schema edit is the kind
 * of operation people are right to be careful about, and the only honest way to
 * ask for confirmation is to show exactly what will run.
 *
 * Destructive changes require the object's name to be typed. It is deliberate
 * friction, spent only where the action cannot be undone.
 *
 * Every word here is a key. It used to be a literal, in a sheet that opens over
 * an interface translated into five languages — and the translations for these
 * particular words already existed, written and reviewed, and had simply never
 * been read by anything. A string with two homes has one of them wrong.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { buildDdl, describe, isDestructive, type SchemaChange } from '@shared/ddl';
import type { EngineId } from '@drivers/types';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';
import TextInput from '../ui/TextInput.vue';

const props = defineProps<{ change: SchemaChange; engine: EngineId; running?: boolean }>();
const emit = defineEmits<{ apply: [string]; cancel: [] }>();

const open = defineModel<boolean>({ required: true });

const { t } = useTranslation();

const typed = ref('');

const sql = computed(() => buildDdl(props.change, props.engine));
const destructive = computed(() => isDestructive(props.change));
const target = computed(() =>
  props.change.kind === 'drop-column' ? props.change.name : props.change.entity.name
);

const confirmed = computed(() => !destructive.value || typed.value.trim() === target.value);

watch(open, (isOpen) => {
  if (isOpen) typed.value = '';
});

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(sql.value);
}
</script>

<template>
  <Sheet
    v-model="open"
    :title="destructive ? t('structure.cannotUndo') : t('structure.applyChange')"
  >
    <p class="summary" :class="{ 'summary--danger': destructive }">
      {{ describe(change) }}
    </p>

    <p class="changelabel type-label">
      {{ $t('structure.whatWillRun') }}
    </p>
    <pre class="sql">{{ sql }}</pre>

    <FormField
      v-if="destructive"
      v-slot="{ id }"
      :label="$t('structure.typeToConfirm')"
      :help="$t('structure.typeToConfirmHelp', { name: target })"
    >
      <TextInput :id="id" v-model="typed" :placeholder="target" monospace />
    </FormField>

    <template #footer>
      <PressButton @click="copy">
        {{ $t('structure.copySql') }}
      </PressButton>
      <PressButton
        @click="
          open = false;
          emit('cancel');
        "
      >
        {{ $t('action.cancel') }}
      </PressButton>
      <PressButton
        :variant="destructive ? 'danger' : 'primary'"
        :disabled="!confirmed || running"
        @click="emit('apply', sql)"
      >
        {{
          running
            ? $t('structure.applying')
            : destructive
              ? $t('action.delete')
              : $t('action.apply')
        }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.summary {
  padding: var(--gap) var(--gap-loose);
  border-radius: 0.75rem;
  background: var(--fill-4);
  font-size: 0.8125rem;
  margin-bottom: var(--gap-loose);
}

.summary--danger {
  background: color-mix(in oklab, var(--color-error) 14%, transparent);
}

.changelabel {
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
  margin-bottom: var(--gap-tight);
}

.sql {
  padding: var(--gap-loose);
  border-radius: 0.75rem;
  background: var(--fill-4);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  margin-bottom: var(--gap-loose);
}
</style>
