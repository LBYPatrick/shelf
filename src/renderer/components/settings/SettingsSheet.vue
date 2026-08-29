<script setup lang="ts">
/**
 * Preferences.
 *
 * The appearance section is live: every control applies immediately, because
 * choosing an accent is a visual decision and you should be able to see it
 * being made rather than confirm and hope.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { LOCALES } from '../../i18n';
import { useTranslation } from 'i18next-vue';
import { useAssistant } from '../../stores/assistant';
import { useTheme } from '../../composables/useTheme';
import { usePlatform } from '../../composables/usePlatform';
import { rowLimitOptions, useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';
import { parseSettings, serializeSettings, type SettingsState } from '@shared/settingsFile';
import { documentFileName } from '@shared/fileNames';
import { errorMessage } from '@shared/errors';
import { DEFAULT_MATERIALS, MATERIAL_LIMITS, oklch } from '../../styles/theme';
import AppIcon from '../ui/AppIcon.vue';
import AppMark from '../ui/AppMark.vue';
import CheckBox from '../ui/CheckBox.vue';
import JsonEditor from '../ui/JsonEditor.vue';
import PressButton from '../ui/PressButton.vue';
import RangeSlider from '../ui/RangeSlider.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import ToggleSwitch from '../ui/ToggleSwitch.vue';
import Sheet from '../ui/Sheet.vue';
import { SYNTAX_SCHEMES } from '@shared/syntaxThemes';
import { applyOverrides, currentOverrides, resetKeymap } from '../../lib/keybindings';
import PaletteStrip from './PaletteStrip.vue';

const open = defineModel<boolean>({ required: true });
/*
 * The provider list is a sheet of its own rather than a section here, because
 * it is a list with an editor behind it — two levels of navigation inside a
 * pane that is already a long scroll. Settings names it and hands it over.
 */
const emit = defineEmits<{
  'manage-providers': [];
  'manage-shortcuts': [];
  'manage-storage': [];
}>();

const assistant = useAssistant();
const theme = useTheme();
const settings = useSettings();
const platform = usePlatform();

const toasts = useToasts();
const { t } = useTranslation();

/**
 * The row limit, as the same seven choices the query toolbar offers.
 *
 * A value saved before the list existed is offered alongside it rather than
 * quietly replaced — a setting that changes itself when you open the pane that
 * shows it is worse than one that is out of date.
 */
const rowLimits = computed(() => rowLimitOptions(settings.values.maxRows, t));

const maxRows = computed<string>({
  get: () => String(settings.values.maxRows),
  set: (value) => (settings.values.maxRows = Number(value)),
});

/*
 * Two views of one state.
 *
 * The form is the good way to change a setting and a document is the good way
 * to move all of them, so neither is the "real" one: the JSON is read from the
 * live values every time it is opened, and applying it writes back through the
 * same stores the controls do. There is no third copy to fall out of step.
 */
const view = ref<'visual' | 'json'>('visual');

const views = computed(() => [
  { value: 'visual' as const, label: t('settings.viewVisual') },
  { value: 'json' as const, label: t('settings.viewJson') },
]);

function currentState(): SettingsState {
  return {
    appearance: {
      mode: theme.mode,
      density: theme.density,
      accent: { l: theme.accent.l, c: theme.accent.c, h: theme.accent.h },
      opacity: theme.materials.opacity,
      syntax: { ...theme.syntax },
    },
    preferences: { ...settings.values },
    keymap: currentOverrides(),
  };
}

function applyState(state: SettingsState): void {
  theme.mode = state.appearance.mode as typeof theme.mode;
  theme.density = state.appearance.density as typeof theme.density;
  theme.accent = state.appearance.accent;
  theme.materials = { ...theme.materials, opacity: state.appearance.opacity };
  theme.syntax = { ...state.appearance.syntax };
  settings.values = { ...settings.values, ...state.preferences } as typeof settings.values;
  applyOverrides(state.keymap);
}

const jsonText = ref(serializeSettings(currentState()));

