<script setup lang="ts">
/**
 * The connection editor.
 *
 * One form renders all nine engines: which fields appear comes from the engine
 * descriptor rather than from a branch per engine, so adding an engine means
 * adding a descriptor, not another form.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { ConnectionConfig, EngineId } from '@drivers/types';
import type { SaveConnectionInput, SavedConnection } from '@shared/connections';
import { parseConnectionUrl, type ParsedConnection } from '@shared/connectionUrl';
import { errorMessage } from '@shared/errors';
import { ENGINES, engineDescriptor, isFileEngine } from '@shared/engines';
import CheckBox from '../ui/CheckBox.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import AppIcon from '../ui/AppIcon.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import TextInput from '../ui/TextInput.vue';
import EnginePicker from './EnginePicker.vue';
import EngineMark from './EngineMark.vue';
import { vTip } from '../../lib/hoverTip';

const props = defineProps<{
  /** The connection being edited, or null when creating a new one. */
  editing: SavedConnection | null;
  /** Fields recovered from a pasted connection URL. */
  seed?: ParsedConnection | undefined;
  keyringAvailable: boolean;
  testing: boolean;
  busy?: boolean;
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
  /*
   * Read back from the keyring since it was written, and never once collected:
   * the draft had no field for it, so an encrypted key could be chosen and its
   * passphrase could not be given. The tunnel that now uses it made that a
   * connection you cannot open rather than a field that does nothing.
   */
  sshPassphrase: string;
  proxyEnabled: boolean;
  proxyKind: 'socks5' | 'socks4' | 'http';
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
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
    sshPassphrase: '',
    proxyEnabled: false,
    proxyKind: 'socks5',
    proxyHost: '',
    proxyPort: '1080',
    proxyUsername: '',
    proxyPassword: '',
  };
}

const draft = reactive<Draft>(emptyDraft());
const detailPage = ref('details');
/** Off every time the sheet opens: revealing is a deliberate act, not a mode. */
const revealed = ref(false);
const pasted = ref('');
const pasteError = ref('');
const secretsLoading = ref(false);
const secretsError = ref('');
const initial = ref('');
const method = ref<'host' | 'socket' | 'url'>('host');
const snapshot = () => JSON.stringify(draft);

const methods = computed(() => [
  { value: 'host' as const, label: t('connection.hostAndPort') },
  ...(shows('socket') ? [{ value: 'socket' as const, label: t('connection.socket') }] : []),
  ...(shows('url') ? [{ value: 'url' as const, label: t('connection.url') }] : []),
]);

function loadParsed(parsed: ParsedConnection): void {
  const config = parsed.config;
  Object.assign(draft, emptyDraft(), {
    engine: parsed.engine,
    host: config.host ?? 'localhost',
    port: config.port ? String(config.port) : '',
    username: config.username ?? '',
    password: parsed.password ?? '',
    database: config.database ?? '',
    filePath: config.filePath ?? '',
    url: config.url ?? '',
    sslEnabled: config.ssl?.enabled ?? false,
    name: parsed.suggestedName,
  });
  method.value = config.url ? 'url' : 'host';
}

function useUrl(): void {
  const parsed = parseConnectionUrl(pasted.value);
  if (!parsed) {
    pasteError.value = t('connection.invalidUrl');
    return;
  }
  loadParsed(parsed);
  pasted.value = '';
  pasteError.value = '';
}

/**
 * The three ways a network puts something in front of a database.
 *
 * SOCKS5 first because it is what most proxies are; SOCKS4 is offered as 4a —
 * the variant that can carry a host name — because plain SOCKS4 cannot name a
 * host the client has not already resolved, and on a private network that is
 * the whole point.
 */
const proxyKinds = [
  { value: 'socks5' as const, label: 'SOCKS5' },
  { value: 'socks4' as const, label: 'SOCKS4a' },
  { value: 'http' as const, label: 'HTTP' },
];

/*
 * How the tunnel proves who it is. Named here rather than as three `<option>`
 * elements so the list is translated once and the control drawing it is the
 * same one every other list in the app uses.
 */
const sshModes = computed(() => [
  { value: 'agent' as const, label: t('connection.sshAgent') },
  { value: 'keyfile' as const, label: t('connection.sshKeyFile') },
  { value: 'password' as const, label: t('connection.sshPasswordMode') },
]);

const descriptor = computed(() => (draft.engine ? engineDescriptor(draft.engine) : null));

