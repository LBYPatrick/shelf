import { onBeforeUnmount, onMounted } from 'vue';
import { BINDINGS, matches } from '../lib/keybindings';

/**
 * Global keyboard shortcuts.
 *
 * Bindings are ignored while the user is typing, unless the binding uses a
 * modifier — otherwise pressing F5 in a text field would refresh the schema
 * instead of typing, and ⌘Enter inside the editor would not run the query.
 *
 * Two passes, and which one a binding takes is declared on the binding itself.
 * Most run on the way back up, after the focused widget has had its say, so an
 * editor keeps ⌘F for its own find widget. The window's chrome runs on the way
 * *down*, before any widget sees the key: Monaco treats ⌘K as a chord prefix
 * and stops it dead, so the palette could not be opened from inside the editor
 * at all. A widget must not be able to take away the way out of it.
 */
export function useHotkeys(handlers: Record<string, () => void>): void {
  function isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (element.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
  }

  function handle(event: KeyboardEvent, phase: 'capture' | 'bubble'): void {
    for (const binding of BINDINGS) {
      if ((binding.global === true) !== (phase === 'capture')) continue;

      const handler = handlers[binding.id];
      if (!handler) continue;

      const accelerator = binding.keys.find((key) => matches(event, key));
      if (!accelerator) continue;

      const bare = !/mod|ctrl|alt/.test(accelerator);
      if (bare && isTyping(event.target)) continue;

      event.preventDefault();
      // Capture only reaches here for chrome, and the widget below must not
      // also act on the key — Monaco would otherwise still enter chord mode.
      if (phase === 'capture') event.stopPropagation();
      handler();
      return;
    }
  }

  const onCapture = (event: KeyboardEvent) => handle(event, 'capture');
  const onBubble = (event: KeyboardEvent) => handle(event, 'bubble');

  onMounted(() => {
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onCapture, true);
    window.removeEventListener('keydown', onBubble);
  });
}