/** The JSON is a snapshot, so it is retaken whenever that view is entered. */
watch(view, (next) => {
  if (next === 'json') jsonText.value = serializeSettings(currentState());
});

const jsonError = computed(() => {
  const result = parseSettings(jsonText.value, currentState());
  return result.ok ? '' : result.error;
});

function applyJson(): void {
  const result = parseSettings(jsonText.value, currentState());
  if (!result.ok) {
    toasts.show({ id: 'settings-json', tone: 'error', message: result.error });
    return;
  }
  applyState(result.state);
  toasts.show({ id: 'settings-json', tone: 'success', message: t('settings.applied') });
}

async function exportSettings(): Promise<void> {
  const path = await window.shelf.dialogs.writeTextFile(
    {
      title: t('settings.exportTitle'),
      defaultPath: documentFileName('shelf-settings', 'settings'),
      extensions: ['json'],
    },
    serializeSettings(currentState())
  );
  if (path)
    toasts.show({ id: 'settings-file', tone: 'success', message: t('settings.exported') });
}

async function importSettings(): Promise<void> {
  const file = await window.shelf.dialogs.readTextFile({
    title: t('settings.importTitle'),
    extensions: ['json'],
  });
  if (!file) return;

  const result = parseSettings(file.text, currentState());
  if (!result.ok) {
    toasts.show({ id: 'settings-file', tone: 'error', message: result.error });
    return;
  }
  applyState(result.state);
  jsonText.value = serializeSettings(currentState());
  toasts.show({ id: 'settings-file', tone: 'success', message: t('settings.imported') });
}

const modes = computed(() => [
  { value: 'system' as const, label: t('settings.system') },
  { value: 'light' as const, label: t('settings.light') },
  { value: 'dark' as const, label: t('settings.dark') },
]);

/*
 * Named, not translated. A colour scheme is a proper noun — "Nord" is Nord in
 * every language, and a list of translated scheme names is a list nobody can
 * match against the editor they saw it in.
 */
const schemes = SYNTAX_SCHEMES.map((scheme) => ({ value: scheme.id, label: scheme.name }));

const densities = computed(() => [
  { value: 'compact' as const, label: t('settings.compact') },
  { value: 'default' as const, label: t('settings.default') },
  { value: 'comfortable' as const, label: t('settings.comfortable') },
]);

const triggers = computed(() => [
  { value: 'dblclick' as const, label: t('settings.doubleClick') },
  { value: 'click' as const, label: t('settings.singleClick') },
]);

const encodings = computed(() => [
  { value: 'hex' as const, label: t('settings.hex') },
  { value: 'base64' as const, label: t('settings.base64') },
]);

const runActions = computed(() => [
  { value: 'all' as const, label: t('settings.runAll') },
  { value: 'current' as const, label: t('settings.runCurrent') },
]);

/**
 * Copying the whole document, from the header.
 *
 * Sitting beside the view switcher because it is the same thought: this is what
 * your settings *are*, either to read or to take away. Writing a file is a
 * different act and lives in a section with importing, which is its opposite.
 */
async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(serializeSettings(currentState()));
    toasts.show({ id: 'settings-file', tone: 'success', message: t('action.copied') });
  } catch (caught) {
    toasts.show({ id: 'settings-file', tone: 'error', message: errorMessage(caught) });
  }
}

/*
 * Arms on the first press and forgets after a few seconds, so a stray click
 * cannot wipe a customised setup and an abandoned one does not stay armed.
 *
 * A confirmation dialog would be a sheet opened from a sheet for a button
 * nobody presses by accident twice, and an undo toast raised from here would be
 * dismissed along with the sheet that raised it.
 */
const confirmingReset = ref(false);
let disarm: ReturnType<typeof setTimeout> | undefined;

/** Long enough to read the second label, short enough not to stay dangerous. */
const DISARM_MS = 4000;

/**
 * Everything on this page back to what it ships as.
 *
 * It used to be "reset data settings", which put back two of the four groups
 * this sheet holds and left the appearance and the shortcuts alone. That is the
 * shape of a control nobody can predict: somebody who has made the window
 * unreadable presses the only button called Reset and the window does not
 * change. Each store answers for its own defaults — the sheet does not hold a
 * list of what a default is, because a list here is a second one to keep in
 * step with three files.
 */
