<script setup lang="ts">
/**
 * What a database or a schema is, in one popup.
 *
 * The same door the table properties use, one level up. Tables had a Properties
 * item and the folders above them did not, so the two questions a schema
 * actually raises — how big is this, and who owns it — had no answer anywhere
 * in the interface short of writing the catalogue query yourself.
 *
 * What an engine has to say differs enough that a fixed form would be mostly
 * empty: Postgres has an owner, an encoding and a collation, SQLite has a page
 * size and a journal mode. So the driver states its facts and this renders
 * them, formatting each by which of the three value fields it carries.
 */
import type { ContainerFact, ContainerRef } from '@drivers/types';
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { formatBytes } from '@shared/bytes';
import { errorMessage } from '@shared/errors';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import Sheet from '../ui/Sheet.vue';
import PressButton from '../ui/PressButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import RankedBars, { type Bar } from '../viz/RankedBars.vue';
import AnalyzePanel from './AnalyzePanel.vue';

const props = withDefaults(defineProps<{ target: ContainerRef; start?: Section }>(), {
  start: 'overview',
});
const open = defineModel<boolean>({ required: true });

/**
 * Three sections, and the last two only where the engine keeps statistics.
 *
 * Analysis sits here rather than in a tab of its own because it is the same
 * kind of thing as the rest of the popup — what this database *is*, rather than
 * something you work in. A tab you have to close afterwards is the shape of a
 * document, and this is a reading.
 */
type Section = 'overview' | 'queries' | 'server';

const section = ref<Section>('overview');
/**
 * The analysis is mounted once and kept, rather than torn down every time the
 * reader looks at the overview. It accumulates readings while it is on screen —
 * that is the whole of how the time windows exist — and remounting also meant a
 * reload flicker on every switch back.
 */
const analysisSection = ref<'queries' | 'server'>('queries');
const analysisMounted = ref(false);

watch(section, (current) => {
  if (current === 'overview') return;
  analysisSection.value = current;
  analysisMounted.value = true;
});

const connections = useConnections();
const { t } = useTranslation();

const sections = computed(() => {
  const available: { value: Section; label: string }[] = [
    { value: 'overview', label: t('container.overview') },
  ];
  // Statistics are server-wide, so they belong to the database and not to one
  // schema inside it.
  if (props.target.kind === 'database' && connections.active?.capabilities.statistics) {
    available.push(
      { value: 'queries', label: t('analyze.queries') },
      { value: 'server', label: t('analyze.server') }
    );
  }
  return available;
});

const facts = ref<readonly ContainerFact[]>([]);
const comment = ref<string | undefined>();
const largest = ref<readonly { entity: { name: string; schema?: string }; bytes: number }[]>(
  []
);
const loading = ref(false);
const error = ref<string | null>(null);

/**
 * A fact names itself, and the name falls back to itself.
 *
 * A driver that reports something the interface has never heard of shows the
 * driver's own word rather than a missing-translation marker — which is the
 * whole reason the facts are a list rather than a record.
 */
function labelFor(key: string): string {
  const translated = t(`container.${key}`);
  return translated === `container.${key}` ? key : translated;
}

function valueOf(fact: ContainerFact): string {
  if (fact.bytes !== undefined) return formatBytes(fact.bytes);
  if (fact.count !== undefined) return fact.count.toLocaleString();
  return fact.text ?? '—';
}

/*
 * The same ranked bars the Analyze tab draws. Two lists of "which of these is
 * the big one" laid out by two different rules is how a window stops reading as
 * one designed thing.
 */
const bars = computed<Bar[]>(() =>
  largest.value.map((table) => ({
    id: `${table.entity.schema ?? ''}.${table.entity.name}`,
    label: table.entity.name,
    value: table.bytes,
    display: formatBytes(table.bytes),
  }))
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await host.call('schema/container', {
      connectionId: connections.requireId(),
      target: props.target,
    });
    facts.value = result.facts;
    comment.value = result.comment;
    largest.value = result.largest ?? [];
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}

// Loaded when it opens rather than when it mounts: the sheet is kept in the
// tree's markup and would otherwise query the catalogue for every folder the
// pointer has ever been near.
watch(
  [open, () => props.target],
  ([isOpen]) => {
    if (!isOpen) return;
    // Opened from "Analyze performance" it lands on the analysis; opened from
    // "Properties" it lands on what the thing is.
    section.value = sections.value.some((entry) => entry.value === props.start)
      ? props.start
      : 'overview';
    void load();
  },
  { immediate: true }
);
</script>

