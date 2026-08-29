<script setup lang="ts">
/**
 * Is this connection actually well?
 *
 * The statistics view answers "what is the *server* doing"; this answers the
 * narrower question people ask when something feels wrong — is the socket
 * alive, how long does a round trip take, is it steady, and does the catalogue
 * still answer. Those are facts about the connection rather than about the
 * database, which is why they live behind the connection's own menu.
 *
 * **Everything here is measured, not asserted.** A row saying "transactions:
 * supported" is a capability read out of a table and it would sit here looking
 * exactly like a probe that ran. So the checks are real calls over the same
 * bridge every other query takes, each timed, and a check that cannot be run on
 * this engine is absent rather than shown as passing.
 *
 * Nothing here writes. The probes are the three catalogue reads the sidebar
 * already performs on connect, so running a diagnosis costs what opening the
 * tree costs.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { summarize, steadiness, type LatencySummary } from '@shared/latency';
import { engineDescriptor } from '@shared/engines';
import { errorMessage } from '@shared/errors';
import { host } from '../../lib/host';
import { useConnections } from '../../stores/connections';
import AppIcon from '../ui/AppIcon.vue';
import PressButton from '../ui/PressButton.vue';
import Sheet from '../ui/Sheet.vue';
import LatencyTrace from '../viz/LatencyTrace.vue';

const open = defineModel<boolean>({ required: true });

const connections = useConnections();
const { t } = useTranslation();

/**
 * Enough samples to see a shape, few enough to finish while somebody watches.
 *
 * Fifteen round trips on a healthy local socket is a few milliseconds; on a
 * link bad enough to be worth diagnosing it is the thing being diagnosed, and
 * the trace fills in as it goes rather than after.
 */
const PINGS = 15;

/**
 * And one before them that is thrown away.
 *
 * The first round trip after a pause pays for everything both ends do lazily —
 * a driver's statement cache, a pool handing out a connection it had parked, a
 * TLS session being resumed. Measured here it was twenty-five times the median
 * every single time, which made every healthy connection in the app report
 * itself as erratic. A warm-up sample that is discarded is the standard answer
 * and it is honest as long as it is *said*, which is why the count under the
 * chart is the count of trips kept.
 */
const WARMUP = 1;

interface Check {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly detail: string;
}

const running = ref(false);
const samples = ref<number[]>([]);
const checks = ref<Check[]>([]);
const failure = ref('');

const summary = computed<LatencySummary>(() => summarize(samples.value));
const steady = computed(() => steadiness(summary.value));

const engine = computed(() =>
  connections.active ? engineDescriptor(connections.active.engine) : undefined
);

/**
 * Sub-millisecond trips are the common case on a local socket, and "0 ms" for
 * all fifteen of them is a chart with no information in it. Two decimals under
 * ten milliseconds, none above: the precision follows the magnitude, the way it
 * does everywhere numbers are read rather than compared.
 */
function ms(value: number): string {
  if (value >= 10) return `${Math.round(value)} ms`;
  if (value >= 1) return `${value.toFixed(1)} ms`;
  return `${value.toFixed(2)} ms`;
}

async function timed<T>(
  run: () => Promise<T>
): Promise<{ ms: number; value?: T; error?: string }> {
  const started = performance.now();
  try {
    const value = await run();
    return { ms: performance.now() - started, value };
  } catch (error) {
    return { ms: performance.now() - started, error: errorMessage(error) };
  }
}

async function diagnose(): Promise<void> {
  const connection = connections.active;
  if (!connection || running.value) return;

  running.value = true;
  samples.value = [];
  checks.value = [];
  failure.value = '';

  const id = connection.id;

  /*
   * One at a time, not `Promise.all`. Fifteen pings in flight together measure
   * how well the host multiplexes, which is not the question — what is being
   * asked is how long *a* round trip takes.
   */
  for (let i = 0; i < PINGS + WARMUP; i += 1) {
    const trip = await timed(() => host.call('conn/ping', { connectionId: id }));
    if (trip.error) {
      failure.value = trip.error;
      break;
    }
    if (i >= WARMUP) samples.value = [...samples.value, trip.ms];
  }

  const capabilities = connection.capabilities;
  const probes: {
    id: string;
    label: string;
    run: () => Promise<unknown>;
    count: (value: unknown) => string;
  }[] = [];

  if (capabilities.multipleDatabases) {
    probes.push({
      id: 'databases',
      label: t('diagnose.databases'),
      run: () => host.call('schema/databases', { connectionId: id }),
      count: (value) => t('diagnose.found', { count: (value as readonly string[]).length }),
    });
  }

  if (capabilities.schemas) {
    probes.push({
      id: 'schemas',
      label: t('diagnose.schemas'),
      run: () => host.call('schema/schemas', { connectionId: id }),
      count: (value) => t('diagnose.found', { count: (value as readonly string[]).length }),
    });
  }

  probes.push({
    id: 'entities',
    label: t('diagnose.entities'),
    run: () => host.call('schema/entities', { connectionId: id }),
    count: (value) => t('diagnose.found', { count: (value as readonly unknown[]).length }),
  });

  for (const probe of probes) {
    const result = await timed(probe.run);
    checks.value = [
      ...checks.value,
      {
        id: probe.id,
        label: probe.label,
        ok: result.error === undefined,
        ms: result.ms,
        detail: result.error ?? probe.count(result.value),
      },
    ];
  }

  running.value = false;
}

