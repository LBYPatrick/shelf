<script setup lang="ts">
/**
 * The connection editor.
 *
 * One form renders all nine engines: which fields appear comes from the engine
 * descriptor rather than from a branch per engine, so adding an engine means
 * adding a descriptor, not another form.
 */
import { computed, reactive, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { ConnectionConfig, EngineId } from '@drivers/types';
import type { SaveConnectionInput, SavedConnection } from '@shared/connections';
import type { ParsedConnection } from '@shared/connectionUrl';
import { engineDescriptor, isFileEngine } from '@shared/engines';
import CheckBox from '../ui/CheckBox.vue';
import DisclosureGroup from '../ui/DisclosureGroup.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import AppIcon from '../ui/AppIcon.vue';
import TextInput from '../ui/TextInput.vue';
import EnginePicker from './EnginePicker.vue';

const props = defineProps<{
  /** The connection being edited, or null when creating a new one. */
  editing: SavedConnection | null;
  /** Fields recovered from a pasted connection URL. */
  seed?: ParsedConnection | undefined;
  keyringAvailable: boolean;
  testing: boolean;
  testResult: { ok: true; version: string } | { ok: false; message: string } | null;
}>();

const emit = defineEmits<{
  save: [SaveConnectionInput];
  test: [SaveConnectionInput];
  connect: [SaveConnectionInput];
  cancel: [];
}>();

interface Draft {
  name: string;
  engine: EngineId | null;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  filePath: string;
  socketPath: string;
  url: string;
  readOnly: boolean;
  rememberSecrets: boolean;
  options: Record<string, string>;
  sslEnabled: boolean;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshPassword: string;
  sshKeyfile: string;
  sshMode: 'agent' | 'password' | 'keyfile';
}

function emptyDraft(): Draft {
  return {
    name: '',
    engine: null,
    host: 'localhost',
    port: '',
    username: '',
    password: '',
    database: '',
    filePath: '',
    socketPath: '',
    url: '',
    readOnly: false,
    rememberSecrets: true,
    options: {},
    sslEnabled: false,
    sshEnabled: false,
    sshHost: '',
    sshPort: '22',
    sshUsername: '',
    sshPassword: '',
    sshKeyfile: '',
    sshMode: 'agent',
  };
}

const draft = reactive<Draft>(emptyDraft());
const showAdvanced = ref(false);
/** Off every time the sheet opens: revealing is a deliberate act, not a mode. */
const revealed = ref(false);

const descriptor = computed(() => (draft.engine ? engineDescriptor(draft.engine) : null));
const shows = (field: string) => descriptor.value?.fields.includes(field as never) ?? false;

/** Load the selected connection into the form, or reset for a new one. */
watch(
  () => props.editing,
  (connection) => {
    Object.assign(draft, emptyDraft());

    // A pasted URL fills the form so the user confirms rather than retypes.
    if (!connection && props.seed) {
      const config = props.seed.config;
      draft.engine = props.seed.engine;
      draft.host = config.host ?? 'localhost';
      draft.port = config.port ? String(config.port) : '';
      draft.username = config.username ?? '';
      draft.password = props.seed.password ?? '';
      draft.database = config.database ?? '';
      draft.filePath = config.filePath ?? '';
      draft.url = config.url ?? '';
      draft.sslEnabled = config.ssl?.enabled ?? false;
      draft.name = props.seed.suggestedName;
      return;
    }

    if (!connection) return;

    const config = connection.config as ConnectionConfig;
    draft.name = connection.name;
    draft.engine = connection.engine;
    draft.host = config.host ?? 'localhost';
    draft.port = config.port ? String(config.port) : '';
    draft.username = config.username ?? '';
    draft.database = config.database ?? '';
    draft.filePath = config.filePath ?? '';
    draft.socketPath = config.socketPath ?? '';
    draft.url = config.url ?? '';
    draft.readOnly = connection.readOnly;
    draft.rememberSecrets = connection.rememberSecrets;
    draft.sslEnabled = config.ssl?.enabled ?? false;
    draft.sshEnabled = config.ssh?.enabled ?? false;
    draft.sshHost = config.ssh?.host ?? '';
    draft.sshPort = config.ssh?.port ? String(config.ssh.port) : '22';
    draft.sshUsername = config.ssh?.username ?? '';
    draft.sshKeyfile = config.ssh?.keyfile ?? '';
    draft.sshMode = config.ssh?.mode ?? 'agent';
    draft.options = Object.fromEntries(
      Object.entries(config.options ?? {}).map(([key, value]) => [key, String(value ?? '')])
    );

    /*
     * And the secrets, so the form shows what it already holds.
     *
     * It used to leave the password field empty and explain, in help text, that
     * blank meant "keep the saved one" — a rule the reader has to be told and
     * then remember, and one that makes changing a *port* an act of
     * remembering a password. The keyring is asked for them and they are filled
     * in like any other field; there is no longer a state where the form is
     * lying about what will be saved.
     */
    const id = connection.id;
    void window.shelf.db
      .revealSecrets(id)
      .then((secrets) => {
        // The sheet may have moved on to another connection while this was in
        // flight, and filling that one's form with these would be worse than
        // showing nothing.
        if (props.editing?.id !== id) return;
        draft.password = secrets['password'] ?? '';
        draft.sshPassword = secrets['sshPassword'] ?? '';
        draft.sshPassphrase = secrets['sshPassphrase'] ?? '';
      })
      .catch(() => undefined);
  },
  { immediate: true }
);

/** Defaults follow the engine, but never overwrite something already typed. */
watch(
  () => draft.engine,
  (engine, previous) => {
    if (!engine || engine === previous) return;
    const info = engineDescriptor(engine);

    if (
      !draft.port ||
      (previous && engineDescriptor(previous).defaultPort === Number(draft.port))
    ) {
      draft.port = info.defaultPort ? String(info.defaultPort) : '';
    }

    for (const option of info.options ?? []) {
      if (draft.options[option.key] === undefined && option.defaultValue !== undefined) {
        draft.options[option.key] = String(option.defaultValue);
      }
    }
  }
);

const suggestedName = computed(() => {
  if (!draft.engine) return '';

  const info = engineDescriptor(draft.engine);
  if (isFileEngine(draft.engine)) {
    return draft.filePath.split(/[\\/]/).pop() || info.name;
  }

  const host = draft.host || 'localhost';

  // A database name is the most recognisable thing when there is one. Failing
  // that the port disambiguates — two engines on the same host would otherwise
  // both end up called "localhost" — and it stays short enough to read on a
  // card without truncating.
  if (draft.database) return `${host}/${draft.database}`;
  return draft.port ? `${host}:${draft.port}` : host;
});

// These were written in English in the source while the translations for all
// five of them sat unused in every locale file.
const { t } = useTranslation();

const problems = computed(() => {
  const found: string[] = [];
  if (!draft.engine) found.push(t('connection.chooseEngine'));
  else if (isFileEngine(draft.engine)) {
    if (!draft.filePath) found.push(t('connection.chooseFile'));
  } else if (!draft.url && !draft.socketPath && !draft.host) {
    found.push(t('connection.needHost'));
  }

  for (const option of descriptor.value?.options ?? []) {
    if (option.required && !draft.options[option.key])
      found.push(t('connection.required', { field: option.label }));
  }

  return found;
});

const valid = computed(() => problems.value.length === 0);

function buildInput(): SaveConnectionInput {
  const engine = draft.engine!;
  const info = engineDescriptor(engine);

  const config: Omit<ConnectionConfig, 'password'> = {
    engine,
    ...(shows('host') && draft.host ? { host: draft.host } : {}),
    ...(draft.port ? { port: Number(draft.port) } : {}),
    ...(draft.username ? { username: draft.username } : {}),
    ...(draft.database ? { database: draft.database } : {}),
    ...(draft.filePath ? { filePath: draft.filePath } : {}),
    ...(draft.socketPath ? { socketPath: draft.socketPath } : {}),
    ...(draft.url ? { url: draft.url } : {}),
    ...(Object.keys(draft.options).length ? { options: { ...draft.options } } : {}),
    ...(info.supportsSsl && draft.sslEnabled
      ? { ssl: { enabled: true, rejectUnauthorized: true } }
      : {}),
    ...(info.supportsSsh && draft.sshEnabled
      ? {
          ssh: {
            enabled: true,
            host: draft.sshHost,
            port: Number(draft.sshPort) || 22,
            username: draft.sshUsername,
            mode: draft.sshMode,
            ...(draft.sshKeyfile ? { keyfile: draft.sshKeyfile } : {}),
          },
        }
      : {}),
    readOnly: draft.readOnly,
  };

  const secrets: Record<string, string> = {};
  if (draft.password) secrets['password'] = draft.password;
  if (draft.sshPassword) secrets['sshPassword'] = draft.sshPassword;

  return {
    ...(props.editing ? { id: props.editing.id } : {}),
    name: draft.name.trim() || suggestedName.value,
    engine,
    rememberSecrets: draft.rememberSecrets && props.keyringAvailable,
    config,
    ...(Object.keys(secrets).length ? { secrets } : {}),
  };
}

defineExpose({
  buildInput,
  isValid: () => valid.value,
  problem: () => problems.value[0],
});

async function pickFile(): Promise<void> {
  const info = descriptor.value;
  if (!info) return;

  const path = await window.shelf.dialogs.openFile({
    title: `Open ${info.name} database`,
    ...(info.fileExtensions ? { extensions: info.fileExtensions } : {}),
    allowCreate: true,
  });

  if (path) draft.filePath = path;
}
</script>

<template>
  <form
    class="form"
    @submit.prevent="valid && emit('connect', buildInput())"
  >
    <FormField label="Engine">
      <EnginePicker v-model="draft.engine" />
    </FormField>

    <template v-if="descriptor">
      <div class="pairs">
        <FormField
          v-if="shows('file')"
          v-slot="{ id }"
          label="Database file"
          class="span-2"
        >
          <div class="row">
            <TextInput
              :id="id"
              v-model="draft.filePath"
              monospace
              placeholder="/path/to/database.db"
            />
            <PressButton
              variant="glass"
              type="button"
              @click="pickFile"
            >
              Choose…
            </PressButton>
          </div>
        </FormField>

        <FormField
          v-if="shows('host')"
          v-slot="{ id }"
          label="Host"
          class="span-2"
        >
          <TextInput
            :id="id"
            v-model="draft.host"
            placeholder="localhost"
          />
        </FormField>

        <FormField
          v-if="descriptor.defaultPort"
          v-slot="{ id }"
          label="Port"
        >
          <TextInput
            :id="id"
            v-model="draft.port"
            type="number"
            :placeholder="String(descriptor.defaultPort)"
          />
        </FormField>

        <FormField
          v-if="shows('username')"
          v-slot="{ id }"
          label="User"
        >
          <TextInput
            :id="id"
            v-model="draft.username"
          />
        </FormField>

        <FormField
          v-if="shows('password')"
          v-slot="{ id }"
          label="Password"
        >
          <!--
            Masked until asked, but present: a field that hides what it holds
            *and* declines to hold it is a field you cannot check against the
            thing you are debugging.
          -->
          <div class="secret">
            <TextInput
              :id="id"
              v-model="draft.password"
              :type="revealed ? 'text' : 'password'"
            />
            <button
              type="button"
              class="secret__reveal"
              :aria-pressed="revealed"
              :aria-label="revealed ? 'Hide password' : 'Show password'"
              :title="revealed ? 'Hide password' : 'Show password'"
              @click="revealed = !revealed"
            >
              <AppIcon
                :name="revealed ? 'eyeOff' : 'eye'"
                :size="13"
              />
            </button>
          </div>
        </FormField>

        <FormField
          v-if="shows('database')"
          v-slot="{ id }"
          :label="descriptor.databaseLabel ?? 'Database'"
        >
          <TextInput
            :id="id"
            v-model="draft.database"
          />
        </FormField>

        <FormField
          v-for="option in descriptor.options ?? []"
          :key="option.key"
          v-slot="{ id }"
          :label="option.label"
          :help="option.help"
        >
          <select
            v-if="option.kind === 'select'"
            :id="id"
            v-model="draft.options[option.key]"
            class="textfield"
          >
            <option
              v-for="choice in option.choices"
              :key="choice.value"
              :value="choice.value"
            >
              {{ choice.label }}
            </option>
          </select>
          <TextInput
            v-else
            :id="id"
            v-model="draft.options[option.key]"
            :type="option.kind === 'password' ? 'password' : 'text'"
          />
        </FormField>
      </div>

      <DisclosureGroup
        v-if="descriptor.supportsSsh || descriptor.supportsSsl"
        v-model="showAdvanced"
        label="Advanced"
      >
        <div class="advanced__body">
          <CheckBox
            v-if="descriptor.supportsSsl"
            v-model="draft.sslEnabled"
            label="Use SSL/TLS"
          />

          <CheckBox
            v-if="descriptor.supportsSsh"
            v-model="draft.sshEnabled"
            label="Connect through an SSH tunnel"
          />

          <div
            v-if="draft.sshEnabled"
            class="pairs"
          >
            <FormField
              v-slot="{ id }"
              label="SSH host"
              class="span-2"
            >
              <TextInput
                :id="id"
                v-model="draft.sshHost"
              />
            </FormField>
            <FormField
              v-slot="{ id }"
              label="SSH port"
            >
              <TextInput
                :id="id"
                v-model="draft.sshPort"
                type="number"
              />
            </FormField>
            <FormField
              v-slot="{ id }"
              label="SSH user"
            >
              <TextInput
                :id="id"
                v-model="draft.sshUsername"
              />
            </FormField>
            <FormField
              v-slot="{ id }"
              label="Authentication"
            >
              <select
                :id="id"
                v-model="draft.sshMode"
                class="textfield"
              >
                <option value="agent">
                  SSH agent
                </option>
                <option value="keyfile">
                  Key file
                </option>
                <option value="password">
                  Password
                </option>
              </select>
            </FormField>
            <FormField
              v-if="draft.sshMode === 'keyfile'"
              v-slot="{ id }"
              label="Key file"
            >
              <TextInput
                :id="id"
                v-model="draft.sshKeyfile"
                monospace
              />
            </FormField>
            <FormField
              v-if="draft.sshMode === 'password'"
              v-slot="{ id }"
              label="SSH password"
            >
              <TextInput
                :id="id"
                v-model="draft.sshPassword"
                type="password"
              />
            </FormField>
          </div>
        </div>
      </DisclosureGroup>

      <div class="options">
        <CheckBox
          v-model="draft.readOnly"
          label="Read-only"
          hint="Refuses anything that writes, at the driver."
        />

        <CheckBox
          v-model="draft.rememberSecrets"
          label="Save password"
          :disabled="!keyringAvailable"
          :hint="
            keyringAvailable
              ? 'Stored in the system keychain, never in the app database.'
              : 'Unavailable: no system keyring was found on this machine.'
          "
        />
      </div>

      <FormField
        v-slot="{ id }"
        label="Name"
        :help="`Leave blank to use “${suggestedName}”.`"
      >
        <TextInput
          :id="id"
          v-model="draft.name"
          :placeholder="suggestedName"
        />
      </FormField>

      <!--
        What to do next, not what you did wrong. The actions this blocks are
        disabled while it stands, so it can only ever be read *before* anything
        was attempted — and amber on an untouched form is a rebuke for nothing.
      -->
      <p
        v-if="problems.length"
        class="problems"
        role="status"
      >
        {{ problems[0] }}
      </p>

      <p
        v-else-if="testResult"
        class="result"
        :class="testResult.ok ? 'result--ok' : 'result--bad'"
        role="status"
      >
        {{ testResult.ok ? `Connected — ${testResult.version}` : testResult.message }}
      </p>
    </template>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 0;
}

