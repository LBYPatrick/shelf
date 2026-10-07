<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { SaveConnectionInput, SavedConnection } from '@shared/connections';
import type { ParsedConnection } from '@shared/connectionUrl';
import { errorMessage } from '@shared/errors';
import { useTranslation } from 'i18next-vue';
import { useConnections } from '../../stores/connections';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';
import ConnectionForm from './ConnectionForm.vue';

const props = defineProps<{
  editing: SavedConnection | null;
  seed?: ParsedConnection | undefined;
  keyringAvailable: boolean;
  overSheets?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  saved: [SavedConnection, boolean];
  draft: [SaveConnectionInput];
}>();
const connections = useConnections();
const { t } = useTranslation();
const form = ref<InstanceType<typeof ConnectionForm>>();
const open = ref(true);
const testing = ref(false);
const saving = ref(false);
const discarding = ref(false);
const saveError = ref('');
const testResult = ref<{ ok: boolean; message: string }>();
const fingerprint = computed(() => form.value?.fingerprint());
const ready = computed(() => form.value?.isValid() ?? false);
const problem = computed(() => form.value?.problem());
const testable = computed(() => form.value?.hasEngine() ?? false);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(closeTimer));

// Dismissing through Escape, the scrim or Cancel follows the same recovery flow.
const sheetOpen = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value) requestClose();
  },
});
function close(): void {
  open.value = false;
  closeTimer = setTimeout(() => emit('close'), 260);
}
function requestClose(): void {
  if (saving.value) return;
  if (form.value?.hasChanges()) discarding.value = true;
  else close();
}
watch(fingerprint, () => {
  testResult.value = undefined;
  saveError.value = '';
});

function submit(connect: boolean): void {
  if (!ready.value || saving.value || testing.value) return;
  const input = form.value?.buildInput();
  if (input) void save(input, connect);
}
function runTest(): void {
  if (!ready.value || testing.value || saving.value) return;
  const input = form.value?.buildInput();
  if (input) void test(input);
}
async function test(input: SaveConnectionInput): Promise<void> {
  if (testing.value) return;
  testing.value = true;
  testResult.value = undefined;
  const tested = fingerprint.value;
  try {
    const result = await connections.test({
      kind: 'draft',
      config: input.config,
      ...(input.secrets ? { secrets: input.secrets } : {}),
      ...(input.id ? { basedOn: input.id } : {}),
    });
    if (tested === fingerprint.value)
      testResult.value = {
        ok: result.ok,
        message: result.ok
          ? t('connection.testOk', { version: result.version })
          : result.message,
      };
  } catch (caught) {
    if (tested === fingerprint.value)
      testResult.value = { ok: false, message: errorMessage(caught) };
  } finally {
    testing.value = false;
  }
}
async function save(input: SaveConnectionInput, connect: boolean): Promise<void> {
  if (saving.value || testing.value || !ready.value) return;
  saving.value = true;
  saveError.value = '';
  try {
    const stored = await connections.save(input);
    open.value = false;
    emit('saved', stored, connect);
  } catch (caught) {
    saveError.value = errorMessage(caught);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Sheet
    v-model="sheetOpen"
    :title="
      editing ? $t('connection.editTitle', { name: editing.name }) : $t('connection.newTitle')
    "
    :over-sheets="overSheets"
    wide
    flush
  >
    <ConnectionForm
      ref="form"
      :editing="editing"
      :seed="seed"
      :keyring-available="keyringAvailable"
      :testing="testing"
      :busy="saving"
      @save="save($event, false)"
    />
    <template #footer>
      <div class="editor-footer">
        <div v-if="discarding" class="discard" role="alert">
          <div>
            <strong>{{ $t('connection.discardTitle') }}</strong>
            <p>{{ $t('connection.discardHelp') }}</p>
          </div>
          <PressButton variant="glass" @click="discarding = false">{{
            $t('connection.keepEditing')
          }}</PressButton>
          <PressButton @click="close">{{ $t('connection.discard') }}</PressButton>
        </div>
        <template v-else>
          <p
            v-if="testResult || saveError"
            class="feedback"
            :class="{ 'feedback--error': saveError || !testResult?.ok }"
            :role="saveError || !testResult?.ok ? 'alert' : 'status'"
          >
            {{ saveError || testResult?.message }}
          </p>
          <div class="editor-actions">
            <PressButton
              v-if="testable"
              variant="glass"
              :disabled="!ready || testing || saving"
              @click="runTest"
              >{{ testing ? $t('connection.testing') : $t('action.test') }}</PressButton
            >
            <span class="problem">{{
              problem || $t(editing ? 'connection.editHelp' : 'connection.saveHelp')
            }}</span>
            <PressButton class="footer-decisions" :disabled="saving" @click="requestClose">{{
              $t('action.cancel')
            }}</PressButton>
            <PressButton
              v-if="testable"
              :disabled="!ready || testing || saving"
              @click="submit(false)"
              >{{ $t('action.save') }}</PressButton
            >
            <PressButton
              v-if="testable"
              variant="primary"
              :disabled="!ready || testing || saving"
              @click="submit(true)"
              >{{
                saving ? $t('connection.saving') : $t('connection.saveConnect')
              }}</PressButton
            >
          </div>
        </template>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.editor-footer {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
.editor-actions,
.discard {
  display: flex;
  align-items: center;
  gap: var(--gap);
}
.footer-decisions {
  margin-inline-start: auto;
}
.problem {
  font-size: 0.6875rem;
  color: var(--text-soft);
  max-width: 17rem;
}
.feedback {
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-field);
  background: var(--fill-3);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
  max-height: 7rem;
  overflow: auto;
  color: var(--color-success);
}
.feedback--error {
  color: var(--color-error);
}
.discard > div {
  flex: 1;
  font-size: 0.8125rem;
}
.discard p {
  margin-top: var(--gap-hair);
  font-size: 0.75rem;
  color: var(--text-soft);
}
@media (max-width: 600px) {
  .editor-actions,
  .discard {
    flex-wrap: wrap;
  }
  .problem {
    flex-basis: 100%;
    order: -1;
    max-width: none;
  }
}
</style>