function resetAll(): void {
  clearTimeout(disarm);

  if (!confirmingReset.value) {
    confirmingReset.value = true;
    disarm = setTimeout(() => (confirmingReset.value = false), DISARM_MS);
    return;
  }

  confirmingReset.value = false;
  theme.reset();
  settings.reset();
  resetKeymap();
  toasts.show({ id: 'settings-file', tone: 'success', message: t('settings.wasReset') });
}

// A sheet that is closed while the button is armed opens disarmed.
watch(open, (isOpen) => {
  if (isOpen) return;
  clearTimeout(disarm);
  confirmingReset.value = false;
});

onBeforeUnmount(() => clearTimeout(disarm));

/**
 * The accent is chosen from presets rather than from a free colour well. The
 * derivation can make any hue readable, so a well was safe — it just was not
 * useful: a continuous strip invites picking a colour by dragging, and every
 * position on it lands on a shade of the one beside it. Eight decided colours
 * are a choice; three hundred and sixty are a chore.
 */
/*
 * The slider works in hundredths so it can step in twentieths without carrying
 * floating-point dust into the store; the label puts the decimal back.
 */
const opacity = computed({
  get: () => Math.round(theme.materials.opacity * 100),
  set: (value: number) => {
    theme.materials = { ...theme.materials, opacity: value / 100 };
  },
});

const OPACITY_FLOOR = Math.round(MATERIAL_LIMITS.opacity.min * 100);

const materialsAreDefault = computed(
  () => theme.materials.opacity === DEFAULT_MATERIALS.opacity
);

/*
 * Its own sheet, not a fifth section here.
 *
 * Changing a shortcut is a different act from changing a preference: you do it
 * by performing it, which means a surface that eats the keyboard while it is
 * armed. That does not belong in the middle of a scrolling form.
 */
/*
 * Asked for here, opened by the window — the same arrangement the provider
 * editor has, and for the same reason: the palette can reach it too, and a
 * surface owned by one control can only ever be opened from that one.
 */

const languageOptions = computed(() => [
  { value: 'system', label: t('settings.followSystem') },
  ...LOCALES.map((locale) => ({ value: locale.id, label: locale.endonym })),
]);
</script>

