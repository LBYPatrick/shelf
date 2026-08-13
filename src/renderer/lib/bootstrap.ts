import { HOST_CHANNELS } from '@shared/window';
import { host } from './host';

/**
 * Connects the renderer to the connection host.
 *
 * The port arrives as a `window.postMessage` from the preload script, because a
 * MessagePort cannot be passed across the context bridge directly. On a host
 * restart we simply ask for another one — the connections it held are gone, so
 * the interface must reconnect rather than pretend they survived.
 */
export function connectToHost(onHostLost: (permanent: boolean) => void): void {
  window.addEventListener('message', (event) => {
    if (event.data?.type !== HOST_CHANNELS.port) return;
    const port = event.ports[0];
    if (port) host.attach(port);
  });

  window.shelf.host.onRestarted(() => {
    host.detach('The database connection host restarted.');
    onHostLost(false);
    window.shelf.host.requestPort();
  });

  window.shelf.host.onUnavailable(() => {
    host.detach('The database connection host could not be started.');
    onHostLost(true);
  });

  window.shelf.host.requestPort();
}