const chosen = computed(() => ENGINES.find((engine) => engine.id === draft.engine) ?? null);
const shows = (field: string) => descriptor.value?.fields.includes(field as never) ?? false;
const visibleOptions = computed(() =>
  (descriptor.value?.options ?? []).filter((option) => {
    if (draft.engine !== 'dynamodb') return true;
    if (option.key === 'profile') return draft.options['authType'] === 'profile';
    if (option.key === 'accessKeyId' || option.key === 'secretAccessKey')
      return draft.options['authType'] === 'keys';
    return true;
  })
);

/** Load the selected connection into the form, or reset for a new one. */
watch(
  () => props.editing,
  async (connection) => {
    Object.assign(draft, emptyDraft());
    secretsError.value = '';
    secretsLoading.value = false;
    detailPage.value = 'details';
    revealed.value = false;
    method.value = 'host';

    // A pasted URL fills the form so the user confirms rather than retypes.
    if (!connection && props.seed) {
      loadParsed(props.seed);
      await nextTick();
      initial.value = snapshot();
      return;
    }

    if (!connection) {
      initial.value = snapshot();
      return;
    }

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
    draft.proxyEnabled = config.proxy?.enabled ?? false;
    draft.proxyKind = config.proxy?.kind ?? 'socks5';
    draft.proxyHost = config.proxy?.host ?? '';
    draft.proxyPort = config.proxy?.port ? String(config.proxy.port) : '1080';
    draft.proxyUsername = config.proxy?.username ?? '';
    draft.options = Object.fromEntries(
      Object.entries(config.options ?? {}).map(([key, value]) => [key, String(value ?? '')])
    );
    method.value = config.url ? 'url' : config.socketPath ? 'socket' : 'host';

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
    secretsLoading.value = true;
    await window.shelf.db
      .revealSecrets(id)
      .then((secrets) => {
        // The sheet may have moved on to another connection while this was in
        // flight, and filling that one's form with these would be worse than
        // showing nothing.
        if (props.editing?.id !== id) return;
        draft.password = secrets['password'] ?? '';
        draft.sshPassword = secrets['sshPassword'] ?? '';
        draft.proxyPassword = secrets['proxyPassword'] ?? '';
        draft.sshPassphrase = secrets['sshPassphrase'] ?? '';
      })
      .catch((caught) => {
        if (props.editing?.id === id) secretsError.value = errorMessage(caught);
      });
    if (props.editing?.id !== id) return;
    secretsLoading.value = false;
    await nextTick();
    initial.value = snapshot();
  },
  { immediate: true }
);

