<script setup lang="ts">
/**
 * The conversation.
 *
 * A tab rather than a panel beside the workspace, because what comes out of it
 * is the same kind of thing every other tab holds — a query, a table of rows —
 * and because two conversations about two parts of a database are two tabs
 * rather than a history to scroll back through.
 *
 * The layout was wrong and was rebuilt. What was wrong, in order of how badly:
 *
 *   - **A toolbar spent half a window on two settings.** The scope and the
 *     provider were `SelectMenu`s stretched across a bar of their own. They are
 *     read far more often than they are changed, and a field is the loudest
 *     control there is. They are quiet labels on the floor of the composer now,
 *     next to the box where the question is typed — which is also where they
 *     belong, because what the assistant can see is a fact about the question
 *     you are about to ask.
 *   - **Three different left edges.** The bar, the transcript and the composer
 *     each computed their own width from a max-width plus padding applied at a
 *     different level, so nothing lined up with anything. There is one measure
 *     now, `--chat-measure`, and one wrapper that applies it.
 *   - **A void between the last answer and the composer.** A short conversation
 *     sat at the top of a tall pane with several hundred pixels of nothing
 *     under it. The column is pushed to the bottom instead, so the exchange
 *     always sits against the box that continues it and grows upward from
 *     there.
 *   - **A question was a full-width slab.** It hugs its text now and sits at
 *     the trailing edge. The earlier argument against that — that it wastes a
 *     third of the column on alignment — was right about *answers*, which is
 *     why those still take the whole measure: a result table needs it. A
 *     question is a sentence.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type { SchemaScope } from '@shared/schemaDoc';
import { scopeLabel } from '@shared/schemaDoc';
import type { MenuItem } from '../ui/ContextMenu.vue';
import AppIcon from '../ui/AppIcon.vue';
import ChatItem from './ChatItem.vue';
import CircuitRing from '../ui/CircuitRing.vue';
import InlinePicker from './InlinePicker.vue';
import ProviderMark from './ProviderMark.vue';
import type { AiDriverKind } from '@shared/ai';
import { useAssistant } from '../../stores/assistant';
import { useConnections } from '../../stores/connections';
import { useEntities } from '../../stores/entities';
import { useTabs } from '../../stores/tabs';
import { vTip } from '../../lib/hoverTip';

const props = defineProps<{
  tabId: string;
  active: boolean;
  /** What the tab was opened on, if it was opened on something. */
  scope?: SchemaScope;
}>();

const emit = defineEmits<{ configure: [] }>();

const assistant = useAssistant();
const connections = useConnections();
const entities = useEntities();
const tabs = useTabs();
const { t } = useTranslation();

const chat = computed(() =>
  assistant.conversation(props.tabId, props.scope ?? { kind: 'connection' })
);

const running = computed(() => chat.value.turns.some((turn) => turn.state === 'running'));

/* ------------------------------------------------------------------ scope */

/**
 * What the assistant is looking at.
 *
 * A choice rather than always the whole connection, because the schema is the
 * expensive half of every request: pointing it at one schema of forty is the
 * difference between a prompt that fits and one that has to be cut down and
 * apologised for. A tab opened from a table keeps that table as an option even
 * though it is not in the general list.
 */
const scopeOptions = computed<MenuItem[]>(() => {
  const options: MenuItem[] = [
    { id: 'connection', label: t('assistant.wholeConnection'), icon: 'database' },
  ];

  if (props.scope?.kind === 'entity') {
    options.push({ id: 'entity', label: scopeLabel(props.scope), icon: 'table' });
  }

  for (const schema of entities.schemas) {
    options.push({ id: `schema:${schema}`, label: schema, icon: 'folder' });
  }

  return options;
});

const scopeValue = computed<string>({
  get: () => {
    const scope = chat.value.scope;
    if (scope.kind === 'schema' || scope.kind === 'database') return `schema:${scope.name}`;
    if (scope.kind === 'entity') return 'entity';
    return 'connection';
  },
  set: (value) => {
    if (value === 'connection') chat.value.scope = { kind: 'connection' };
    else if (value === 'entity' && props.scope) chat.value.scope = props.scope;
    else if (value.startsWith('schema:')) {
      chat.value.scope = { kind: 'schema', name: value.slice('schema:'.length) };
    }
  },
});