/** Re-run on every open: a diagnosis is a reading, and a stale one is worse
 *  than none — it says the connection is well as of a time nobody can see. */
watch(open, (isOpen) => {
  if (isOpen) void diagnose();
});

type Tone = 'ok' | 'watch' | 'warning' | 'error' | 'quiet';

const TONE_ICON: Record<Tone, string> = {
  ok: 'check',
  watch: 'info',
  warning: 'warning',
  error: 'warning',
  quiet: 'history',
};

/**
 * The tone follows the words.
 *
 * It read `ok` for every finished run, so the sheet drew a green tick beside
 * the sentence "erratic — some trips take far longer than others". A verdict
 * whose colour disagrees with its text is worse than one with no colour, since
 * the colour is the part read first and from furthest away.
 */
const STEADY_TONE: Record<string, Tone> = {
  steady: 'ok',
  variable: 'watch',
  erratic: 'warning',
};

const verdict = computed<{ tone: Tone; text: string }>(() => {
  if (failure.value) return { tone: 'error', text: t('diagnose.unreachable') };
  if (checks.value.some((check) => !check.ok)) {
    return { tone: 'warning', text: t('diagnose.partial') };
  }
  if (running.value) return { tone: 'quiet', text: t('diagnose.running') };
  return { tone: STEADY_TONE[steady.value] ?? 'watch', text: t(`diagnose.${steady.value}`) };
});
</script>

<template>
  <Sheet
    v-model="open"
    :title="$t('diagnose.title')"
    :subtitle="connections.active?.name"
    icon="chart"
  >
    <div class="diagnose">
      <!--
        The verdict first, then what it was derived from.
        ────────────────────────────────────────────────
        Somebody opening this has a question with a yes-or-no shape — is it me
        or is it the database — and burying that under three charts makes them
        derive it. The numbers below are the working, for when the answer is
        not the one they hoped for.
      -->
      <div class="verdict" :class="`verdict--${verdict.tone}`">
        <AppIcon :name="TONE_ICON[verdict.tone]" :size="15" />
        <span class="verdict__text">{{ verdict.text }}</span>
        <span v-if="samples.length > 0" class="verdict__figure">{{ ms(summary.median) }}</span>
      </div>

      <p v-if="failure" class="diagnose__error" role="alert">
        {{ failure }}
      </p>

      <section class="diagblock">
        <header class="block__head">
          <h3 class="block__title">
            {{ $t('diagnose.roundTrip') }}
          </h3>
          <span class="block__note">{{
            $t('diagnose.samples', { count: summary.count })
          }}</span>
        </header>

        <LatencyTrace
          :samples="samples"
          :summary="summary"
          :format="ms"
          :label="$t('diagnose.roundTrip')"
        />

        <dl class="figures">
          <div class="figure">
            <dt>{{ $t('diagnose.fastest') }}</dt>
            <dd>{{ ms(summary.min) }}</dd>
          </div>
          <div class="figure">
            <dt>{{ $t('diagnose.typical') }}</dt>
            <dd>{{ ms(summary.median) }}</dd>
          </div>
          <div class="figure">
            <dt>{{ $t('diagnose.worst') }}</dt>
            <dd>{{ ms(summary.max) }}</dd>
          </div>
          <div class="figure">
            <dt>{{ $t('diagnose.jitter') }}</dt>
            <dd>{{ ms(summary.jitter) }}</dd>
          </div>
        </dl>
      </section>

      <section class="diagblock">
        <header class="block__head">
          <h3 class="block__title">
            {{ $t('diagnose.catalogue') }}
          </h3>
          <span class="block__note">{{ $t('diagnose.catalogueNote') }}</span>
        </header>

        <ul class="checks">
          <li
            v-for="check in checks"
            :key="check.id"
            class="check"
            :class="{ 'check--failed': !check.ok }"
          >
            <AppIcon class="check__mark" :name="check.ok ? 'check' : 'warning'" :size="13" />
            <span class="check__label">{{ check.label }}</span>
            <span class="check__detail">{{ check.detail }}</span>
            <span class="check__ms">{{ ms(check.ms) }}</span>
          </li>
          <li v-if="running" class="check check--pending">
            <span class="check__label">{{ $t('diagnose.running') }}</span>
          </li>
        </ul>
      </section>

      <section class="diagblock">
        <header class="block__head">
          <h3 class="block__title">
            {{ $t('diagnose.about') }}
          </h3>
        </header>

        <dl class="facts">
          <div class="fact">
            <dt>{{ $t('connection.engine') }}</dt>
            <dd>{{ engine?.name }}</dd>
          </div>
          <div class="fact">
            <dt>{{ $t('diagnose.version') }}</dt>
            <dd>{{ connections.active?.version || '—' }}</dd>
          </div>
          <div class="fact">
            <dt>{{ $t('diagnose.database') }}</dt>
            <dd>{{ connections.active?.database || '—' }}</dd>
          </div>
          <div class="fact">
            <dt>{{ $t('diagnose.readOnly') }}</dt>
            <dd>{{ connections.active?.readOnly ? $t('action.yes') : $t('action.no') }}</dd>
          </div>
        </dl>
      </section>

      <div class="diagnose__foot">
        <PressButton size="sm" :disabled="running" @click="diagnose">
          <AppIcon name="refresh" :size="13" />
          {{ $t('diagnose.again') }}
        </PressButton>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.diagnose {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: min(28rem, 78vw);
}

