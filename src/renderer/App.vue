<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { usePlatform } from './composables/usePlatform';
import { useTheme } from './composables/useTheme';
import { useSettings } from './stores/settings';
import { useConnections } from './stores/connections';
import { useUpdates } from './stores/updates';
import ConnectionManager from './views/ConnectionManager.vue';
import HoverTip from './components/chrome/HoverTip.vue';
import ToastStack from './components/chrome/ToastStack.vue';
import UpdateSheet from './components/settings/UpdateSheet.vue';
import Workspace from './views/Workspace.vue';

usePlatform();
useTheme();
const settings = useSettings();
const updates = useUpdates();

const connections = useConnections();
const connected = computed(() => connections.active !== null);

/*
 * The window is sized to the screen it is showing. A workspace is a tool you
 * make as large as your display; the start screen is a panel, and given the
 * same window it is mostly emptiness.
 */
watch(connected, (open) => window.shelf.window.setCompact(!open), { immediate: true });

/**
 * How long after launch the quiet check runs.
 *
 * Not immediately. The first seconds belong to the window arriving, the theme
 * being applied and the connection list being read, and a network request
 * competing with those makes the app slower to become usable in exchange for
 * an answer nobody is waiting for. Long enough to be out of the way, short
 * enough that somebody who launches the app to do one thing still hears about
 * a new version before they close it.
 */
const STARTUP_DELAY_MS = 4000;

/*
 * Once per launch, and only if the preference says so.
 *
 * It waits for the stored preferences rather than reading the default: the
 * store starts at the shipped values and is corrected a moment later by what is
 * actually saved, so a check fired before that lands is a check somebody
 * switched off still getting made.
 */
onMounted(async () => {
  await settings.ready;
  if (!settings.values.checkUpdatesOnStartup) return;

  setTimeout(() => void updates.checkQuietly(), STARTUP_DELAY_MS);
});
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
    And the update prompt, for the same reason and one more.
    ───────────────────────────────────────────────────────
    A check can be started from Settings on either screen or from the palette,
    and it can finish after the sheet that started it has been closed — or after
    a database has been opened and the whole view has changed underneath it. A
    surface owned by one view could only ever be opened from that view; this one
    is owned by the flow, and the flow is the app's.
  -->
  <UpdateSheet />

  <!--
    One label for the whole window. Outside the view swap for the same reason
    the toasts are: the rail exists in one view and the start screen's own
    controls in the other, and both want naming.
  -->
  <HoverTip />
</template>