<template>
  <Sheet v-model="open" :title="$t('settings.title')" icon="settings" flush>
    <!--
      What the sheet is showing sits beside its name; what it can do sits at the
      far end with the close button. The switcher used to be the first thing
      *inside* the body, which spent a row of the scrolling area on chrome and
      pushed the first actual setting under the fold.
    -->
    <template #lead>
      <SegmentedControl v-model="view" :options="views" :aria-label="$t('settings.title')" />
    </template>

    <div v-show="view === 'visual'" class="panels">
      <!--
        Every section is a heading, a sentence saying what it is for, and one
        card of rows.

        The sentence is the part that was missing. A column of labelled fields
        under a grey uppercase word tells you what each control *is* and never
        what the group is for, so "Materials" was a slider with no explanation
        of what it acts on. And the rows are a card rather than a stack of
        fields, because a card with inset rules reads as one list of settings
        where full-bleed lines read as a stack of unrelated slices.
      -->
      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.appearance') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.appearanceDesc') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{ $t('settings.theme') }}</span>
            <SegmentedControl
              v-model="theme.mode"
              class="row__control"
              :options="modes"
              :aria-label="$t('settings.theme')"
            />
          </div>

          <div class="row">
            <span class="row__label">
              {{ $t('settings.accent') }}
              <span class="row__hint">{{ $t('settings.accentHelp') }}</span>
            </span>
            <div class="row__control accents">
              <button
                v-for="preset in theme.presets"
                :key="preset.id"
                class="accent"
                :class="{ 'accent--on': theme.activePreset?.id === preset.id }"
                :style="{ '--chip': oklch(preset.seed) }"
                :aria-pressed="theme.activePreset?.id === preset.id"
                :title="preset.name"
                @click="theme.accent = preset.seed"
              >
                <span class="sr-only">{{ preset.name }}</span>
              </button>
            </div>
          </div>

          <div class="row">
            <span class="row__label">{{ $t('settings.density') }}</span>
            <SegmentedControl
              v-model="theme.density"
              class="row__control"
              :options="densities"
              :aria-label="$t('settings.density')"
            />
          </div>

          <!--
            Two schemes, because a palette drawn for a dark background is
            unreadable on a light one — one picker would be offering to make the
            editor illegible half the time. The switch is the shortcut for the
            common case: take a family and use both of its halves.
          -->
          <div class="row">
            <span class="row__label">
              {{ $t('settings.syntax') }}
              <span class="row__hint">{{ $t('settings.syntaxHelp') }}</span>
            </span>
            <ToggleSwitch
              v-model="theme.syntax.sync"
              class="row__control"
              :aria-label="$t('settings.syntaxSync')"
            />
          </div>

          <div class="row">
            <span class="row__label">{{
              theme.syntax.sync ? $t('settings.syntaxBoth') : $t('settings.syntaxLight')
            }}</span>
            <!--
              The specimen sits with the picker, on its side of the row: a name
              and what the name looks like are one answer, and separating them
              puts the reader back to choosing, looking, and coming back.
            -->
            <span class="row__control scheme">
              <SelectMenu
                v-model="theme.syntax.light"
                class="scheme__pick"
                :options="schemes"
                :aria-label="$t('settings.syntaxLight')"
              />
              <PaletteStrip
                :light="theme.syntax.light"
                :dark="theme.syntax.dark"
                :appearances="theme.syntax.sync ? ['light', 'dark'] : ['light']"
                :label="$t('settings.syntaxPreview')"
              />
            </span>
          </div>

          <div v-if="!theme.syntax.sync" class="row">
            <span class="row__label">{{ $t('settings.syntaxDark') }}</span>
            <span class="row__control scheme">
              <SelectMenu
                v-model="theme.syntax.dark"
                class="scheme__pick"
                :options="schemes"
                :aria-label="$t('settings.syntaxDark')"
              />
              <PaletteStrip
                :light="theme.syntax.light"
                :dark="theme.syntax.dark"
                :appearances="['dark']"
                :label="$t('settings.syntaxPreview')"
              />
            </span>
          </div>
        </div>
      </section>

      <!--
        Materials get their own section rather than sitting under Appearance.
        They are the one pair of settings whose effect you can watch happen —
        this sheet is itself a piece of glass — and burying them under the
        accent swatches would put the demonstration off screen while you drag.
      -->
      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.materials') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.opacityHelp') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{ $t('settings.opacity') }}</span>
            <RangeSlider
              v-model="opacity"
              class="row__control row__control--wide"
              :min="OPACITY_FLOOR"
              :max="100"
              :step="5"
              :aria-label="$t('settings.opacity')"
              :display="(opacity / 100).toFixed(2)"
            />
          </div>

          <div v-if="!materialsAreDefault" class="row">
            <span class="row__label">{{ $t('settings.resetMaterials') }}</span>
            <!--
              The row says what is being reset and the button carries the verb,
              which leaves two buttons in this sheet both reading "Reset". The
              name a screen reader gets is the whole phrase, because a control
              is announced without the row it sits in.
            -->
            <PressButton
              class="row__control"
              size="sm"
              :aria-label="$t('settings.resetMaterials')"
              @click="theme.resetMaterials"
            >
              {{ $t('action.reset') }}
            </PressButton>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.data') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.dataDesc') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <label class="row__label" for="settings-page-size">{{
              $t('settings.rowsPerPage')
            }}</label>
            <input
              id="settings-page-size"
              v-model.number="settings.values.pageSize"
              class="textfield row__control row__control--number"
              type="number"
              min="10"
              max="1000"
              step="10"
            />
          </div>

          <!--
            The same seven choices the query toolbar offers, from the same list.
            It was a free number box here and nothing at all there, so the limit
            was a preference you had to leave the query to change — and any
            number at all could be typed into it, including ones that make the
            app hold a million rows in memory.
          -->
          <div class="row">
            <span class="row__label">
              {{ $t('settings.maxRows') }}
              <span class="row__hint">{{ $t('settings.maxRowsHelp') }}</span>
            </span>
            <SelectMenu
              v-model="maxRows"
              class="row__control row__control--select"
              :options="rowLimits"
              :aria-label="$t('settings.maxRows')"
            />
          </div>

          <!--
            Which statement ⌘↩ runs was reachable only from the command palette,
            so this pane did not show the whole of what can be changed and the
            JSON view listed a key with no visual counterpart. Same words as the
            query bar uses, so the two surfaces cannot drift.
          -->
          <div class="row">
            <span class="row__label">{{ $t('settings.primaryRun') }}</span>
            <SegmentedControl
              v-model="settings.values.primaryRun"
              class="row__control"
              :options="runActions"
              :aria-label="$t('settings.primaryRun')"
            />
          </div>

          <div class="row">
            <span class="row__label">{{ $t('settings.editTrigger') }}</span>
            <SegmentedControl
              v-model="settings.values.editTrigger"
              class="row__control"
              :options="triggers"
              :aria-label="$t('settings.editTrigger')"
            />
          </div>

          <div class="row">
            <span class="row__label">{{ $t('settings.binaryAs') }}</span>
            <SegmentedControl
              v-model="settings.values.binaryEncoding"
              class="row__control"
              :options="encodings"
              :aria-label="$t('settings.binaryAs')"
            />
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.editor') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.editorDesc') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <label class="row__label" for="settings-font-size">{{
              $t('settings.fontSize')
            }}</label>
            <input
              id="settings-font-size"
              v-model.number="settings.values.editorFontSize"
              class="textfield row__control row__control--number"
              type="number"
              min="10"
              max="24"
            />
          </div>

          <!--
            The caption points at the input rather than wrapping it: a `<label>`
            around this component would put a label inside a label, which is
            neither valid nor answerable by a screen reader. Clicking the words
            still toggles it, which is the part that matters.
          -->
          <div class="row">
            <label class="row__label" for="settings-wrap-lines">{{
              $t('settings.wrapLines')
            }}</label>
            <CheckBox
              id="settings-wrap-lines"
              v-model="settings.values.wrapLines"
              class="row__control"
            />
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.language') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.languageHelp') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{ $t('settings.language') }}</span>
            <SelectMenu
              v-model="settings.values.language"
              class="row__control row__control--select"
              :options="languageOptions"
              :aria-label="$t('settings.language')"
            />
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.keyboard') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.keyboardHelp') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{ $t('settings.keyboardRow') }}</span>
            <PressButton class="row__control" size="sm" @click="emit('manage-shortcuts')">
              <AppIcon name="keyboard" :size="13" />
              {{ $t('settings.keyboardOpen') }}
            </PressButton>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('assistant.title') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('assistant.settingsDesc') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{
              assistant.configured
                ? $t('assistant.configuredCount', { count: assistant.providers.length })
                : $t('assistant.noProviderYet')
            }}</span>
            <PressButton
              class="row__control"
              size="sm"
              @click="
                open = false;
                emit('manage-providers');
              "
            >
              <AppIcon name="assistant" filled :size="13" />
              {{ $t('assistant.manageProviders') }}
            </PressButton>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.file') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.fileDesc') }}
          </p>
        </div>

        <div class="rows">
          <!-- The row says what happens; the button carries the verb. -->
          <div class="row">
            <span class="row__label">{{ $t('settings.exportRow') }}</span>
            <PressButton class="row__control" size="sm" @click="exportSettings">
              <AppIcon name="download" :size="13" />
              {{ $t('settings.exportSettings') }}
            </PressButton>
          </div>

          <div class="row">
            <span class="row__label">{{ $t('settings.importRow') }}</span>
            <PressButton class="row__control" size="sm" @click="importSettings">
              <AppIcon name="upload" :size="13" />
              {{ $t('settings.importSettings') }}
            </PressButton>
          </div>
        </div>
      </section>

      <!--
        Stored data is its own sheet, for the reason the provider list is.
        ────────────────────────────────────────────────────────────────
        It is seven categories with sizes beside them and a destructive verb at
        the end — a panel, not a row. Settings names it and hands it over, and
        the palette opens the same sheet directly, which is exactly why the
        surface is owned by the view rather than by this control.
      -->
      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('storage.title') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('storage.row') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row__label">{{ $t('storage.manage') }}</span>
            <PressButton class="row__control" size="sm" @click="emit('manage-storage')">
              <AppIcon name="database" :size="13" />
              {{ $t('storage.open') }}
            </PressButton>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <div class="panel-section__head">
          <h3 class="type-title">
            {{ $t('settings.resetAll') }}
          </h3>
          <p class="panel-section__desc">
            {{ $t('settings.resetDesc') }}
          </p>
        </div>

        <div class="rows">
          <div class="row">
            <!--
              Two steps rather than a dialog, and it disarms itself.
              A confirmation sheet opened from a sheet is a stack two deep for a
              button nobody presses on purpose, and an undo toast is no help
              either: it would be dismissed with the sheet that raised it. So
              the button arms, and forgets if you walk away.
            -->
            <span class="row__label">{{
              confirmingReset ? $t('settings.resetConfirm') : $t('settings.resetRow')
            }}</span>
            <PressButton
              class="row__control"
              size="sm"
              :variant="confirmingReset ? 'danger' : undefined"
              :aria-label="
                confirmingReset ? $t('settings.resetConfirm') : $t('settings.resetRow')
              "
              @click="resetAll"
            >
              <AppIcon name="refresh" :size="13" />
              {{ confirmingReset ? $t('action.confirm') : $t('action.reset') }}
            </PressButton>
          </div>
        </div>
      </section>

      <!--
        Which app this is, and which one of it.
        ──────────────────────────────────────
        At the foot rather than the head: settings are opened to change
        something, and a banner above the first control spends the top of the
        sheet on a fact read once. It is not a section either — there is nothing
        here to set — so it takes no heading and no card, and sits centred and
        quiet under the last of them, the way an About pane does.

        The version comes from the running app rather than from a constant
        compiled in beside it, so a build can only ever report what it is.
      -->
      <footer class="about">
        <AppMark :size="80" />
        <p class="about__name">
          {{ $t('app.name') }}
        </p>
        <p class="about__version">
          {{ $t('settings.version', { version: platform.info.appVersion }) }}
        </p>
      </footer>
    </div>

    <!--
      The same settings, as the file they are stored as. Kept mounted rather
      than swapped in, so switching views does not tear down an editor and lose
      the caret in a document someone is halfway through editing.

      Full-bleed: the body's padding is cancelled rather than the editor being
      inset inside it, because a code surface with a margin around it reads as a
      widget on a page, and this view *is* the page.
    -->
    <div v-show="view === 'json'" class="json">
      <JsonEditor v-model="jsonText" class="json__editor" :label="$t('settings.viewJson')" />

      <!--
        The document's own bar: what it is, and what can be done with it.
        ────────────────────────────────────────────────────────────────
        Copying used to sit in the sheet's header, pinned across both views —
        where it was one verb among the *sheet's* controls, next to the switcher
        and the close, and it acted on something only one of the two views shows
        you. It belongs beside the thing it copies. The bar is where the reader
        already is when they are looking at the document, and it now reads as a
        row: a state on the left, the actions on the right, one of them filled.
      -->
      <div class="json__bar">
        <span v-if="jsonError" class="json__state json__state--error" role="alert">
          <AppIcon name="warning" :size="13" />
          {{ jsonError }}
        </span>
        <span v-else class="json__state json__state--ok">
          <AppIcon name="check" :size="13" />
          {{ $t('settings.jsonValid') }}
        </span>

        <span class="json__count" aria-hidden="true">·</span>
        <span class="json__count">{{
          $t('settings.jsonLines', { count: jsonText.split('\n').length })
        }}</span>

        <span class="json__gap" />

        <button
          v-tip="$t('settings.copyHint')"
          type="button"
          class="json__action focus-fill"
          @click="copyToClipboard"
        >
          <AppIcon name="copy" :size="12" />
          {{ $t('settings.copy') }}
        </button>

        <button
          v-tip="$t('settings.exportRow')"
          type="button"
          class="json__action focus-fill"
          @click="exportSettings"
        >
          <AppIcon name="download" :size="12" />
          {{ $t('settings.exportSettings') }}
        </button>

        <PressButton size="sm" variant="primary" :disabled="!!jsonError" @click="applyJson">
          {{ $t('action.apply') }}
        </PressButton>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
