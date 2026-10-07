import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTabs } from '../../src/renderer/stores/tabs';
import { useAssistant } from '../../src/renderer/stores/assistant';

beforeEach(() => setActivePinia(createPinia()));

describe('tab actions', () => {
  it('duplicates current query text beside its source without sharing state', () => {
    const tabs = useTabs();
    const source = tabs.openQuery('select 42;', { savedQueryId: 'saved-1', title: 'Analysis' });
    tabs.setUnsaved(source.id, true);
    const next = tabs.openQuery('select 7;');
    const copy = tabs.duplicate(source.id)!;
    expect(tabs.tabs.map((tab) => tab.id)).toEqual([source.id, copy.id, next.id]);
    expect(copy).toMatchObject({
      title: 'Analysis',
      text: 'select 42;',
      unsaved: true,
      savedQueryId: 'saved-1',
    });
    expect(tabs.activeId).toBe(copy.id);
    copy.text = 'select 100;';
    expect(tabs.byId(source.id)?.text).toBe('select 42;');
  });

  it('copies nested entity and diagram scope data', () => {
    const tabs = useTabs();
    const source = tabs.openEntity('table', { name: 'albums', schema: 'main' });
    const copy = tabs.duplicate(source.id)!;
    expect(copy.entity).toEqual(source.entity);
    expect(copy.entity).not.toBe(source.entity);
    const diagram = tabs.openErd({ kind: 'schema', name: 'main' });
    expect(tabs.duplicate(diagram.id)?.scope).not.toBe(diagram.scope);
  });

  it('closes by the current order, preserves its target, and permits reopening', () => {
    const tabs = useTabs();
    const list = Array.from({ length: 5 }, (_, n) => tabs.openQuery(`select ${n};`));
    tabs.move(4, 0);
    tabs.closeToLeft(list[1]!.id);
    expect(tabs.tabs.map((tab) => tab.id)).toEqual([list[1]!.id, list[2]!.id, list[3]!.id]);
    tabs.closeToRight(list[1]!.id);
    expect(tabs.tabs.map((tab) => tab.id)).toEqual([list[1]!.id]);
    expect(tabs.activeId).toBe(list[1]!.id);
    tabs.reopenLastClosed();
    expect(tabs.tabs).toHaveLength(2);
    tabs.closeOthers(list[1]!.id);
    expect(tabs.activeId).toBe(list[1]!.id);
  });

  it('does nothing for a stale menu target', () => {
    const tabs = useTabs();
    tabs.openQuery();
    expect(tabs.duplicate('missing')).toBeUndefined();
    tabs.closeOthers('missing');
    tabs.closeToLeft('missing');
    tabs.closeToRight('missing');
    expect(tabs.tabs).toHaveLength(1);
  });

  it('forks chats without their saved identity or in-flight controller', () => {
    const tabs = useTabs();
    const assistant = useAssistant();
    const source = tabs.openChat({ kind: 'connection' }, 'Investigation');
    source.chatId = 'saved-chat';
    const chat = assistant.conversation(source.id, { kind: 'connection' });
    chat.id = 'saved-chat';
    chat.title = 'Investigation';
    chat.controller = new AbortController();
    chat.turns.push({
      id: 'turn-1',
      state: 'running',
      phase: 'waiting',
      items: [{ kind: 'text', id: 'text-1', text: 'Partial answer' }],
    });
    const copy = tabs.duplicate(source.id)!;
    assistant.duplicateConversation(source.id, copy.id);
    const fork = assistant.conversation(copy.id, { kind: 'connection' });
    expect(copy.chatId).toBeUndefined();
    expect(fork.id).toBe('');
    expect(fork.controller).toBeUndefined();
    expect(fork.turns[0]?.state).toBe('stopped');
    expect(fork.turns[0]?.phase).toBeUndefined();
    fork.turns.splice(0, 1);
    expect(chat.turns).toHaveLength(1);
    expect(chat.controller.signal.aborted).toBe(false);
  });
});