/*
 * The reveal sits inside the field's trailing edge rather than beside it: a
 * button in a column of its own would take that width from the value, and the
 * value is what is being checked.
 */
.secret {
  position: relative;
  display: flex;
  min-width: 0;
}

.secret :deep(.textfield) {
  flex: 1;
  min-width: 0;
  padding-inline-end: calc(var(--hit-min) + var(--gap-tight));
}

.secret__reveal {
  position: absolute;
  inset-inline-end: 0;
  inset-block: 0;
  display: grid;
  place-items: center;
  width: var(--hit-min);
  border-radius: var(--radius-field);
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  transition: color var(--t-hover) var(--ease-out);
}

.secret__reveal[aria-pressed='true'],
.secret__reveal:hover {
  color: var(--color-base-content);
}

.pairs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap-loose);
}

.span-2 {
  grid-column: 1 / -1;
}

.row {
  display: flex;
  gap: var(--gap-tight);
}

.row > :first-child {
  flex: 1;
  min-width: 0;
}

.advanced__body {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding-top: var(--gap);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.problems,
.result {
  font-size: 0.75rem;
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-field);
}

.problems {
  background: var(--fill-4);
  color: color-mix(in oklab, var(--color-base-content) 68%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.result--ok {
  background: color-mix(in oklab, var(--color-success) 18%, transparent);
}

.result--bad {
  background: color-mix(in oklab, var(--color-error) 16%, transparent);
}
</style>
