<script setup lang="ts">
import { computed, watch } from 'vue';
import { usePlatform } from './composables/usePlatform';
import { useTheme } from './composables/useTheme';
import { useSettings } from './stores/settings';
import { useConnections } from './stores/connections';
import ConnectionManager from './views/ConnectionManager.vue';
import HoverTip from './components/chrome/HoverTip.vue';
import ToastStack from './components/chrome/ToastStack.vue';
import Workspace from './views/Workspace.vue';

usePlatform();
useTheme();
useSettings();

const connections = useConnections();
const connected = computed(() => connections.active !== null);

/*
 * The window is sized to the screen it is showing. A workspace is a tool you
 * make as large as your display; the start screen is a panel, and given the
 * same window it is mostly emptiness.
 */
watch(connected, (open) => window.shelf.window.setCompact(!open), { immediate: true });
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

  <!--
    Outside the view swap, because what a toast has to say usually outlives the
    screen that caused it — losing the connection host closes the workspace, and
    the message explaining why must not close with it.
  -->
  <ToastStack />

  <!--
    One label for the whole window. Outside the view swap for the same reason
    the toasts are: the rail exists in one view and the start screen's own
    controls in the other, and both want naming.
  -->
  <HoverTip />
</template>