<template>
  <Sheet
    v-model="open"
    :wide="sections.length > 1"
    :title="target.name"
    :subtitle="connections.active?.name"
  >
    <template v-if="sections.length > 1" #header>
      <SegmentedControl
        v-model="section"
        :options="sections"
        :aria-label="$t('analyze.sections')"
      />
    </template>

    <!--
      One frame, whatever is in it.
      
      The sections are wildly different heights — six facts, or a chart and a
      table of five hundred statements — and the popup was sized by whichever
      was showing, so every switch resized the window and every arriving fetch
      nudged it again. A modal that moves while you are reading it is the thing
      to fix; a transition between two moving heights would only have made the
      movement smoother.
      
      So the frame holds still and the panes cross-fade inside it. The overview
      stays in flow and the analysis sits on top of it, which is what lets both
      be present during the fade without either shifting the other.
    -->
    <div class="pane">
      <Transition name="pane">
        <div v-show="section === 'overview'" class="pane__overview">
          <p v-if="comment" class="comment">
            {{ comment }}
          </p>

          <p v-if="error" class="note note--error" role="alert">
            {{ error }}
          </p>
          <p v-else-if="loading" class="note">
            {{ $t('workspace.loading') }}
          </p>

          <template v-else>
            <!--
        A definition list, not a table: these are label-and-value pairs, and
        marking them up as rows of a grid would have a screen reader announce
        column headers that do not exist.
      -->
            <dl class="facts">
              <div v-for="fact in facts" :key="fact.key" class="facts__item">
                <dt class="type-label">
                  {{ labelFor(fact.key) }}
                </dt>
                <dd>{{ valueOf(fact) }}</dd>
              </div>
            </dl>

            <section v-if="largest.length > 0" class="largest">
              <h3 class="type-label largest__title">
                {{ $t('container.largest') }}
              </h3>
              <RankedBars :bars="bars" :label="$t('container.largest')" />
            </section>
          </template>
        </div>
      </Transition>

      <Transition name="pane">
        <div v-if="analysisMounted" v-show="section !== 'overview'" class="pane__analysis">
          <AnalyzePanel :section="analysisSection" :active="open && section !== 'overview'" />
        </div>
      </Transition>
    </div>

    <template #footer>
      <PressButton variant="primary" size="sm" @click="open = false">
        {{ $t('action.done') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
/*
 * The frame the panes live in.
 *
 * It used to hold the popup at one height so a fetch landing could not resize
 * it. The sheet animates its own size now — decelerating, and about its centre
 * — so the overview going from "Loading…" to six facts reads as the window
 * settling, and a popup with six facts in it is the size of six facts instead
 * of the size of the largest thing any of its tabs might hold.
 */
/*
 * The two sections stacked, in flow.
 *
 * They used to be stacked by taking the second one out of flow — which is the
 * usual way to cross-fade, and it means the container has nothing to take its
 * height from. That was invisible while the popup was a fixed height and became
 * a pane of zero height the moment it started sizing to its content, with the
 * table rendered off the bottom of the window.
 *
 * A single grid cell does the same job without the cost: both children occupy
 * `1 / 1`, so they overlap for the length of the fade *and* the grid is as tall
 * as the taller of them. The sheet's own height animation covers the moment
 * where that is briefly both.
 */
.pane {
  position: relative;
  display: grid;
  min-height: 0;
}

.pane > * {
  grid-area: 1 / 1;
  min-width: 0;
}

.pane__overview {
  max-height: 100%;
  overflow-y: auto;
}

.pane__analysis {
  display: flex;
}

/*
 * Opacity only, and short. The frame is already still, so this exists to stop
 * one set of numbers replacing another between two frames — not to describe a
 * movement, because there is no longer a movement to describe. Out faster than
 * in: the reader has already decided, and is waiting on the answer.
 */
.pane-enter-active {
  transition: opacity var(--t-press) var(--ease-out);
}

.pane-leave-active {
  transition: opacity var(--t-press) var(--ease-out);
}

.pane-enter-from,
.pane-leave-to {
  opacity: 0;
}

.comment {
  margin: 0 0 var(--gap-loose);
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  font-size: 0.8125rem;
}

.note {
  padding: var(--gap-section);
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-soft);
}

.note--error {
  color: var(--color-error);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: var(--gap);
  margin: 0 0 var(--gap-section);
}

.facts__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
}

.facts dt {
  text-transform: uppercase;
  color: var(--text-soft);
}

.facts dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.011em;
  font-variant-numeric: tabular-nums;
}

.largest__title {
  margin: 0 0 var(--gap-tight);
  text-transform: uppercase;
  color: var(--text-soft);
}
</style>
