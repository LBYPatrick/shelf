<script setup lang="ts">
/**
 * Everything a table is, in one popup.
 *
 * The columns, indexes, relations and triggers used to be a whole tab, reached
 * by a small icon that appeared on hover at the end of a sidebar row — a target
 * you had to know was there, opening a tab you then had to close. They are
 * reference material: you come to check one thing and leave. A popup is the
 * shape of that, and a tab is not.
 *
 * The header states the three numbers that describe the table as a whole, above
 * the sections that describe its parts. That ordering is the point of the
 * layout: the summary answers "how big is this" without reading anything, and
 * the sections are there when the answer is "why".
 */
import type { EntityProperties, EntityRef } from '@drivers/types';
import { ref } from 'vue';
import { formatBytes } from '@shared/bytes';
import Sheet from '../ui/Sheet.vue';
import PressButton from '../ui/PressButton.vue';
import EntityStructure from './EntityStructure.vue';

defineProps<{ entity: EntityRef }>();
const open = defineModel<boolean>({ required: true });

const properties = ref<EntityProperties>({});
</script>

<template>
  <!--
    Stacked, like the container popup beside it: what this belongs to, then what
    it is. A qualified name run together as one string makes the part you came
    to read the smaller half of it.
  -->
  <Sheet
    v-model="open"
    wide
    :title="entity.name"
    :subtitle="entity.schema"
  >
    <!--
      Three facts, given equal weight and read left to right. A definition list
      rather than a table: they are label-and-value pairs, and marking them up
      as rows of a grid would make a screen reader announce column headers that
      do not exist.
    -->
    <dl class="facts">
      <div class="facts__item">
        <dt class="type-label">
          {{ $t('properties.rows') }}
        </dt>
        <dd>{{ properties.rowCount?.toLocaleString() ?? '—' }}</dd>
      </div>
      <div class="facts__item">
        <dt class="type-label">
          {{ $t('properties.data') }}
        </dt>
        <dd>{{ formatBytes(properties.dataSizeBytes) }}</dd>
      </div>
      <div class="facts__item">
        <dt class="type-label">
          {{ $t('properties.indexes') }}
        </dt>
        <dd>{{ formatBytes(properties.indexSizeBytes) }}</dd>
      </div>
    </dl>

    <p
      v-if="properties.comment"
      class="comment"
    >
      {{ properties.comment }}
    </p>

    <!--
      The structure view brings its own section switcher and its own scrolling,
      so it is given a fixed share of the sheet rather than being allowed to
      grow it: a table with two hundred columns should scroll inside the popup,
      not make the popup two hundred rows tall.
    -->
    <div class="structure-pane">
      <EntityStructure
        :entity="entity"
        @loaded="properties = $event"
      />
    </div>

    <template #footer>
      <PressButton
        variant="primary"
        size="sm"
        @click="open = false"
      >
        {{ $t('action.done') }}
      </PressButton>
    </template>
  </Sheet>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--gap);
  margin: 0;
  padding-block: var(--gap) var(--gap-loose);
}

.facts__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: var(--fill-4);
}

.facts dt {
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
  text-transform: uppercase;
}

.facts dd {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.011em;
  font-variant-numeric: tabular-nums;
}

.comment {
  margin: 0 0 var(--gap-loose);
  padding: var(--gap) var(--gap-loose);
  border-radius: var(--radius-box);
  background: color-mix(in oklab, var(--color-primary) 8%, transparent);
  font-size: 0.8125rem;
}

/*
 * A window onto the sections, not a container that grows with them. 22rem is
 * about a dozen rows — enough that scrolling is obviously possible rather than
 * a surprise, and short enough that the summary above stays on screen.
 */
.structure-pane {
  display: flex;
  height: 22rem;
  min-height: 0;
  border-radius: var(--radius-box);
  border: 1px solid var(--separator);
  overflow: hidden;
}
</style>
