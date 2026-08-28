<script setup lang="ts">
/**
 * Where the assistant's providers are configured.
 *
 * A list and a form in one sheet, which the sheet is built for: it measures its
 * content and animates to the height it needs, so moving between the two reads
 * as one panel changing rather than two popups.
 *
 * The key field shows what it holds. That is the same deliberate exception the
 * connection editor takes and it is taken here for the same reason — a field
 * that hides its value makes changing a model name an act of finding your API
 * key again, and it reveals nothing the reader could not read out of their own
 * keychain. It is one provider, named, and only while its editor is open.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { AiDriverKind, AiProvider } from '@shared/ai';
import { CONFIGURABLE_DRIVERS, driverInfo, isDetectedProviderId } from '@shared/aiDrivers';
import { errorMessage } from '@shared/errors';
import AppIcon from '../ui/AppIcon.vue';
import ProviderMark from './ProviderMark.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import ProgressBar from '../ui/ProgressBar.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import Sheet from '../ui/Sheet.vue';
import SuggestInput from '../ui/SuggestInput.vue';
import TextInput from '../ui/TextInput.vue';
import { useAssistant } from '../../stores/assistant';
import { useToasts } from '../../stores/toasts';
import { vTip } from '../../lib/hoverTip';

const open = defineModel<boolean>({ required: true });

const assistant = useAssistant();
const toasts = useToasts();
const { t } = useTranslation();

/** Which provider the form is on, or `null` for the list. */
const editing = ref<AiProvider | 'new' | null>(null);

const form = ref({
  id: '' as string,
  name: '',
  driver: 'anthropic' as AiDriverKind,
  model: '',
  baseUrl: '',
  apiKey: '',
});

const info = computed(() => driverInfo(form.value.driver));

/*
 * Only the drivers a reader configures. Claude Code and Codex are found on the
 * machine rather than added, so offering them here would be offering to make a
 * second one — and there is only ever one `claude` on a computer.
 */
const driverOptions = computed(() =>
  CONFIGURABLE_DRIVERS.map((driver) => ({ value: driver.kind, label: driver.label }))
);

const modelOptions = computed(() => info.value.models);

watch(open, (isOpen) => {
  if (!isOpen) editing.value = null;
  else void assistant.refresh();
});

/*
 * Changing the provider moves the model and the base URL to that provider's
 * defaults, unless the reader has typed something of their own. A form that
 * kept `claude-opus-5` selected after switching to Gemini would be a form
 * offering a request that cannot succeed.
 */
watch(
  () => form.value.driver,
  (kind, previous) => {
    if (previous === undefined) return;
    const was = driverInfo(previous);
    const now = driverInfo(kind);
    if (!form.value.model || form.value.model === was.defaultModel) {
      form.value.model = now.defaultModel;
    }
    if (!form.value.baseUrl || form.value.baseUrl === was.defaultBaseUrl) {
      form.value.baseUrl = '';
    }
  }
);

async function edit(provider: AiProvider): Promise<void> {
  // Nothing to edit: it has no name of its own, no key, and picks its own
  // model. Opening a form with every field disabled says less than not opening.
  if (isDetectedProviderId(provider.id)) return;

  form.value = {
    id: provider.id,
    name: provider.name,
    driver: provider.driver,
    model: provider.model,
    baseUrl: provider.baseUrl ?? '',
    apiKey: await window.shelf.db.revealAiKey(provider.id).catch(() => ''),
  };
  editing.value = provider;
}

function add(): void {
  const first = CONFIGURABLE_DRIVERS[0]!;
  form.value = {
    id: '',
    // Empty, not the driver's label. A name that arrives already filled in is a
    // name nobody changes, so every provider ends up called after its driver
    // and the field may as well not exist — and the field is the whole point
    // when the reader has two accounts with one company. The placeholder shows
    // what it will be called if they leave it alone.
    name: '',
    driver: first.kind,
    model: first.defaultModel,
    baseUrl: '',
    apiKey: '',
  };
  editing.value = 'new';
}

const saving = ref(false);
const testing = ref(false);
const problem = ref('');

const valid = computed(() => form.value.model.trim().length > 0);

