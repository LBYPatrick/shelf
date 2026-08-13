import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PlatformInfo } from '@shared/platform';

/**
 * Platform facts, fetched once at startup. Everything that branches on the host
 * OS reads them from here rather than sniffing the user agent.
 */
export const usePlatform = defineStore('platform', () => {
  const info = ref<PlatformInfo>({
    platform: 'linux',
    nativeWindowControls: false,
    windowControlsInset: 0,
    appVersion: '0.0.0',
    locale: 'en-US',
  });

  const ready = window.shelf.platformInfo().then((value) => {
    info.value = value;

    // Linux compositors rarely provide window translucency, so the renderer
    // paints its own opaque surface instead of relying on the OS.
    if (value.platform === 'linux') {
      document.documentElement.dataset['translucency'] = 'none';
    }

    // The traffic lights float over the interface, so the first column of
    // controls has to start below them.
    document.documentElement.style.setProperty(
      '--rail-top',
      value.nativeWindowControls ? '2.5rem' : '0.5rem'
    );

    return value;
  });

  return { info, ready };
});