/*
 * The panes, in the shape the sibling project settled on: a column of sections,
 * each a heading, a sentence and one card of rows.
 *
 * What was here was a stack of labelled fields divided by hairlines, with the
 * view switcher inside the scrolling area and four buttons along the bottom —
 * so the sheet opened on a row of chrome, and the things you could *do* to your
 * settings were as loud as the settings themselves. Import, export and reset
 * are now rows like any other, in sections that say what they are for.
 */
/*
 * The body carries its own padding, and the rule above it spans the sheet.
 *
 * The JSON view is full-bleed — the editor *is* the page — so the line between
 * the header and the document ran edge to edge, while the visual view had no
 * line at all and its content simply began. Two views of one popup, separated
 * from their own title in two different ways, and the switcher above them
 * inviting a comparison. So the sheet is flush in both and the padding moves in
 * here, where the line can be full width in both.
 */
.panels {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  padding: var(--gap-loose) var(--gap-section) var(--gap-section);
  border-top: 1px solid var(--separator);
}

/*
 * Type that grows tightens: the name is set a step above body copy with the
 * tracking pulled in, and the version sits under it at the size of a caption in
 * the muted colour. Weight carries the difference between them rather than
 * another size step — the two lines are one block, not two headings.
 */
.about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-tight);
  padding-block: var(--gap-section) var(--gap-loose);
  text-align: center;
}