/* --------------------------------------------------------------- provider */

const MANAGE = '__manage';

/**
 * The providers, with the way to add one at the bottom of the same list.
 *
 * A separate cog beside the picker was one more control in a row that is
 * supposed to be quiet, and it pointed at the thing this list is *about*.
 * Putting it last, after a rule, is where every application keeps "manage
 * these…".
 */
const providerOptions = computed<MenuItem[]>(() => [
  ...assistant.providers.map((provider) => ({
    id: provider.id,
    label: `${provider.name} · ${provider.model}`,
  })),
  {
    id: MANAGE,
    label: t('assistant.manageProviders'),
    icon: 'settings',
    startsGroup: assistant.providers.length > 0,
  },
]);

/** The driver behind a row, so the list can wear each provider's own mark. */
function driverFor(id: string): AiDriverKind | undefined {
  return assistant.providers.find((provider) => provider.id === id)?.driver;
}

const providerValue = computed<string>({
  get: () => assistant.active?.id ?? '',
  set: (value) => {
    if (value !== MANAGE) assistant.choose(value);
  },
});

function onProvider(id: string): void {
  if (id === MANAGE) emit('configure');
}

/* ------------------------------------------------------------- transcript */

const scroller = ref<HTMLElement>();

/**
 * Whether the reader is at the bottom.
 *
 * The whole autoscroll question is this one boolean. Following unconditionally
 * drags the view off whatever they scrolled up to read; never following means
 * watching an answer arrive below the fold. The threshold is a couple of lines,
 * so a stray wheel notch does not count as leaving.
 */
const pinned = ref(true);
const NEAR_BOTTOM = 48;

function onScroll(): void {
  const box = scroller.value;
  if (!box) return;
  pinned.value = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM;
}

async function follow(): Promise<void> {
  if (!pinned.value) return;
  await nextTick();
  const box = scroller.value;
  if (!box) return;
  /*
   * Jumped, never smooth-scrolled. A smooth scroll re-requested many times a
   * second never arrives: each call restarts the animation from wherever the
   * last one reached, and the view crawls behind the text instead of sitting
   * on it.
   */
  box.scrollTop = box.scrollHeight;
}

watch(
  () => chat.value.turns.map((turn) => turn.items.length + (turn.state === 'running' ? 1 : 0)),
  () => void follow(),
  { deep: true }
);

/* ---------------------------------------------------------------- sending */

const draft = ref('');
const box = ref<HTMLTextAreaElement>();

