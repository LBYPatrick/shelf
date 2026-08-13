<script setup lang="ts">
import { computed } from 'vue';
import { usePlatform } from './composables/usePlatform';
import { useTheme } from './composables/useTheme';
import { useSettings } from './stores/settings';
import { useConnections } from './stores/connections';
import ConnectionManager from './views/ConnectionManager.vue';
import Workspace from './views/Workspace.vue';

usePlatform();
useTheme();
useSettings();

const connections = useConnections();
const connected = computed(() => connections.active !== null);
</script>

<template>
  <!--
    No title bar. The window's chrome is the content: on macOS the traffic
    lights float over the sidebar, and the connection they would have labelled
    sits at the top of that sidebar instead, where the rest of the database's
    structure is.
  -->
  <main class="h-full min-h-0">
    <Workspace v-if="connected" />
    <ConnectionManager v-else />
  </main>
</template>