.about__name {
  margin-top: var(--gap-tight);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.012em;
}

.about__version {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}

.panel-section__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panel-section__desc {
  font-size: 0.75rem;
  line-height: 1.5;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

/*
 * A grouped list, and the two things that make it one rather than a stack of
 * bordered boxes.
 *
 * The separator is inset to where the labels start instead of running wall to
 * wall: a full-bleed rule cuts the card into slices, an inset one reads as one
 * card with rows in it and points at the column the labels are in. And the
 * card is a *tint* with a hairline, not a raised surface — it sits on the
 * sheet, which is already the front-most object in the window.
 */
.rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--separator);
  border-radius: var(--radius-box);
  background: var(--fill-4);
  overflow: hidden;
}

.rows + .rows {
  margin-top: var(--gap);
}

.row {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap);
  min-height: 3.25rem;
  padding: var(--gap) var(--gap-loose);
  font-size: 0.8125rem;
  font-weight: 500;
}

.row + .row::before {
  content: '';
  position: absolute;
  top: 0;
  inset-inline: var(--gap-loose) 0;
  height: 1px;
  background: var(--separator);
}

.row__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

label.row__label {
  cursor: pointer;
}

/* The sentence that used to be a `help` line under the field. It belongs with
   the label, not under the control: it says what the setting means. */