/** As tall as what is in it, to a ceiling the stylesheet owns. */
function grow(): void {
  const field = box.value;
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

watch(draft, () => void nextTick(grow));

watch(
  () => props.active,
  (isActive) => {
    if (isActive) void nextTick(() => box.value?.focus());
  }
);

const canSend = computed(
  () => draft.value.trim().length > 0 && !running.value && assistant.configured
);

async function send(): Promise<void> {
  if (!canSend.value) return;
  const question = draft.value.trim();
  draft.value = '';
  await nextTick(grow);
  pinned.value = true;
  await assistant.ask(props.tabId, connections.requireId(), question);
}

function onKeydown(event: KeyboardEvent): void {
  // Enter sends; Shift-Enter is a newline. The other way round is a chat you
  // need the mouse for.
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
}

/*
 * A statement lifted out of the conversation into an editor of its own.
 *
 * The tab takes the name the model gave the query — "Albums per artist" — and
 * not a label about where it came from. Every tab in the strip is named for
 * what is in it, and a row of tabs all called "From the assistant" tells the
 * reader the one thing they already know while withholding the one thing they
 * need. Only when there is no name at all does it fall back to that.
 */
function openInTab(sql: string, title: string): void {
  const tab = tabs.openQuery(sql);
  tabs.rename(tab.id, title.trim() || t('assistant.fromAssistant'));
}

const SUGGESTIONS = computed(() => [
  t('assistant.suggestShape'),
  t('assistant.suggestCount'),
  t('assistant.suggestJoin'),
]);

function suggest(text: string): void {
  draft.value = text;
  void nextTick(() => {
    grow();
    box.value?.focus();
  });
}

/**
 * The tab learns its chat's id the moment there is one.
 *
 * A conversation has no row until its first turn finishes, so the tab cannot be
 * given the id when it opens. Without this the card in the sidebar never marks
 * itself as the one on screen, and reopening it would make a second tab of the
 * same conversation.
 */
watch(
  () => chat.value.id,
  (id) => {
    if (!id) return;
    const tab = tabs.tabs.find((entry) => entry.id === props.tabId);
    if (tab) tab.chatId = id;
  }
);

onBeforeUnmount(() => assistant.interrupt(props.tabId));
</script>

<template>
  <div class="chat">
    <div ref="scroller" class="chat__scroll selectable" @scroll="onScroll">
      <!--
        Pushed to the bottom by `margin-block-start: auto`. A short conversation
        sits against the composer that continues it, and grows upward; a long
        one fills the pane and scrolls as normal. There is never a gap between
        the last thing said and the box for saying the next thing.
      -->
      <div class="chat__column" :class="{ 'chat__column--opening': chat.turns.length === 0 }">
        <section v-if="chat.turns.length === 0" class="opening">
          <AppIcon class="opening__mark" name="assistant" filled :size="22" />
          <h2 class="opening__title">
            {{ $t('assistant.openingTitle') }}
          </h2>
          <p class="opening__note">
            {{ $t('assistant.openingNote', { scope: scopeLabel(chat.scope) }) }}
          </p>

          <button
            v-if="!assistant.configured"
            type="button"
            class="opening__cta focus-fill"
            @click="emit('configure')"
          >
            {{ $t('assistant.setUp') }}
          </button>

          <ul v-else class="opening__list">
            <li
              v-for="(text, index) in SUGGESTIONS"
              :key="text"
              class="opening__item"
              :style="{ animationDelay: `${index * 45}ms` }"
            >
              <button type="button" class="opening__chip focus-fill" @click="suggest(text)">
                {{ text }}
              </button>
            </li>
          </ul>
        </section>

        <article v-for="turn in chat.turns" :key="turn.id" class="turn">
          <p v-if="turn.question" class="turn__question">
            {{ turn.question }}
          </p>

          <div class="turn__answer">
            <span
              v-if="turn.state === 'running' && turn.items.length === 0"
              class="turn__waiting"
            >
              <span class="turn__pulse" aria-hidden="true" />
              <span class="type-label">{{ $t('assistant.reading') }}</span>
            </span>

            <ChatItem
              v-for="item in turn.items"
              :key="item.id"
              :item="item"
              :streaming="turn.state === 'running'"
              @open="openInTab"
            />

            <p v-if="turn.state === 'failed'" class="turn__failure">
              <AppIcon name="warning" :size="13" />
              <span>{{ turn.error }}</span>
            </p>
            <p v-else-if="turn.state === 'stopped'" class="turn__stopped type-label">
              {{ $t('assistant.stopped') }}
            </p>
          </div>
        </article>
      </div>
    </div>

    <!--
      The composer, and everything that qualifies it.

      One box: the field on top, the two facts about what will happen along the
      floor, and the one action that commits at the trailing end. The border
      lights on focus so the whole assembly reads as the thing being used.
    -->
    <div class="composer">
      <div class="composer__inner">
        <div class="composer__box">
          <!--
            The edge of the box lights up while a turn is running.
            ─────────────────────────────────────────────────────
            The same ring the Run button wears, for the same reason: a model has
            no progress to report, so what is shown is not how far through it is
            but *which thing* is working. Here that thing is the whole composer —
            the question you asked is in it, the Stop that ends it is on its
            floor, and the answer is arriving directly above it.

            It traces the box's own corner rather than being given a number, so
            the ring is that border while it runs instead of a second line drawn
            just inside it.
          -->
          <CircuitRing v-if="running" />
          <textarea
            ref="box"
            v-model="draft"
            class="composer__field"
            rows="1"
            :placeholder="$t('assistant.placeholder')"
            :aria-label="$t('assistant.placeholder')"
            spellcheck="false"
            @keydown="onKeydown"
          />

          <div class="composer__floor">
            <InlinePicker
              v-model="providerValue"
              :options="providerOptions"
              :aria-label="$t('assistant.provider')"
              :driver="assistant.active?.driver"
              :placeholder="$t('assistant.chooseProvider')"
              @choose="onProvider"
            >
              <template #icon="{ item }">
                <ProviderMark
                  v-if="driverFor(item.id)"
                  :driver="driverFor(item.id)!"
                  :size="12"
                />
                <AppIcon v-else-if="item.icon" :name="item.icon" :size="12" />
              </template>
            </InlinePicker>

            <span class="composer__rule" aria-hidden="true" />

            <InlinePicker
              v-model="scopeValue"
              :options="scopeOptions"
              :aria-label="$t('assistant.scope')"
              icon="database"
            />

            <span class="composer__spacer" />

            <button
              v-if="running"
              v-tip="$t('assistant.stop')"
              type="button"
              class="composer__go composer__go--stop"
              :aria-label="$t('assistant.stop')"
              @click="assistant.interrupt(props.tabId)"
            >
              <AppIcon name="stop" :size="11" filled />
            </button>
            <button
              v-else
              type="button"
              class="composer__go"
              :disabled="!canSend"
              :aria-label="$t('assistant.send')"
              @click="send()"
            >
              <AppIcon name="arrowUp" :size="14" />
            </button>
          </div>
        </div>

        <p class="composer__note type-label">
          {{ $t('assistant.readsOnly') }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/**
 * One measure, for everything in the tab.
 *
 * Every horizontal edge — the transcript, the composer, the note under it — is
 * this width and this centring. It used to be three different sums of a
 * max-width and a padding applied at different levels, which is why nothing
 * lined up with anything.
 */
.chat {
  --chat-measure: 44rem;

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* The same shallow well the query editor sits in. A transcript and an editor
     are the same kind of surface — a long thing you read down — and they were
     two different ones only because neither had been named. */
  background-color: var(--surface-well);
}

.chat__scroll {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  /*
   * A recycler's enemy and a transcript's too: the browser holds a scroll
   * position steady by adjusting `scrollTop` when content above changes size,
   * and while an answer streams, every token *is* that content changing.
   */
  overflow-anchor: none;
}

.chat__column {
  width: min(var(--chat-measure), 100% - var(--gap-section) * 2);
  /* The leading `auto` is the whole bottom-anchoring: it eats the spare height
     above, so the exchange sits against the composer that continues it. */
  margin: auto auto 0;
  padding-block: var(--gap-section);
}

/*
 * Except when there is no conversation yet.
 *
 * Bottom-anchoring an empty chat presses the invitation against the composer
 * and leaves the whole pane empty above it, which reads as content that failed
 * to load. With nothing to sit under, it centres: `auto` on both sides.
 */
.chat__column--opening {
  margin-block: auto;
}

.turn + .turn {
  margin-top: var(--gap-section);
}

/*
 * A question hugs its own text and sits at the trailing edge; an answer takes
 * the whole measure. They are different shapes because they are different
 * things — one is a sentence, the other may contain a table of results.
 */
.turn__question {
  width: fit-content;
  max-width: 85%;
  margin: 0 0 var(--gap-loose);
  margin-inline-start: auto;
  padding: var(--gap) var(--gap-loose);
  border-radius: 1rem 1rem 0.35rem 1rem;
  background: var(--fill-2);
  font-size: 0.8125rem;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.turn__answer {
  min-width: 0;
}

.turn__waiting {
  display: flex;
  align-items: center;
  gap: var(--gap);
  opacity: 0.7;
}

.turn__pulse {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-primary);
  animation: breathe 1.4s var(--ease-in-out) infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(0.7);
    opacity: 0.45;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

.turn__failure {
  display: flex;
  align-items: flex-start;
  gap: var(--gap);
  margin: var(--gap) 0 0;
  font-size: 0.75rem;
  color: var(--color-error, var(--color-base-content));
}

.turn__stopped {
  margin: var(--gap) 0 0;
  opacity: 0.55;
}

/* ------------------------------------------------------------- opening */

.opening {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--gap);
  padding-bottom: var(--gap-section);
}

.opening__mark {
  color: var(--color-primary-text, var(--color-primary));
}

.opening__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  /* Tighter tracking as it grows, the way the type scale does everywhere. */
  letter-spacing: -0.01em;
}

.opening__note {
  max-width: 34rem;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
}

.opening__cta {
  min-height: var(--hit-min);
  margin-top: var(--gap-tight);
  padding: var(--gap-tight) var(--gap-loose);
  border-radius: 999px;
  background: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 500;
  /* White on the accent, and the accent moves to keep that legible — never the
     text flipping dark. See `usableAccent`. */
  color: var(--color-primary-content, white);
  transition: transform var(--t-press) var(--ease-out);
}

.opening__cta:active {
  transform: scale(0.97);
}

.opening__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap);
  margin: var(--gap-tight) 0 0;
  padding: 0;
  list-style: none;
}

