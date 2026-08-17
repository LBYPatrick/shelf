<script setup lang="ts">
/**
 * Preferences.
 *
 * The appearance section is live: every control applies immediately, because
 * choosing an accent is a visual decision and you should be able to see it
 * being made rather than confirm and hope.
 */
import { computed } from 'vue';
import { BINDINGS, displayKeys } from '../../lib/keybindings';
import { LOCALES } from '../../i18n';
import { useTranslation } from 'i18next-vue';
import { useTheme } from '../../composables/useTheme';
import { useSettings } from '../../stores/settings';
import { DEFAULT_MATERIALS, MATERIAL_LIMITS, oklch } from '../../styles/theme';
import CheckBox from '../ui/CheckBox.vue';
import FormField from '../ui/FormField.vue';
import PressButton from '../ui/PressButton.vue';
import RangeSlider from '../ui/RangeSlider.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import SelectMenu from '../ui/SelectMenu.vue';
import Sheet from '../ui/Sheet.vue';

const open = defineModel<boolean>({ required: true });

const theme = useTheme();
const settings = useSettings();
const { t } = useTranslation();

const modes = computed(() => [
  { value: 'system' as const, label: t('settings.system') },
  { value: 'light' as const, label: t('settings.light') },
  { value: 'dark' as const, label: t('settings.dark') },
]);

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

const groups = computed(() => [...new Set(BINDINGS.map((binding) => binding.group))]);
const bindingsIn = (group: string) => BINDINGS.filter((binding) => binding.group === group);

const languageOptions = computed(() => [
  { value: 'system', label: t('settings.followSystem') },
  ...LOCALES.map((locale) => ({ value: locale.id, label: locale.endonym })),
]);
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('settings.title')"
  >
    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.appearance') }}
      </h3>

      <FormField :label="$t('settings.theme')">
        <SegmentedControl
          v-model="theme.mode"
          :options="modes"
          :aria-label="$t('settings.theme')"
        />
      </FormField>

      <FormField
        :label="$t('settings.accent')"
        :help="$t('settings.accentHelp')"
      >
        <div class="accents">
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
      </FormField>

      <FormField :label="$t('settings.density')">
        <SegmentedControl
          v-model="theme.density"
          :options="densities"
          :aria-label="$t('settings.density')"
        />
      </FormField>
    </section>

    <!--
      Materials get their own section rather than sitting under Appearance.
      They are the one pair of settings whose effect you can watch happen — this
      sheet is itself a piece of glass — and burying them under the accent
      swatches would put the demonstration off screen while you drag.
    -->
    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.materials') }}
      </h3>

      <FormField
        :label="$t('settings.opacity')"
        :help="$t('settings.opacityHelp')"
      >
        <RangeSlider
          v-model="opacity"
          :min="OPACITY_FLOOR"
          :max="100"
          :step="5"
          :aria-label="$t('settings.opacity')"
          :display="(opacity / 100).toFixed(2)"
        />
      </FormField>

      <PressButton
        v-if="!materialsAreDefault"
        class="section__reset"
        size="sm"
        @click="theme.resetMaterials"
      >
        {{ $t('settings.resetMaterials') }}
      </PressButton>
    </section>

    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.language') }}
      </h3>

      <FormField
        v-slot="{ id }"
        :label="$t('settings.language')"
        :help="$t('settings.languageHelp')"
      >
        <SelectMenu
          :id="id"
          v-model="settings.values.language"
          :options="languageOptions"
          :aria-label="$t('settings.language')"
        />
      </FormField>
    </section>

    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.data') }}
      </h3>

      <FormField
        v-slot="{ id }"
        :label="$t('settings.rowsPerPage')"
      >
        <input
          :id="id"
          v-model.number="settings.values.pageSize"
          class="textfield settings__number"
          type="number"
          min="10"
          max="1000"
          step="10"
        >
      </FormField>

      <FormField
        v-slot="{ id }"
        :label="$t('settings.maxRows')"
        :help="$t('settings.maxRowsHelp')"
      >
        <input
          :id="id"
          v-model.number="settings.values.maxRows"
          class="textfield settings__number"
          type="number"
          min="1000"
          max="1000000"
          step="1000"
        >
      </FormField>

      <FormField :label="$t('settings.editTrigger')">
        <SegmentedControl
          v-model="settings.values.editTrigger"
          :options="triggers"
          :aria-label="$t('settings.editTrigger')"
        />
      </FormField>

      <FormField :label="$t('settings.binaryAs')">
        <SegmentedControl
          v-model="settings.values.binaryEncoding"
          :options="encodings"
          :aria-label="$t('settings.binaryAs')"
        />
      </FormField>
    </section>

    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.editor') }}
      </h3>

      <FormField
        v-slot="{ id }"
        :label="$t('settings.fontSize')"
      >
        <input
          :id="id"
          v-model.number="settings.values.editorFontSize"
          class="textfield settings__number"
          type="number"
          min="10"
          max="24"
        >
      </FormField>

      <CheckBox
        v-model="settings.values.wrapLines"
        :label="$t('settings.wrapLines')"
      />
    </section>

    <section class="section">
      <h3 class="type-label section__title">
        {{ $t('settings.keyboard') }}
      </h3>

      <p class="hint">
        {{ $t('settings.keyboardHelp') }}
      </p>

      <div
        v-for="group in groups"
        :key="group"
        class="keys"
      >
        <h4 class="type-label keys__group">
          {{ group }}
        </h4>
        <div
          v-for="binding in bindingsIn(group)"
          :key="binding.id"
          class="keys__row"
        >
          <span>{{ binding.label }}</span>
          <span class="keys__combo">
            <kbd
              v-for="accelerator in binding.keys"
              :key="accelerator"
            >{{
              displayKeys(accelerator)
            }}</kbd>
          </span>
        </div>
      </div>
    </section>

    <template #footer>
      <PressButton @click="settings.reset()">
        {{ $t('settings.resetData') }}
      </PressButton>
      <PressButton
        variant="primary"
        @click="open = false"
      >
        {{ $t('action.done') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
  padding-block: var(--gap-loose);
}

.section + .section {
  border-top: 1px solid var(--separator);
}

/* The section is a column, so a button in it stretches unless told not to. */
.section__reset {
  align-self: flex-start;
}

.section__title {
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hint {
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 52%, transparent);
}

.keys__group {
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
  padding-block: var(--gap-tight);
}

.keys__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding-block: 2px;
  font-size: 0.75rem;
}

.keys__combo {
  display: flex;
  gap: var(--gap-tight);
}

.keys__combo kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--separator-strong);
  background: var(--fill-4);
  font-family: var(--font-ui);
  font-size: 0.625rem;
}

.accents {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap);
}

.accent {
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  background: var(--chip);
  transition: transform 100ms ease-out;
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

/*
 * The slider is painted with the hues it selects, so the control shows its own
 * range rather than requiring you to guess what a number means.
 */

/* A row count is four digits. A field eight characters wide invites eight. */
.settings__number {
  width: 6rem;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--gap);
  font-size: 0.8125rem;
}

@media (prefers-reduced-motion: reduce) {
  .accent:hover,
  .accent:active {
    transform: none;
  }
}
</style>