function input() {
  return {
    ...(form.value.id ? { id: form.value.id } : {}),
    name: form.value.name.trim() || info.value.label,
    driver: form.value.driver,
    model: form.value.model.trim(),
    ...(form.value.baseUrl.trim() ? { baseUrl: form.value.baseUrl.trim() } : {}),
    apiKey: form.value.apiKey,
  };
}

async function save(): Promise<void> {
  if (!valid.value) return;
  saving.value = true;
  problem.value = '';
  try {
    await assistant.save(input());
    editing.value = null;
  } catch (error) {
    problem.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

/**
 * Saves first, then asks the provider a question.
 *
 * Testing an unsaved form would mean a second path for staging credentials that
 * exists only for this button. Saving is also what the reader wanted anyway —
 * nobody presses Test hoping to discard the settings afterwards.
 */
async function test(): Promise<void> {
  if (!valid.value) return;
  testing.value = true;
  problem.value = '';
  try {
    const saved = await assistant.save(input());
    form.value.id = saved.id;
    const outcome = await assistant.probe(saved.id);
    if (outcome.ok) {
      toasts.show({ id: 'ai-test', tone: 'success', message: t('assistant.testOk') });
    } else {
      problem.value = outcome.message;
    }
  } catch (error) {
    problem.value = errorMessage(error);
  } finally {
    testing.value = false;
  }
}

async function remove(): Promise<void> {
  const provider = editing.value;
  if (provider === null || provider === 'new') return;
  await assistant.remove(provider.id);
  editing.value = null;
}
</script>

<template>
  <Sheet
    v-model="open"
    icon="assistant"
    :title="$t('assistant.providersTitle')"
    :subtitle="editing ? $t('assistant.providers') : undefined"
  >
    <!-- The list. -->
    <template v-if="!editing">
      <p class="intro">
        {{ $t('assistant.providersNote') }}
      </p>

      <ul v-if="assistant.providers.length > 0" class="list">
        <li v-for="provider in assistant.providers" :key="provider.id">
          <component
            :is="isDetectedProviderId(provider.id) ? 'div' : 'button'"
            :type="isDetectedProviderId(provider.id) ? undefined : 'button'"
            class="row"
            :class="isDetectedProviderId(provider.id) ? 'row--detected' : 'focus-fill'"
            @click="edit(provider)"
          >
            <ProviderMark class="row__glyph" :driver="provider.driver" :size="14" />
            <span class="row__names">
              <span class="row__name">{{ provider.name }}</span>
              <span class="row__model">
                {{
                  isDetectedProviderId(provider.id)
                    ? $t('assistant.onThisMachine')
                    : provider.model
                }}
              </span>
            </span>
            <span v-if="assistant.active?.id === provider.id" class="row__badge type-label">{{
              $t('assistant.inUse')
            }}</span>
            <AppIcon
              v-if="!isDetectedProviderId(provider.id)"
              class="row__caret"
              name="chevron"
              :size="12"
            />
          </component>
        </li>
      </ul>

      <p v-else class="intro intro--empty">
        {{ $t('assistant.noProviderYet') }}
      </p>
    </template>

    <!-- The form. -->
    <template v-else>
      <FormField :label="$t('assistant.fieldName')" :help="$t('assistant.nameHelp')">
        <TextInput v-model="form.name" :placeholder="info.label" />
      </FormField>

      <FormField :label="$t('assistant.fieldDriver')">
        <SelectMenu
          v-model="form.driver"
          :options="driverOptions"
          :aria-label="$t('assistant.fieldDriver')"
        />
      </FormField>

      <FormField
        :label="
          info.modelAs === 'deployment'
            ? $t('assistant.fieldDeployment')
            : $t('assistant.fieldModel')
        "
        :help="
          info.modelAs === 'deployment'
            ? $t('assistant.deploymentHelp')
            : $t('assistant.modelHelp')
        "
      >
        <template #default="{ id }">
          <SuggestInput
            :id="id"
            v-model="form.model"
            :options="modelOptions"
            :aria-label="$t('assistant.fieldModel')"
            monospace
          />
        </template>
      </FormField>

      <FormField
        v-if="info.baseUrlEditable"
        :label="
          info.baseUrlAs === 'region'
            ? $t('assistant.fieldRegion')
            : $t('assistant.fieldBaseUrl')
        "
        :help="
          info.baseUrlAs === 'region' ? $t('assistant.regionHelp') : $t('assistant.baseUrlHelp')
        "
      >
        <TextInput v-model="form.baseUrl" monospace :placeholder="info.defaultBaseUrl" />
      </FormField>

      <FormField
        v-if="info.acceptsKey"
        :label="$t('assistant.fieldKey')"
        :help="info.needsKey ? $t('assistant.keyHelp') : $t('assistant.keyOptional')"
        :error="problem"
      >
        <TextInput
          v-model="form.apiKey"
          monospace
          :placeholder="info.needsKey ? '' : $t('assistant.keyNone')"
        />
      </FormField>

      <!--
        A provider that takes no key still has to say where its credentials come
        from. Without this the form for Bedrock is a region and a model and no
        hint that the account it will bill is whichever one the machine's AWS
        configuration points at.
      -->
      <p v-if="info.credentialsNote" class="note">
        {{
          info.credentialsNote === 'aws'
            ? $t('assistant.credentialsAws')
            : $t('assistant.credentialsCli')
        }}
      </p>

      <p v-if="problem && !info.acceptsKey" class="problem" role="alert">
        {{ problem }}
      </p>

      <div v-if="testing || saving" class="working">
        <ProgressBar />
      </div>
    </template>

    <template #footer>
      <template v-if="!editing">
        <PressButton variant="primary" @click="add()">
          <AppIcon name="plus" :size="12" />
          <span>{{ $t('assistant.addProvider') }}</span>
        </PressButton>
      </template>

      <template v-else>
        <PressButton
          v-if="editing !== 'new'"
          v-tip="$t('action.delete')"
          variant="danger"
          :aria-label="$t('action.delete')"
          @click="remove()"
        >
          <AppIcon name="trash" :size="12" />
        </PressButton>
        <span class="grow" />
        <PressButton @click="editing = null">
          {{ $t('action.cancel') }}
        </PressButton>
        <PressButton :disabled="!valid || testing" @click="test()">
          {{ $t('action.test') }}
        </PressButton>
        <PressButton variant="primary" :disabled="!valid || saving" @click="save()">
          {{ $t('action.save') }}
        </PressButton>
      </template>
    </template>
  </Sheet>
</template>

<style scoped>
.intro {
  margin: 0 0 var(--gap-loose);
  font-size: 0.8125rem;
  line-height: 1.6;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.intro--empty {
  margin-bottom: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--gap-hair);
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--gap);
  width: 100%;
  min-height: calc(var(--hit-min) + var(--gap));
  padding: var(--gap-tight) var(--gap-loose);
  border-radius: 0.625rem;
  text-align: start;
  transition: background-color var(--t-hover) var(--ease-out);
}

.row:hover {
  background: var(--fill-1);
}

.row__glyph {
  flex: 0 0 auto;
  color: var(--color-primary);
}

.row__names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Detected rows are shown rather than opened, so they lose the affordances
   that say otherwise: no caret, no hover, no pointer. */
.row--detected {
  cursor: default;
}

.row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}

.row__model {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  opacity: 0.55;
}

.row__badge {
  margin-inline-start: auto;
  padding: 0.1rem var(--gap);
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-primary) 16%, transparent);
  color: var(--color-primary-text, var(--color-primary));
}

.row__caret {
  flex: 0 0 auto;
  margin-inline-start: auto;
  opacity: 0.4;
}

.row__badge + .row__caret {
  margin-inline-start: 0;
}

.grow {
  flex: 1;
}

.problem {
  margin: 0 0 var(--gap-loose);
  font-size: 0.75rem;
  color: var(--color-error, var(--color-base-content));
}

/* Quieter than a field's help, because it is a fact about the provider rather
   than an instruction about the box above it. */
.note {
  /* Its own paragraph, not a second line of the help above it. */
  margin: var(--gap-tight) 0 var(--gap-loose);
  font-size: 0.75rem;
  line-height: 1.4;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.working {
  margin-top: var(--gap-loose);
}
</style>