/*
 * The answer, at the size of an answer.
 *
 * A tonal band rather than a coloured word: the verdict is the one thing on
 * this sheet that is read from across the room, and colour alone would carry it
 * for everyone except the readers most likely to need it.
 */
.verdict {
  display: flex;
  align-items: center;
  gap: var(--gap);
  min-height: 3rem;
  padding-inline: var(--gap-loose);
  border-radius: var(--radius-box);
  font-size: 0.9375rem;
  font-weight: 600;
}

.verdict--ok {
  background: color-mix(in oklab, var(--color-success, oklch(72% 0.17 150)) 14%, transparent);
  color: var(--color-base-content);
}

.verdict--watch {
  background: var(--fill-3);
  color: var(--color-base-content);
}

.verdict--warning {
  background: color-mix(in oklab, var(--color-warning) 18%, transparent);
}

.verdict--error {
  background: color-mix(in oklab, var(--color-error) 16%, transparent);
}

.verdict--quiet {
  background: var(--fill-4);
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

.verdict__text {
  flex: 1;
}

.verdict__figure {
  font-variant-numeric: tabular-nums;
}

.diagnose__error {
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-error);
}

.diagblock {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.block__head {
  display: flex;
  align-items: baseline;
  gap: var(--gap);
}

.block__title {
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

.block__note {
  margin-inline-start: auto;
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 42%, transparent);
}

.figures,
.facts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gap);
  margin: 0;
}

.facts {
  grid-template-columns: repeat(2, 1fr);
}

.figure,
.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.figure dt,
.fact dt {
  font-size: 0.6875rem;
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.figure dd,
.fact dd {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checks {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 1px solid var(--separator);
  border-radius: var(--radius-box);
  background: var(--fill-4);
  list-style: none;
  overflow: hidden;
}

.check {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap);
  min-height: 2.5rem;
  padding-inline: var(--gap-loose);
  font-size: 0.8125rem;
}

.check + .check::before {
  content: '';
  position: absolute;
  top: 0;
  inset-inline: var(--gap-loose) 0;
  height: 1px;
  background: var(--separator);
}

.check__mark {
  flex: 0 0 auto;
  color: var(--color-success, oklch(60% 0.15 150));
}

.check--failed .check__mark {
  color: var(--color-error);
}

.check__label {
  flex: 0 0 auto;
  font-weight: 550;
}

.check__detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: color-mix(in oklab, var(--color-base-content) 50%, transparent);
}

.check__ms {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}

.check--pending {
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.diagnose__foot {
  display: flex;
  justify-content: flex-end;
}
</style>