/** Defaults follow the engine, but never overwrite something already typed. */
watch(
  () => draft.engine,
  (engine, previous) => {
    if (!engine || engine === previous) return;
    const info = engineDescriptor(engine);
    if (!info.fields.includes(method.value === 'socket' ? 'socket' : 'url')) {
      method.value = 'host';
    }

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
  if (method.value === 'url') return parseConnectionUrl(draft.url)?.suggestedName || info.name;
  if (method.value === 'socket') return draft.socketPath.split(/[\\/]/).pop() || info.name;
  if (draft.engine === 'dynamodb')
    return [info.name, draft.options['region']].filter(Boolean).join(' · ');
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
  if (secretsLoading.value) found.push(t('connection.loadingSecrets'));
  if (secretsError.value) found.push(secretsError.value);
  if (!draft.engine) found.push(t('connection.chooseEngine'));
  else if (isFileEngine(draft.engine)) {
    if (!draft.filePath) found.push(t('connection.chooseFile'));
  } else if (shows('host') && method.value === 'host' && !draft.host.trim()) {
    found.push(t('connection.needHost'));
  }
  if (method.value === 'socket' && !draft.socketPath.trim())
    found.push(t('connection.needSocket'));
  if (method.value === 'url' && !draft.url.trim()) found.push(t('connection.needUrl'));
  const validPort = (port: string) =>
    /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535;
  if (shows('port') && method.value === 'host' && draft.port && !validPort(draft.port))
    found.push(t('connection.invalidPort'));
  if (
    descriptor.value?.supportsSsh &&
    draft.sshEnabled &&
    (!draft.sshHost.trim() || !draft.sshUsername.trim())
  )
    found.push(t('connection.needSsh'));
  if (descriptor.value?.supportsSsh && draft.sshEnabled && !validPort(draft.sshPort))
    found.push(t('connection.invalidPort'));
  if (
    descriptor.value?.supportsSsh &&
    draft.proxyEnabled &&
    !draft.sshEnabled &&
    !draft.proxyHost.trim()
  )
    found.push(t('connection.needProxy'));
  if (
    descriptor.value?.supportsSsh &&
    draft.proxyEnabled &&
    !draft.sshEnabled &&
    !validPort(draft.proxyPort)
  )
    found.push(t('connection.invalidPort'));

  for (const option of visibleOptions.value) {
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
    ...(shows('host') && method.value === 'host' && draft.host
      ? { host: draft.host.trim() }
      : {}),
    ...(method.value === 'host' && shows('port') && draft.port
      ? { port: Number(draft.port) }
      : {}),
    ...(shows('username') && method.value !== 'url' && draft.username
      ? { username: draft.username }
      : {}),
    ...(shows('database') && method.value !== 'url' && draft.database
      ? { database: draft.database }
      : {}),
    ...(shows('file') && draft.filePath ? { filePath: draft.filePath } : {}),
    ...(shows('socket') && method.value === 'socket' ? { socketPath: draft.socketPath } : {}),
    ...(shows('url') && method.value === 'url' ? { url: draft.url } : {}),
    ...(visibleOptions.value.length
      ? {
          options: Object.fromEntries(
            visibleOptions.value.map((option) => [option.key, draft.options[option.key] ?? ''])
          ),
        }
      : {}),
    ...(info.supportsSsl && draft.sslEnabled
      ? {
          ssl: {
            ...(props.editing?.engine === engine ? props.editing.config.ssl : {}),
            enabled: true,
            rejectUnauthorized:
              props.editing?.engine === engine
                ? (props.editing.config.ssl?.rejectUnauthorized ?? true)
                : true,
          },
        }
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
    /*
     * One route at a time. A bastion reached through a SOCKS proxy is a real
     * arrangement and two hops to explain; offering the combination without
     * having tried it would be offering something that has never worked.
     */
    ...(info.supportsSsh && draft.proxyEnabled && !draft.sshEnabled && draft.proxyHost
      ? {
          proxy: {
            enabled: true,
            kind: draft.proxyKind,
            host: draft.proxyHost,
            port: Number(draft.proxyPort) || 1080,
            ...(draft.proxyUsername ? { username: draft.proxyUsername } : {}),
          },
        }
      : {}),
    readOnly: draft.readOnly,
  };

  // Empty is an explicit deletion. Omission would retain the saved credential.
  const secrets: Record<string, string> = {
    password: '',
    sshPassword: '',
    sshPassphrase: '',
    proxyPassword: '',
  };
  if (shows('password') && method.value !== 'url' && draft.password)
    secrets['password'] = draft.password;
  if (info.supportsSsh && draft.sshEnabled && draft.sshPassword)
    secrets['sshPassword'] = draft.sshPassword;
  if (info.supportsSsh && draft.sshEnabled && draft.sshPassphrase)
    secrets['sshPassphrase'] = draft.sshPassphrase;
  if (info.supportsSsh && draft.proxyEnabled && !draft.sshEnabled && draft.proxyPassword)
    secrets['proxyPassword'] = draft.proxyPassword;

  return {
    ...(props.editing
      ? {
          id: props.editing.id,
          folderId: props.editing.folderId,
          labelColor: props.editing.labelColor,
          pinned: props.editing.pinned,
        }
      : {}),
    readOnly: draft.readOnly,
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
  /** Whether there is an engine yet, which is what the footer's check waits for. */
  hasEngine: () => draft.engine !== null,
  hasChanges: () => initial.value !== '' && snapshot() !== initial.value,
  fingerprint: () => snapshot(),
});

async function pickFile(create = false): Promise<void> {
  const info = descriptor.value;
  if (!info) return;

  const path = await window.shelf.dialogs[create ? 'saveFile' : 'openFile']({
    title: create ? t('connection.createFile') : t('connection.openFile'),
    ...(info.fileExtensions ? { extensions: info.fileExtensions } : {}),
  });

  if (path) draft.filePath = path;
}

function chooseEngine(engine: EngineId | null): void {
  detailPage.value = 'details';
  draft.engine = engine;
}
</script>

<template>
  <form
    class="connection-layout"
    @submit.prevent="valid && !busy && emit('save', buildInput())"
  >
    <aside class="engine-sidebar">
      <p class="type-label engine-sidebar__label">{{ $t('connection.engineLabel') }}</p>
      <EnginePicker
        :model-value="draft.engine"
        layout="sidebar"
        :disabled="busy || secretsLoading"
        @update:model-value="chooseEngine"
      />
    </aside>
    <section class="connection-details" :inert="busy || secretsLoading || undefined">
      <template v-if="descriptor && chosen">
        <header class="details-heading">
          <EngineMark :engine="chosen.id" :size="20" />
          <h3>{{ chosen.name }}</h3>
          <span class="security-summary">{{
            [
              draft.sslEnabled && descriptor.supportsSsl ? 'TLS' : '',
              draft.sshEnabled && descriptor.supportsSsh ? 'SSH' : '',
              draft.proxyEnabled && !draft.sshEnabled && descriptor.supportsSsh
                ? draft.proxyKind.toUpperCase()
                : '',
            ]
              .filter(Boolean)
              .join(' · ')
          }}</span>
        </header>
        <SegmentedControl
          v-if="descriptor.supportsSsh || descriptor.supportsSsl"
          v-model="detailPage"
          :options="[
            { value: 'details', label: $t('connection.details') },
            { value: 'security', label: $t('connection.securityRouting') },
          ]"
          :aria-label="$t('connection.details')"
        />
        <div v-show="detailPage === 'details'" class="detail-fields">
          <div class="pairs">
            <FormField
              v-slot="{ id }"
              :label="$t('connection.name')"
              :class="{ 'span-2': !shows('database') || method === 'url' }"
            >
              <TextInput :id="id" v-model="draft.name" :placeholder="suggestedName" />
            </FormField>
            <FormField
              v-if="shows('database') && method !== 'url'"
              v-slot="{ id }"
              :label="descriptor.databaseLabel ?? $t('connection.database')"
              ><TextInput :id="id" v-model="draft.database"
            /></FormField>
          </div>
          <div v-if="shows('host') && methods.length > 1" class="method">
            <SegmentedControl
              v-model="method"
              :options="methods"
              :aria-label="$t('connection.method')"
            />
          </div>
          <div class="pairs server-pairs">
            <FormField
              v-if="shows('file')"
              v-slot="{ id }"
              :label="$t('connection.file')"
              :help="$t('connection.fileHelp')"
              class="span-2"
            >
              <TextInput
                :id="id"
                v-model="draft.filePath"
                monospace
                placeholder="/path/to/database.db"
              />
              <div class="file-actions">
                <PressButton variant="glass" @click="pickFile(false)">{{
                  $t('connection.openFile')
                }}</PressButton
                ><PressButton variant="glass" @click="pickFile(true)">{{
                  $t('connection.createFile')
                }}</PressButton>
              </div>
            </FormField>
            <FormField
              v-if="shows('socket') && method === 'socket'"
              v-slot="{ id }"
              :label="$t('connection.socketPath')"
              class="span-2"
              ><TextInput
                :id="id"
                v-model="draft.socketPath"
                monospace
                placeholder="/var/run/postgresql"
            /></FormField>
            <FormField
              v-if="shows('url') && method === 'url'"
              v-slot="{ id }"
              :label="$t('connection.url')"
              class="span-2"
              ><TextInput :id="id" v-model="draft.url" monospace placeholder="mongodb+srv://…"
            /></FormField>
            <FormField
              v-if="shows('host') && method === 'host'"
              v-slot="{ id }"
              :label="$t('connection.host')"
              ><TextInput :id="id" v-model="draft.host" placeholder="localhost"
            /></FormField>
            <FormField
              v-if="descriptor.defaultPort && method === 'host'"
              v-slot="{ id }"
              :label="$t('connection.port')"
              ><TextInput
                :id="id"
                v-model="draft.port"
                type="number"
                :placeholder="String(descriptor.defaultPort)"
            /></FormField>
          </div>
          <fieldset
            v-if="(shows('username') || shows('password')) && method !== 'url'"
            class="group"
          >
            <div class="pairs">
              <FormField
                v-if="shows('username')"
                v-slot="{ id }"
                :label="$t('connection.user')"
              >
                <TextInput :id="id" v-model="draft.username" />
              </FormField>

              <FormField
                v-if="shows('password')"
                v-slot="{ id }"
                :label="$t('connection.password')"
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
                    :aria-label="
                      revealed ? $t('connection.hidePassword') : $t('connection.showPassword')
                    "
                    v-tip="
                      revealed ? $t('connection.hidePassword') : $t('connection.showPassword')
                    "
                    @click="revealed = !revealed"
                  >
                    <AppIcon :name="revealed ? 'eyeOff' : 'eye'" :size="13" />
                  </button>
                </div>
              </FormField>

              <!--
            Whether the password is kept belongs with the password, not three
            groups below it beside an unrelated switch about writes.

            Nothing to keep for a file: SQLite and DuckDB are opened by path, so
            a checkbox about the keyring on that form is a control that cannot
            act on anything the reader has typed — which is why this sits in the
            group that only exists when there are credentials at all.
          -->
              <CheckBox
                v-if="draft.engine && !isFileEngine(draft.engine)"
                v-model="draft.rememberSecrets"
                :label="$t('connection.savePassword')"
                :disabled="!keyringAvailable"
                :hint="
                  keyringAvailable
                    ? $t('connection.savePasswordHelp')
                    : $t('connection.noKeyringHelp')
                "
              />
            </div>
          </fieldset>

          <fieldset class="group">
            <div class="pairs">
              <FormField
                v-for="option in visibleOptions"
                :key="option.key"
                v-slot="{ id }"
                :label="option.label"
                :help="option.help"
              >
                <!--
              The app's own list. These are a driver's own options — a Postgres
              SSL mode, a DynamoDB region — and a native `<select>` here hands
              the popup to the operating system to draw in the middle of a sheet
              built from our own tokens.
            -->
                <SelectMenu
                  v-if="option.kind === 'select'"
                  :id="id"
                  v-model="draft.options[option.key]"
                  :options="option.choices ?? []"
                  :aria-label="option.label"
                />
                <TextInput
                  v-else
                  :id="id"
                  v-model="draft.options[option.key]"
                  :type="option.kind === 'password' ? 'password' : 'text'"
                />
              </FormField>

              <CheckBox
                v-model="draft.readOnly"
                class="span-2"
                :label="$t('connection.readOnly')"
                :hint="$t('connection.readOnlyHelp')"
              />
            </div>
          </fieldset>
        </div>
        <div
          v-if="descriptor.supportsSsh || descriptor.supportsSsl"
          v-show="detailPage === 'security'"
        >
          <div class="advanced__body">
            <CheckBox
              v-if="descriptor.supportsSsl"
              v-model="draft.sslEnabled"
              :label="$t('connection.useSsl')"
            />

            <CheckBox
              v-if="descriptor.supportsSsh"
              v-model="draft.sshEnabled"
              :label="$t('connection.useSsh')"
            />

            <div v-if="draft.sshEnabled" class="pairs">
              <FormField v-slot="{ id }" :label="$t('connection.sshHost')" class="span-2">
                <TextInput :id="id" v-model="draft.sshHost" />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.sshPort')">
                <TextInput :id="id" v-model="draft.sshPort" type="number" />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.sshUser')">
                <TextInput :id="id" v-model="draft.sshUsername" />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.sshAuth')">
                <SelectMenu
                  :id="id"
                  v-model="draft.sshMode"
                  :options="sshModes"
                  :aria-label="$t('connection.sshAuth')"
                />
              </FormField>
              <FormField
                v-if="draft.sshMode === 'keyfile'"
                v-slot="{ id }"
                :label="$t('connection.sshKeyfile')"
              >
                <TextInput :id="id" v-model="draft.sshKeyfile" monospace />
              </FormField>
              <FormField
                v-if="draft.sshMode === 'password'"
                v-slot="{ id }"
                :label="$t('connection.sshPassword')"
              >
                <TextInput :id="id" v-model="draft.sshPassword" type="password" />
              </FormField>
              <FormField
                v-if="draft.sshMode === 'keyfile'"
                v-slot="{ id }"
                :label="$t('connection.sshPassphrase')"
                :help="$t('connection.sshPassphraseHelp')"
              >
                <TextInput :id="id" v-model="draft.sshPassphrase" type="password" />
              </FormField>
            </div>

            <!--
            The other way through. Offered only when a tunnel is not, because
            the two are alternatives and a form that lets you fill in both is a
            form that has to explain which one wins.
          -->
            <CheckBox
              v-if="descriptor.supportsSsh && !draft.sshEnabled"
              v-model="draft.proxyEnabled"
              :label="$t('connection.useProxy')"
            />

            <div
              v-if="descriptor.supportsSsh && draft.proxyEnabled && !draft.sshEnabled"
              class="pairs"
            >
              <FormField :label="$t('connection.proxyType')">
                <SegmentedControl
                  v-model="draft.proxyKind"
                  :options="proxyKinds"
                  :aria-label="$t('connection.proxyType')"
                />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.proxyHost')">
                <TextInput :id="id" v-model="draft.proxyHost" placeholder="127.0.0.1" />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.proxyPort')">
                <TextInput :id="id" v-model="draft.proxyPort" inputmode="numeric" />
              </FormField>
              <FormField
                v-slot="{ id }"
                :label="$t('connection.proxyUser')"
                :help="$t('connection.proxyUserHelp')"
              >
                <TextInput :id="id" v-model="draft.proxyUsername" autocomplete="off" />
              </FormField>
              <FormField v-slot="{ id }" :label="$t('connection.proxyPassword')">
                <TextInput :id="id" v-model="draft.proxyPassword" type="password" />
              </FormField>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="connection-welcome">
        <span class="connection-welcome__mark"><AppIcon name="database" :size="30" /></span>
        <h3>{{ $t('connection.welcomeTitle') }}</h3>
        <p>{{ $t('connection.welcomeHelp') }}</p>
        <FormField v-slot="{ id }" :label="$t('connection.pasteLabel')" :error="pasteError">
          <TextInput
            :id="id"
            v-model="pasted"
            monospace
            placeholder="postgresql://…"
            @keydown.enter.prevent="useUrl"
          />
        </FormField>
        <PressButton variant="glass" :disabled="!pasted.trim()" @click="useUrl">{{
          $t('connection.useDetails')
        }}</PressButton>
      </div>
    </section>
  </form>
</template>

<style scoped>
.connection-layout {
  display: grid;
  grid-template-columns: 11rem minmax(0, 1fr);
}
.engine-sidebar {
  padding: var(--gap-loose);
  background: var(--surface-well);
  border-inline-end: 1px solid var(--separator);
}
.engine-sidebar__label {
  margin-bottom: var(--gap);
  color: var(--text-soft);
}
.engine-sidebar__note {
  margin-top: var(--gap-loose);
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--text-soft);
}
.connection-details {
  padding: var(--gap-loose) var(--gap-section);
  max-height: min(30rem, max(22rem, calc(80vh - 8rem)), calc(92vh - 8rem));
  overflow-y: auto;
}
.detail-fields {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}
.file-actions {
  display: flex;
  gap: var(--gap);
}
.security-summary {
  margin-inline-start: auto;
  font-size: 0.6875rem;
  color: var(--text-soft);
}
.details-heading {
  display: flex;
  align-items: center;
  gap: var(--gap);
}
.details-heading h3 {
  font-size: 0.9375rem;
  font-weight: 600;
}
.details-heading p {
  margin-top: var(--gap-hair);
  font-size: 0.75rem;
  color: var(--text-soft);
}
.connection-welcome {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  justify-content: center;
  min-height: 20rem;
}
.connection-welcome__mark {
  color: var(--color-primary-text);
}
.connection-welcome h3 {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.025em;
}
.connection-welcome > p {
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--text-soft);
}
.connection-welcome > button {
  align-self: flex-start;
}
.method {
  align-self: flex-start;
}
@media (max-width: 600px) {
  .connection-layout {
    grid-template-columns: 9rem minmax(0, 1fr);
  }
  .connection-details {
    padding: var(--gap-loose);
  }
  .pairs {
    grid-template-columns: minmax(0, 1fr);
  }
  .row {
    flex-wrap: wrap;
  }
  .row > :first-child {
    flex-basis: 100%;
  }
}

.connection-details {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
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
  color: var(--text-soft);
  transition: color var(--t-hover) var(--ease-out);
}

.secret__reveal[aria-pressed='true'],
.secret__reveal:hover {
  color: var(--color-base-content);
}

/*
 * A group is what the fields in it mean.
 *
 * `fieldset` and `legend` rather than a div and a span, because the grouping is
 * the point and a screen reader gets it for free — every field inside is
 * announced with the group's name in front of it. The browser's own border and
 * padding go, since the separation here is a rule and a name rather than a box
 * drawn around a form.
 */
.group {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.group__name {
  padding: 0 0 var(--gap-tight);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-soft);
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
</style>
