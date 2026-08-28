<script setup lang="ts">
/**
 * An engine's own mark.
 *
 * The tile used to carry two letters — `Pg`, `My`, `Sc` — which is a fair
 * fallback and a poor first impression: a list of saved connections read as a
 * column of initials, and the one thing somebody scanning it wants is which
 * *kind* of database each row is. A logo answers that before the name is read.
 *
 * Paths from `simple-icons` (CC0-1.0, so there is nothing to attribute and
 * nothing to comply with). Depended on rather than inlined, which is the
 * opposite of the call `ProviderMark` makes next door — and the difference is
 * the size of the set. Six AI providers is six paths and a package is overhead;
 * nine engines out of three and a half thousand marks is a package, because the
 * tenth engine is then a one-line map entry instead of a trip to find an SVG
 * and check its licence. `sideEffects: false` and named exports mean the
 * bundler keeps the eight that are named here and drops the rest.
 *
 * **Drawn in white on the engine's hue, never in the brand's own colour.** The
 * tile behind it is already coloured — that is what tells one engine from
 * another at a glance — and a brand colour laid on a coloured tile is the one
 * combination guaranteed to fail its contrast. It is the same rule a filled
 * accent control follows, and it means neither appearance nor
 * `prefers-contrast` needs a value of its own.
 *
 * The letters stay as the declared fallback rather than as dead code: Amazon's
 * service marks are not in the set, so DynamoDB has no path and draws `Dy`. An
 * engine added tomorrow does the same until somebody maps it, which is a
 * slightly plainer tile rather than an empty one.
 *
 * MySQL's mark is a *lockup* — the dolphin with the word under it — where every
 * other one here is a glyph, so at twenty pixels it is the busiest tile in the
 * row and its wordmark is a smudge beside a chip that already says MySQL. It is
 * kept anyway: it is the mark people recognise, the silhouette still reads as a
 * dolphin, and the alternative is letters on the one engine in the list most
 * likely to be looked for. Cropping the wordmark out with a hand-tuned viewBox
 * was the other option and is the worse one — a package update moves the path
 * and the crop misframes it silently.
 */
import { computed } from 'vue';
import {
  siDuckdb,
  siMongodb,
  siMysql,
  siPostgresql,
  siRedis,
  siScylladb,
  siSqlite,
  siTidb,
} from 'simple-icons';
import type { EngineId } from '@drivers/types';
import { engineDescriptor } from '@shared/engines';

const props = withDefaults(defineProps<{ engine: EngineId; size?: number }>(), {
  size: 12,
});

/**
 * Which mark stands for which engine.
 *
 * Partial on purpose — see the note above about DynamoDB. A `Record` would make
 * the missing one a type error and the fix for that error would be inventing a
 * logo, which is worse than the letters.
 */
const MARKS: Partial<Record<EngineId, { readonly path: string; readonly title: string }>> = {
  postgres: siPostgresql,
  mysql: siMysql,
  tidb: siTidb,
  sqlite: siSqlite,
  duckdb: siDuckdb,
  mongodb: siMongodb,
  redis: siRedis,
  scylla: siScylladb,
};

const mark = computed(() => MARKS[props.engine]);

/** The two letters, for an engine the set does not carry. */
const letters = computed(() => engineDescriptor(props.engine).mark);
</script>

<template>
  <svg
    v-if="mark"
    class="mark"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="mark.path" />
  </svg>

  <!--
    No size of its own: the letters inherit whatever type the tile around them
    sets, which is a different size in the picker, the switcher and the start
    screen. A font-size here would be a fourth opinion about three tiles.
  -->
  <span v-else class="letters" aria-hidden="true">{{ letters }}</span>
</template>

<style scoped>
.mark {
  display: block;
  flex: none;
}

.letters {
  letter-spacing: -0.01em;
  line-height: 1;
}
</style>
