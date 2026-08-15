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

    // How tall a band the traffic lights need. The top bar is at least this,
    // whatever the density scale would otherwise make it, because the controls
    // are drawn by the OS and do not shrink with the interface.
    document.documentElement.style.setProperty(
      '--controls-h',
      value.nativeWindowControls ? '2.5rem' : '0px'
    );

    // How far in from the window's leading edge the controls reach. Anything
    // that can end up beneath them has to keep this much clear.
    document.documentElement.style.setProperty(
      '--controls-inset',
      `${value.windowControlsInset}px`
    );

    return value;
  });

  return { info, ready };
});
