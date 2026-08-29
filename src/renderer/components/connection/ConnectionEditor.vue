<script setup lang="ts">
/**
 * Setting up a connection.
 *
 * A sheet rather than a permanent panel: creating a connection is a deliberate,
 * occasional act, and giving it the whole window while it is happening is
 * better than leaving a form on screen forever competing with the list.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { SaveConnectionInput, SavedConnection } from '@shared/connections';
import type { ParsedConnection } from '@shared/connectionUrl';
import { useTranslation } from 'i18next-vue';
import { useConnections } from '../../stores/connections';
import { useToasts } from '../../stores/toasts';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';
import ConnectionForm from './ConnectionForm.vue';

const props = defineProps<{
  editing: SavedConnection | null;
  seed?: ParsedConnection | undefined;
  keyringAvailable: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [SavedConnection, boolean];
  draft: [SaveConnectionInput];
}>();

const connections = useConnections();
const toasts = useToasts();
const { t } = useTranslation();

const form = ref<InstanceType<typeof ConnectionForm>>();
const open = ref(true);
const testing = ref(false);
/**
 * The form's own validity, polled rather than mirrored: duplicating the rules
 * here is how the button and the form drift apart.
 */
const tick = ref(0);
const ready = computed(() => {
  void tick.value;
  return form.value?.isValid() ?? false;
});
const problem = computed(() => {
  void tick.value;
  return form.value?.problem();
});

// Cheap and bounded: the sheet is open for seconds, not minutes.
const poll = setInterval(() => (tick.value += 1), 150);
onBeforeUnmount(() => clearInterval(poll));

function submit(connect: boolean): void {
  const input = form.value?.buildInput();
  if (input) void save(input, connect);
}

function runTest(): void {
  const input = form.value?.buildInput();
  if (input) void test(input);
}
/*
 * The answer arrives as a notification, not as a line that appears at the foot
 * of the form and shifts everything above it. It is a *result*, which is what
 * toasts are for — and the form it reports on is often taller than the popup,
 * so the line reporting it could easily be off screen when it arrived.
 */
async function test(input: SaveConnectionInput): Promise<void> {
  testing.value = true;
  try {
    const result = await connections.test({
      kind: 'draft',
      config: input.config,
      ...(input.secrets ? { secrets: input.secrets } : {}),
      ...(input.id ? { basedOn: input.id } : {}),
    });

    toasts.show(
      result.ok
        ? {
            id: 'connection-test',
            tone: 'success',
            message: t('connection.testOk', { version: result.version }),
          }
        : { id: 'connection-test', tone: 'error', message: result.message }
    );
  } finally {
    testing.value = false;
  }
}

async function save(input: SaveConnectionInput, connect: boolean): Promise<void> {
  const stored = await connections.save(input);
  open.value = false;
  emit('saved', stored, connect);
}

function close(): void {
  open.value = false;
  // Let the exit animation finish before the component is torn down.
  setTimeout(() => emit('close'), 260);
}
</script>

<template>
  <Sheet
    v-model="open"
    :title="props.editing ? props.editing.name : 'New connection'"
    wide
    @update:model-value="!$event && close()"
  >
    <ConnectionForm
      ref="form"
      :editing="props.editing"
      :seed="props.seed"
      :keyring-available="props.keyringAvailable"
      :testing="testing"
      @save="save($event, false)"
      @connect="save($event, true)"
      @test="test"
    />

    <!--
      A check on the left, decisions on the right.
      ───────────────────────────────────────────
      All four used to sit in one cluster, so the row read as four things you
      might press to finish — and two of them, Save and Connect, both finish.
      Test does not: it tells you whether the details are right and leaves you
      exactly where you were. Position is what separates the kinds, which is
      cheaper than a word explaining it, and the filled button is the one action
      that commits.
    -->
    <template #footer>
      <PressButton variant="glass" :disabled="!ready || testing" @click="runTest">
        {{ testing ? $t('connection.testing') : $t('action.test') }}
      </PressButton>

      <span v-if="problem" class="problem">{{ problem }}</span>

      <PressButton class="footer__decisions" @click="close">
        {{ $t('action.cancel') }}
      </PressButton>
      <PressButton :disabled="!ready" @click="submit(false)">
        {{ $t('action.save') }}
      </PressButton>
      <PressButton variant="primary" :disabled="!ready" @click="submit(true)">
        {{ $t('action.connect') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
/*
 * Guidance, in the voice of a hint rather than a warning.
 *
 * Every action this describes is already disabled, so the sentence can only be
 * read before anything has been attempted — and amber on a form nobody has
 * touched spends the warning colour on the one state where nothing is wrong.
 */
/*
 * Everything from Cancel rightwards is pushed over, rather than the check being
 * pushed left. The problem line comes and goes, and hanging the split on it
 * would close the gap the moment the form became valid.
 */
.footer__decisions {
  margin-inline-start: auto;
}

.problem {
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}
</style>