.opening__item {
  animation: rise 260ms var(--ease-out) both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.opening__chip {
  min-height: var(--hit-min);
  padding: var(--gap-tight) var(--gap-loose);
  border: 1px solid var(--separator);
  border-radius: 999px;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 75%, transparent);
  transition:
    background-color var(--t-hover) var(--ease-out),
    transform var(--t-press) var(--ease-out);
}

.opening__chip:hover {
  background: var(--fill-1);
  color: var(--color-base-content);
}

.opening__chip:active {
  transform: scale(0.97);
}

/* ------------------------------------------------------------ composer */

.composer {
  flex: 0 0 auto;
  padding-bottom: var(--gap-loose);
}

.composer__inner {
  width: min(var(--chat-measure), 100% - var(--gap-section) * 2);
  margin-inline: auto;
}

/*
 * The one thing on this page you write into, so it stands *off* the page.
 *
 * It was a `--fill-1`, and a fill is mixed toward mid grey: on the dark theme
 * that lightens the box and it rose off the transcript correctly, and on the
 * light theme the same mix darkened it, so the box you type into was the
 * dimmest thing on a bright page — sunk into the pane rather than laid on it.
 * Raised is a direction away from the field, and that direction is not the same
 * in both appearances. `--surface-raised` is the token that knows which: the
 * paper colour on the light theme, a step up from the pane on the dark one.
 *
 * Focus moves the border and nothing else. The surface change was there to
 * compensate for a resting state that was wrong; with the box already standing
 * off the page, a second surface for focus is one state too many.
 */