.row__hint {
  max-width: 46ch;
  font-size: 0.6875rem;
  font-weight: 400;
  line-height: 1.45;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.row__label--group {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--color-base-content) 48%, transparent);
}

.row--header {
  min-height: 0;
  padding-block: var(--gap-tight);
  background: color-mix(in oklab, var(--color-base-content) 3%, transparent);
}

/* One column of controls down the right edge, whatever each of them is. */
.row__control {
  flex: 0 0 auto;
  margin-inline-start: auto;
}

.row__control--number {
  width: 5.5rem;
}

/* The picker and its specimen are one control as far as the row is concerned. */
.scheme {
  display: flex;
  align-items: center;
  gap: var(--gap);
}

.scheme__pick {
  width: 11rem;
}

/* Wide enough for its longest option and no wider; `SelectMenu` fills what it
   is given, and given the row it would take the whole of it. */
.row__control--select {
  width: 14rem;
}

.row__control--wide {
  width: min(20rem, 60%);
}

.keys {
  display: flex;
  gap: var(--gap-tight);
}

.keys kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--separator-strong);
  background: var(--color-base-100);
  font-family: var(--font-ui);
  font-size: 0.625rem;
}

.accents {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--gap);
}

.accent {
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  background: var(--chip);
  transition: transform var(--t-press) var(--ease-out);
}

