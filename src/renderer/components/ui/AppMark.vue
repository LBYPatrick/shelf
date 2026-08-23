<script setup lang="ts">
/**
 * The app's own mark.
 *
 * The same drawing the dock shows: `assets/icon.svg` is the one artwork, and
 * the packagers rasterise it from there too. An app whose start screen and
 * whose icon are different pictures has two identities and belongs to neither.
 *
 * Sized in `em` from a single `size`, so the whole mark scales as one thing —
 * given none it takes the type scale of wherever it is put, which is what the
 * start screen wants: its identity block is sized in `em` throughout and the
 * mark grows with the words beneath it.
 */
import { computed } from 'vue';
import icon from '../../assets/icon.svg';

const props = defineProps<{ size?: number }>();

const style = computed(() =>
  props.size === undefined ? undefined : { fontSize: `${props.size / 3.6}px` }
);
</script>

<template>
  <img
    class="mark"
    :src="icon"
    :style="style"
    alt=""
    aria-hidden="true"
    draggable="false"
  >
</template>

<style scoped>
/*
 * The artwork carries its own rounded square and its own light, so there is
 * nothing to add here but the size and the shadow it casts on what it is
 * standing on.
 */
.mark {
  display: block;
  flex: none;
  width: 3.6em;
  height: 3.6em;
  filter: drop-shadow(0 2px 6px oklch(0% 0 0 / 0.22));
  user-select: none;
}
</style>