.composer__box {
  /* The ring is absolute within it. */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--gap-tight);
  /*
   * The same inset on all four sides.
   *
   * The bottom was a `--gap-tight` while the sides were a `--gap-loose`, and
   * the send button is a circle in the bottom corner: a round thing has no edge
   * to sit flush against, so the difference between the room below it and the
   * room beside it is the first thing the eye lands on. Uniform, and the corner
   * stops being a corner you look at.
   */
  padding: var(--gap-loose);
  border: 1px solid var(--separator);
  border-radius: 1.1rem;
  background: var(--surface-raised);
  transition: border-color var(--t-hover) var(--ease-out);
}

.composer__box:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
}

.composer__field {
  /* Six lines and then it scrolls: past that the answer above is what should
     be on screen, not more of the question. */
  max-height: 9rem;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--color-base-content);
  overflow-y: auto;
}

.composer__field::placeholder {
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.composer__floor {
  display: flex;
  align-items: center;
  gap: var(--gap-hair);
}

.composer__rule {
  flex: 0 0 auto;
  width: 1px;
  height: 0.9rem;
  margin-inline: var(--gap-tight);
  background: var(--separator);
}

.composer__spacer {
  flex: 1;
}

/*
 * The one filled control in the tab, which is the rule the toolbars follow:
 * never more than one action that commits, per surface.
 */
.composer__go {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border-radius: 999px;
  background: var(--color-primary);
  color: var(--color-primary-content, white);
  transition:
    transform var(--t-press) var(--ease-out),
    opacity var(--t-hover) var(--ease-out);
}

.composer__go:active:not(:disabled) {
  transform: scale(0.92);
}

.composer__go:disabled {
  background: var(--fill-3);
  color: color-mix(in oklab, var(--color-base-content) 35%, transparent);
}

.composer__go--stop {
  background: var(--fill-3);
  color: var(--color-base-content);
}

.composer__note {
  margin: var(--gap-tight) 0 0;
  padding-inline: var(--gap-tight);
  opacity: 0.45;
}

@media (prefers-reduced-motion: reduce) {
  .turn__pulse {
    animation: none;
    opacity: 0.8;
  }

  .opening__item {
    animation: none;
  }

  .opening__chip,
  .opening__cta,
  .composer__box,
  .composer__go {
    transition: none;
  }
}
</style>
