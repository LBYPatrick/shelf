<script setup lang="ts">
/**
 * Where the grid's row numbers start.
 *
 * One button rather than a pair of radios: there are exactly two answers, the
 * current one is written on the face, and pressing it gives you the other. A
 * segmented control for a binary that is read far more often than it is changed
 * would spend twice the width saying the same thing.
 *
 * It lives in the tab toolbars rather than in Settings because it belongs to
 * the grid you are looking at — but it is stored, because nobody wants to
 * answer it again in the next tab.
 */
import { useTranslation } from 'i18next-vue';
import { useSettings } from '../../stores/settings';

const settings = useSettings();
const { t } = useTranslation();

function toggle(): void {
  settings.values.rowIndexBase = settings.values.rowIndexBase === 1 ? 0 : 1;
}
</script>

<template>
  <button
    type="button"
    class="toolbar__action focus-fill"
    :title="t('grid.indexHint')"
    @click="toggle"
  >
    <span class="rowindex">{{
      settings.values.rowIndexBase === 0 ? t('grid.zeroBased') : t('grid.oneBased')
    }}</span>
  </button>
</template>

<style scoped>
/* Tabular figures so the label does not resize as the digit changes. */
.rowindex {
  font-variant-numeric: tabular-nums;
}
</style>
