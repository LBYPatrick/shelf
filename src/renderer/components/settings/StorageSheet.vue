<script setup lang="ts">
/**
 * What the app is keeping, and how to stop keeping it.
 *
 * Chrome's shape, because it is the right one and everybody already knows it: a
 * list of categories with checkboxes, what each is holding beside it, and one
 * button that clears exactly what is ticked. The parts worth being deliberate
 * about are the two that make it trustworthy.
 *
 * **Every row carries its own size.** A single "Clear all data" is a button
 * nobody presses, because it is indistinguishable from "lose my work". Sizes
 * make the decision for the reader: a gigabyte of job results next to forty
 * kilobytes of everything else is not a judgement call.
 *
 * **What was made by hand starts unticked.** Saved queries, providers and
 * connections are somebody's work, not accumulated residue, and a sheet that
 * opens with those already selected is a sheet that gets used once. The two
 * that take credentials out of the OS keychain say so on their own row.
 *
 * Preferences are deliberately not here. They are reset from the settings page
 * itself, and one thing that can be undone from two places is two places to
 * check when it was not.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import {
  STORAGE_CATEGORIES,
  formatBytes,
  type StorageCategoryId,
  type StorageUsage,
} from '@shared/storage';
import { errorMessage } from '@shared/errors';
import { useToasts } from '../../stores/toasts';
import { vTip } from '../../lib/hoverTip';
import AppIcon from '../ui/AppIcon.vue';
import CheckBox from '../ui/CheckBox.vue';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';

const open = defineModel<boolean>({ required: true });

const { t } = useTranslation();
const toasts = useToasts();

const usage = ref<StorageUsage | null>(null);
const busy = ref(false);

const ticked = ref(new Set<StorageCategoryId>());

function armDefaults(): void {
  ticked.value = new Set(
    STORAGE_CATEGORIES.filter((category) => category.byDefault).map((category) => category.id)
  );
}

/**
 * Measured every time the sheet opens, never cached.
 *
 * It is a directory listing and half a dozen counts. A remembered figure that
 * still says a gigabyte after the gigabyte was deleted is worse than no figure,
 * and this is a panel whose entire value is that its numbers are true.
 */
watch(open, async (isOpen) => {
  if (!isOpen) return;
  armDefaults();
  confirming.value = false;
  usage.value = null;
  await measure();
});

async function measure(): Promise<void> {
  try {
    usage.value = await window.shelf.db.storageUsage();
  } catch (caught) {
    toasts.show({ id: 'storage', tone: 'error', message: errorMessage(caught) });
  }
}

function usageOf(id: StorageCategoryId) {
  return usage.value?.categories.find((category) => category.id === id);
}

/** What a row says it is holding, or nothing at all when it holds nothing. */
function amount(id: StorageCategoryId): string {
  const found = usageOf(id);
  if (!found || found.items === 0) return t('storage.nothing');
  return t('storage.amount', { count: found.items, size: formatBytes(found.bytes) });
}

function toggle(id: StorageCategoryId, on: boolean): void {
  const next = new Set(ticked.value);
  if (on) next.add(id);
  else next.delete(id);
  ticked.value = next;
}

const chosen = computed(() => [...ticked.value]);

const total = computed(() =>
  chosen.value.reduce((sum, id) => sum + (usageOf(id)?.bytes ?? 0), 0)
);

/*
 * Two presses, and it forgets.
 *
 * The same arming the reset control uses, for the same reason and with the same
 * refusal to open a dialog from a sheet. Unlike a reset, some of this cannot be
 * put back at all — which is why the second label names the size about to go
 * rather than repeating the question.
 */
const confirming = ref(false);
let disarm: ReturnType<typeof setTimeout> | undefined;
const DISARM_MS = 4000;

watch(open, (isOpen) => {
  if (isOpen) return;
  clearTimeout(disarm);
  confirming.value = false;
});