.accent:hover {
  transform: scale(1.1);
}

.accent:active {
  transform: scale(0.94);
}

.accent--on {
  box-shadow:
    0 0 0 2px var(--color-base-100),
    0 0 0 4px var(--chip);
}

/* A quiet verb in the header, the same shape the tab toolbars use. */
.tool {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .tool:hover {
    background-color: var(--fill-4);
    color: var(--color-base-content);
  }
}

/*
 * The document view fills the sheet.
 *
 * The body carries the padding every other view wants, so this one takes it
 * back rather than sitting inside it: an editor with a margin around it reads
 * as a widget dropped on a page, and here the editor *is* the page. The bar
 * underneath is the only chrome, butted against the sheet's own footer edge.
 */
.json {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--separator);
}

/*
 * The one thing in this app with a height of its own.
 *
 * Everything else in a sheet is content that ends somewhere, so the sheet can
 * ask how tall it is; a text editor does not end — it is a window onto a
 * document, and sizing it to the document would make the popup grow by a line
 * every time a line is typed into it. So the editor is given a definite size
 * here, chosen to leave the sheet's own ceiling unreached on any window worth
 * opening it on, and the sheet measures *that* like it measures everything
 * else: switching views animates between the two heights instead of both views
 * inheriting one.
 */
.json__editor {
  height: min(28rem, 52vh);
}

/*
 * The document's status bar.
 *
 * Its height comes from the control inside it plus an even margin either side,
 * rather than from a number that looked right — the same rhythm every other bar
 * in the app is built on, so this one does not read as a different kind of
 * furniture.
 *
 * Small text is tracked slightly *open*: type tightens as it grows and loosens
 * as it shrinks, and at eleven pixels the default spacing reads as cramped.
 */
.json__bar {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-height: calc(var(--field-h) + var(--gap));
  padding-inline: var(--gap-section);
  padding-block: calc(var(--gap) / 2);
  border-top: 1px solid var(--separator);
  background: var(--fill-4);
  font-size: 0.6875rem;
  letter-spacing: 0.01em;
}

.json__gap {
  flex: 1;
}

/* How long the document is. A fact about the thing on screen, in the row that
   describes it — and the reason the left of the bar is no longer four words. */
.json__count {
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.json__action {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  height: var(--field-h);
  padding-inline: var(--gap);
  border-radius: var(--control-radius);
  color: color-mix(in oklab, var(--color-base-content) 72%, transparent);
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

/* On the press, not the release: the acknowledgement has to land before the
   hand has finished the gesture, or the row feels slow however fast it is. */
.json__action:active {
  background-color: var(--fill-2);
  transform: scale(0.98);
}

@media (hover: hover) and (pointer: fine) {
  .json__action:hover {
    background-color: var(--fill-3);
    color: var(--color-base-content);
  }
}

@media (prefers-reduced-motion: reduce) {
  .json__action:active {
    transform: none;
  }
}

.json__state {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
}

.json__state--error {
  color: var(--color-error);
}

/*
 * Status, not decoration. The words stay quiet — they are the same four words
 * every time and nobody needs to read them twice — while the mark carries the
 * meaning in a colour, so "valid" is answered before anything is read. An error
 * takes the whole phrase, because that one does have to be read.
 */
.json__state--ok {
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.json__state--ok .icon {
  color: var(--color-success);
}

@media (prefers-reduced-motion: reduce) {
  .accent:hover,
  .accent:active {
    transform: none;
  }
}
</style>
