<script setup lang="ts">
/**
 * A query plan, in a window of its own.
 *
 * It used to replace the result grid, which made "how would this run" and "what
 * does this return" the same slot — so looking at the plan meant losing the
 * rows, and coming back meant running the statement again. A plan is something
 * you consult *about* a statement rather than an alternative result of it, so
 * it opens in front and closes back to what you were looking at.
 *
 * It also leaves: a plan is the thing people paste into a review or an issue,
 * and until now the only way to do that was a screenshot of part of it.
 */
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { PlanNode } from '@shared/explain';
import { documentFileName } from '@shared/fileNames';
import { errorMessage } from '@shared/errors';
import { useToasts } from '../../stores/toasts';
import AppIcon from '../ui/AppIcon.vue';
import Sheet from '../ui/Sheet.vue';
import ExplainTree from './ExplainTree.vue';

const props = defineProps<{ plan: PlanNode | null }>();
const open = defineModel<boolean>({ required: true });

const toasts = useToasts();
const { t } = useTranslation();

const tree = ref<InstanceType<typeof ExplainTree>>();

/**
 * The name is stamped when the file is asked for rather than when the sheet
 * opens, so two exports a minute apart differ — and it carries the same shape
 * as every other document the app writes.
 */
function nameFor(extension: 'svg' | 'png'): string {
  return documentFileName('query-plan', 'plan', extension);
}

async function exportSvg(): Promise<void> {
  const markup = tree.value?.toSvg();
  if (!markup) return;

  try {
    const path = await window.shelf.dialogs.writeTextFile(
      { title: t('plan.exportSvg'), defaultPath: nameFor('svg'), extensions: ['svg'] },
      markup
    );
    if (path) toasts.show({ id: 'plan-export', tone: 'success', message: t('plan.exported') });
  } catch (caught) {
    toasts.show({ id: 'plan-export', tone: 'error', message: errorMessage(caught) });
  }
}

async function exportPng(): Promise<void> {
  try {
    const base64 = await tree.value?.toPng();
    if (!base64) return;

    const path = await window.shelf.dialogs.writeBinaryFile(
      { title: t('plan.exportPng'), defaultPath: nameFor('png'), extensions: ['png'] },
      base64
    );
    if (path) toasts.show({ id: 'plan-export', tone: 'success', message: t('plan.exported') });
  } catch (caught) {
    toasts.show({ id: 'plan-export', tone: 'error', message: errorMessage(caught) });
  }
}

void props;
</script>

<template>
  <Sheet v-model="open" :title="$t('plan.title')" icon="diagram" broad>
    <!--
      Both formats, side by side, because which one is right depends entirely on
      where it is going: a vector for a document that will be read at some other
      size, a raster for anywhere that will not take one.
    -->
    <template #header>
      <button type="button" class="tool focus-fill" :disabled="!plan" @click="exportSvg">
        <AppIcon name="download" :size="13" />
        SVG
      </button>
      <button type="button" class="tool focus-fill" :disabled="!plan" @click="exportPng">
        <AppIcon name="download" :size="13" />
        PNG
      </button>
    </template>

    <div class="plansheet">
      <ExplainTree v-if="plan" ref="tree" :plan="plan" />
    </div>
  </Sheet>
</template>

<style scoped>
/*
 * The diagram is as tall as the plan is deep, and the sheet follows it — a
 * three-node plan gets a small window rather than the same eight-tenths of the
 * screen a forty-node one needs. Past that the sheet caps itself and this is
 * the surface that scrolls. It is tinted rather than left on the sheet's own
 * ground: a drawing needs a field to sit in, and the exported file carries the
 * same one.
 */
.plansheet {
  padding: var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
}

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
  transition:
    background-color var(--t-hover) var(--ease-out),
    color var(--t-hover) var(--ease-out);
}

.tool:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .tool:not(:disabled):hover {
    background-color: var(--fill-4);
    color: var(--color-base-content);
  }
}
</style>