async function clear(): Promise<void> {
  if (chosen.value.length === 0 || busy.value) return;
  clearTimeout(disarm);

  if (!confirming.value) {
    confirming.value = true;
    disarm = setTimeout(() => (confirming.value = false), DISARM_MS);
    return;
  }

  confirming.value = false;
  busy.value = true;
  try {
    // The new figures come back from the same call that did the clearing, so
    // what the sheet redraws is what happened rather than what was asked for.
    usage.value = await window.shelf.db.clearStorage(chosen.value);
    toasts.show({ id: 'storage', tone: 'success', message: t('storage.cleared') });
  } catch (caught) {
    toasts.show({ id: 'storage', tone: 'error', message: errorMessage(caught) });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('storage.title')"
    :subtitle="$t('settings.title')"
    icon="database"
    wide
  >
    <div class="storage">
      <!--
        The label and the path are two lines, and the path is one line always.
        ───────────────────────────────────────────────────────────────────
        It used to be one paragraph that wrapped, which made the sheet's height
        a function of how long the reader's home directory is — and, worse, of
        *when* it arrived: the panel measured itself before the path was known,
        the paragraph grew a line underneath it, and the sheet stayed short
        until some unrelated transition happened to prompt a second
        measurement. Hovering the button below was enough to fix it, which is a
        good description of a bug.
        A path is also not prose. It is read left to right and recognised by its
        tail, so wrapping it mid-token was never the right presentation either;
        it gets its own line, truncates at the end, and says the whole thing on
        hover. The sheet is then exactly as tall as its static content, and the
        measurement cannot be early.
      -->
      <div class="where">
        <p class="storage__where">{{ $t('storage.where') }}</p>
        <code v-tip="usage?.directory ?? ''" class="storage__path">{{
          usage?.directory ?? '…'
        }}</code>
      </div>

      <div class="rows">
        <div v-for="category in STORAGE_CATEGORIES" :key="category.id" class="row">
          <CheckBox
            :model-value="ticked.has(category.id)"
            :label="$t(`storage.${category.id}`)"
            :hint="$t(`storage.${category.id}Note`)"
            @update:model-value="toggle(category.id, $event)"
          />

          <span
            class="row__amount"
            :class="{ 'row__amount--none': !usageOf(category.id)?.items }"
          >
            {{ amount(category.id) }}
          </span>
        </div>
      </div>

      <!--
        The one thing here that reaches outside the app's own directory, said
        where the decision is made rather than in a footnote afterwards.
      -->
      <p
        v-if="chosen.some((id) => STORAGE_CATEGORIES.find((c) => c.id === id)?.takesSecrets)"
        class="warn"
      >
        <AppIcon name="warning" :size="13" />
        {{ $t('storage.secretsGo') }}
      </p>

      <div class="commit">
        <PressButton
          :variant="confirming ? 'danger' : 'primary'"
          :disabled="chosen.length === 0 || busy"
          @click="clear"
        >
          <AppIcon name="trash" :size="13" />
          {{
            confirming
              ? $t('storage.confirm', { size: formatBytes(total) })
              : $t('storage.clear')
          }}
        </PressButton>

        <span class="commit__note type-label">{{ $t('storage.notPreferences') }}</span>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.storage {
  display: flex;
  flex-direction: column;
  gap: var(--gap-loose);
}

/* The label and the path are one thought, so they sit closer to each other
   than either does to the list below. */
.where {
  min-inline-size: 0;
}

.storage__where {
  margin: 0 0 var(--gap-tight);
  color: var(--color-base-content);
  font-size: 0.75rem;
  opacity: 0.75;
}

/* One line, whatever the path. Truncated with an ellipsis and readable in full
   on hover — the `direction: rtl` trick that keeps the tail visible was tried
   and reorders the leading slash, which on a path is worse than a tail nobody
   can see. */
.storage__path {
  display: block;
  overflow: hidden;
  color: var(--color-base-content);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.75;
}

.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap);
  padding: var(--gap-tight) 0;
}

/* Tabular figures so a column of sizes lines up on its digits rather than
   ragging against the edge. */
.row__amount {
  flex: none;
  padding-block-start: 0.15rem;
  color: var(--color-base-content);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.row__amount--none {
  opacity: 0.45;
}

.warn {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  margin: 0;
  color: var(--color-warning, var(--color-base-content));
  font-size: 0.75rem;
}

.commit {
  display: flex;
  align-items: center;
  gap: var(--gap);
  flex-wrap: wrap;
}

.commit__note {
  opacity: 0.6;
}
</style>
