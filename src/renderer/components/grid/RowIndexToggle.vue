<script setup lang="ts">
/**
 * Where the grid's row numbers start.
 *
 * Both answers on the face, the way every other either-or in this app is
 * offered — the same segmented control Settings uses for theme and density. It
 * was one button carrying the *current* value, which asks the reader to work
 * out that pressing "1-based" gives them 0-based; a control that shows only the
 * state it is in cannot say what pressing it will do, and for a setting nobody
 * touches twice a week that is a guess every time.
 *
 * It lives in the tab toolbars rather than in Settings because it belongs to
 * the grid you are looking at — but it is stored, because nobody wants to
 * answer it again in the next tab.
 */
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useSettings } from '../../stores/settings';
import SegmentedControl from '../ui/SegmentedControl.vue';

const settings = useSettings();
const { t } = useTranslation();

const bases = computed(() => [
  { value: '1', label: t('grid.oneBased') },
  { value: '0', label: t('grid.zeroBased') },
]);

/**
 * The stored value is a number and the control speaks in strings, so the
 * conversion happens here rather than at the two call sites.
 */
const base = computed<string>({
  get: () => String(settings.values.rowIndexBase),
  set: (value) => (settings.values.rowIndexBase = value === '0' ? 0 : 1),
});
</script>

<template>
  <SegmentedControl
    v-model="base"
    v-tip="$t('grid.indexHint')"
    class="rowindex"
    :options="bases"
    :aria-label="$t('grid.indexHint')"
  />
</template>

<style scoped>
/* Tabular figures so the two labels are the same width and the indicator that
   travels between them does not have to change size on the way. */
.rowindex {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
</style>
