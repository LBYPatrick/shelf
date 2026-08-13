import { onBeforeUnmount, onMounted } from 'vue';
import { BINDINGS, matches } from '../lib/keybindings';

/**
 * Global keyboard shortcuts.
 *
 * Bindings are ignored while the user is typing, unless the binding uses a
 * modifier — otherwise pressing F5 in a text field would refresh the schema
 * instead of typing, and ⌘Enter inside the editor would not run the query.
 */
export function useHotkeys(handlers: Record<string, () => void>): void {
  function isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (element.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
  }

  function onKeydown(event: KeyboardEvent): void {
    for (const binding of BINDINGS) {
      const handler = handlers[binding.id];
      if (!handler) continue;

      const accelerator = binding.keys.find((key) => matches(event, key));
      if (!accelerator) continue;

      const bare = !/mod|ctrl|alt/.test(accelerator);
      if (bare && isTyping(event.target)) continue;

      event.preventDefault();
      handler();
      return;
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
