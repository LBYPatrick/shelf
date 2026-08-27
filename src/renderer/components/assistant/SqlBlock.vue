<script setup lang="ts">
/**
 * A statement the assistant produced, drawn as a statement.
 *
 * **One container, everywhere.** A statement the model wrote out in prose and a
 * statement it ran to check itself are the same object to the reader — the same
 * colouring, the same two actions — and the only difference is whether the
 * conversation shows it folded away. Two containers for one idea is how an
 * interface starts reading as assembled rather than designed.
 *
 * The actions live above the code and are always drawn. Revealing them on hover
 * would save a row of chrome and cost the one thing a chat cannot afford: a
 * reader who does not know the block is actionable will not hover it to find
 * out.
 *
 * A statement that would change something says so. That is not decoration — it
 * is the explanation for why this is a block to run yourself rather than a
 * result the assistant already fetched.
 */
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { format, type SqlLanguage } from 'sql-formatter';
import { classifyStatement } from '@shared/sqlSafety';
import { formatterDialect } from '@shared/sqlText';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import SqlCode from './SqlCode.vue';
import { useConnections } from '../../stores/connections';
import { useToasts } from '../../stores/toasts';

const props = defineProps<{
  sql: string;
  /** What the block is called, above the code and on the tab it opens. */
  title?: string;
}>();

const emit = defineEmits<{ open: [sql: string, title: string] }>();

const connections = useConnections();
const toasts = useToasts();
const { t } = useTranslation();

/**
 * Laid out before it is shown, in the dialect of the server it is written for.
 *
 * A model writes a statement the way it writes a sentence — one long line, or
 * whatever indentation the last example it saw happened to use — and the
 * statement is the part of an answer people actually read closely. This is the
 * same formatter and the same dialect table the query tab's Format button
 * uses, so a statement lifted out of a conversation and a statement typed into
 * an editor come out looking alike.
 *
 * A parse failure falls back to what the model wrote, silently. The button in
 * the query tab says so instead, and should: someone pressed it and nothing
 * happened. Nobody pressed anything here, and the statement is on screen and
 * correct either way — a warning about a cast the ANSI grammar cannot read
 * would be a notification about nothing.
 */
const pretty = computed(() => {
  try {
    return format(props.sql, {
      language: formatterDialect(connections.active?.engine) as SqlLanguage,
      keywordCase: 'upper',
      tabWidth: 2,
    });
  } catch {
    return props.sql;
  }
});

const effect = computed(() => classifyStatement(props.sql));
const changes = computed(() => effect.value !== 'read');

const warning = computed(() => {
  if (!changes.value) return '';
  return effect.value === 'schema'
    ? t('assistant.wouldChangeSchema')
    : t('assistant.wouldChangeData');
});

function copy(): void {
  void navigator.clipboard.writeText(pretty.value);
  toasts.show({ id: 'assistant-copy', tone: 'success', message: t('assistant.copied') });
}
</script>

<template>
  <figure
    class="sqlblock"
    :class="{ 'sqlblock--changes': changes }"
  >
    <figcaption class="sqlblock__bar">
      <span class="sqlblock__label type-label">{{ title || $t('assistant.statement') }}</span>

      <p
        v-if="warning"
        class="sqlblock__warning"
      >
        <AppIcon
          name="warning"
          :size="12"
        />
        <span>{{ warning }}</span>
      </p>

      <span class="sqlblock__spacer" />

      <PressButton
        size="sm"
        :aria-label="$t('action.copy')"
        @click="copy"
      >
        <AppIcon
          name="copy"
          :size="12"
        />
      </PressButton>
      <PressButton
        size="sm"
        @click="emit('open', pretty, title ?? '')"
      >
        <AppIcon
          name="query"
          :size="12"
        />
        <span>{{ $t('assistant.openInTab') }}</span>
      </PressButton>
    </figcaption>

    <SqlCode :sql="pretty" />
  </figure>
</template>

<style scoped>
.sqlblock {
  margin: var(--gap) 0;
  border: 1px solid var(--separator);
  border-radius: 0.75rem;
  /*
   * Paper standing on the well, not a slab sunk into it.
   *
   * This was a `--fill-1`, which is a tint of mid grey — so on the light theme
   * the block came out *darker* than the transcript around it, which inverts
   * the depth it is trying to express: a statement is an object laid on the
   * page, and the page is the recessed one. `--surface-raised` is the token
   * that knows which direction "away from the field" is in each appearance.
   */
  background: var(--surface-raised);
  overflow: hidden;
}

/*
 * A statement that writes is marked by a rule down its leading edge rather than
 * by a coloured fill. The fill is where the code sits, and tinting it is the
 * fastest way to make a monospace block harder to read — which is precisely the
 * block you would most want read.
 */
.sqlblock--changes {
  border-inline-start: 2px solid var(--color-warning, var(--color-primary));
}

.sqlblock__bar {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: var(--gap-tight) var(--gap);
  border-bottom: 1px solid var(--separator);
}

.sqlblock__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.65;
}

.sqlblock__spacer {
  flex: 1;
}

.sqlblock__warning {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  min-width: 0;
  margin: 0;
  font-size: 0.6875rem;
  color: var(--color-warning, var(--color-base-content));
}

.sqlblock__warning span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
