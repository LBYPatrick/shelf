import { defineStore } from 'pinia';
import i18next from 'i18next';
import { computed, markRaw, ref } from 'vue';
import { AI_NOT_SIGNED_IN } from '@shared/ai';
import type {
  AiAttachment,
  AiDriverKind,
  AiItem,
  AiMessage,
  AiPhase,
  AiProvider,
  AiProviderInput,
} from '@shared/ai';
import type { SavedChat } from '@shared/appdb';
import { AI_DRIVERS, detectedProvider, isDetectedProviderId } from '@shared/aiDrivers';
import { NO_FILTER, type JobFilter } from '@shared/jobFilter';
import { chatTitle } from '@shared/chatTitle';
import type { SchemaScope } from '@shared/schemaDoc';
import { RpcCancelled, RpcError } from '@shared/rpc';
import { host } from '../lib/host';
import { saveSetting } from '../lib/settings';

/**
 * The assistant, as the interface holds it.
 *
 * Two things live here. One is the list of configured providers, which is
 * settings — read once, written when edited. The other is the conversations.
 *
 * Those were once deliberately *not* kept, on the argument that a transcript
 * holds whatever rows were read on the way to an answer and that filing them
 * beside the connection list is a promise this feature had not earned. The
 * argument loses to the obvious: a conversation you cannot get back is one you
 * have to have again, and the app already records every statement anyone runs.
 * So they are saved, per connection, and the cost is made plain instead of
 * hidden — a saved chat includes the rows it looked at, and deleting the card
 * deletes them.
 *
 * A conversation is written when a turn finishes, never while one is streaming:
 * a partial answer is not worth a row, and writing per token would be a write
 * per token.
 */

/** One exchange, as the chat draws it. */
export interface ChatTurn {
  readonly id: string;
  /** What the reader asked. Absent on the opening note. */
  readonly question?: string;
  items: AiItem[];
  state: 'running' | 'done' | 'failed' | 'stopped';
  error?: string;
  /**
   * What the host is doing while nothing is on screen yet.
   *
   * Only meaningful while the turn is running, which is why nothing clears it
   * when the turn ends: the one place it is read is behind that condition.
   */
  phase?: AiPhase;
  /**
   * The CLI that has nobody signed in to it, when that is why this failed.
   *
   * The one failure whose fix is in a terminal rather than in this window, so
   * it is kept apart from `error` — the interface answers it with the command
   * to run rather than with the sentence the host wrote.
   */
  signIn?: AiDriverKind;
}

export interface Conversation {
  readonly tabId: string;
  /** The row this is saved as. Stable across renames and reopenings. */
  id: string;
  title: string;
  scope: SchemaScope;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
  /** The abort for whatever is in flight, so the tab can stop it. */
  controller?: AbortController;
}

/** What is written to the row, and read back out of it. */
interface StoredChat {
  readonly scope: SchemaScope;
  readonly turns: readonly ChatTurn[];
}

const PREFERRED = 'assistant:provider';

let counter = 0;
const nextTurnId = () => `turn-${Date.now().toString(36)}-${++counter}`;

export const useAssistant = defineStore('assistant', () => {
  const stored = ref<AiProvider[]>([]);
  /** The command-line assistants found on this machine, as of the last look. */
  const installed = ref<AiProvider[]>([]);
  const preferredId = ref<string | null>(null);
  const loaded = ref(false);

  const conversations = ref(new Map<string, Conversation>());
  /** The cards, newest first. Bodies are not loaded until one is opened. */
  const chats = ref<SavedChat[]>([]);

  /*
   * What the sidebar is searching for, and what it is narrowed by.
   *
   * Here rather than in the list, because the field is in the panel's header
   * row — where every other panel's field is — and the chips are a sibling of
   * the list. The jobs panel keeps the same shape in its own store, which is
   * what lets one set of chips serve both.
   */
  const filter = ref<JobFilter>({ ...NO_FILTER, criteria: [] });

  /**
   * The provider a new turn uses.
   *
   * Falls through to the first configured one rather than refusing to act,
   * because "you have one provider and it is not selected" is not a state worth
   * having an error message for.
   */
  /**
   * Everything the reader can choose between.
   *
   * The detected ones lead, because they are the ones that need nothing done to
   * them: someone with Claude Code on this machine is already set up, and the
   * rest of the list starts with a trip to a website for a key.
   */
  const providers = computed<AiProvider[]>(() => [...installed.value, ...stored.value]);

  /**
   * The command-line assistants this build knows about and this machine has not
   * got.
   *
   * Shown, and not choosable. A list that simply omits them answers "can I use
   * Codex with this?" by saying nothing at all — the reader cannot tell a
   * provider that is missing from one that was never supported, and the only
   * way to find out is to install something and look again. Named and greyed,
   * the list is the answer.
   *
   * Deliberately *not* part of `providers`. That is the set a turn can actually
   * use, and it is what `configured` and `active` are computed from — folding
   * these in would make an unconfigured machine claim it had an assistant, warm
   * a schema nobody can ask about, and offer a name-suggestion button that
   * cannot answer.
   */
  const unavailable = computed<AiProvider[]>(() => {
    const here = new Set(installed.value.map((provider) => provider.driver));
    return AI_DRIVERS.filter((driver) => driver.detected && !here.has(driver.kind)).map(
      (driver) => detectedProvider(driver.kind)
    );
  });

  const active = computed<AiProvider | null>(
    () =>
      providers.value.find((provider) => provider.id === preferredId.value) ??
      providers.value[0] ??
      null
  );

  const configured = computed(() => providers.value.length > 0);

  async function refresh(): Promise<void> {
    /*
     * The machine is asked every time, not only at first run. A CLI installed
     * over lunch should appear the next time the picker opens, and one removed
     * should stop being offered — a list built once would go on naming a
     * program that is no longer there, and the failure would arrive as a failed
     * spawn in the middle of a question.
     *
     * It is allowed to fail quietly. Detection not answering means the two rows
     * it would have added are missing, which is the state everybody without
     * either CLI is in anyway; the configured providers must not go with it.
     */
    const [list, preferred, cli] = await Promise.all([
      window.shelf.db.listAiProviders(),
      window.shelf.db.getSetting<string | null>(PREFERRED, null),
      host.call('ai/installed', {}).catch(() => [] as const),
    ]);
    stored.value = list;
    installed.value = cli.map(detectedProvider);
    preferredId.value = preferred;
    loaded.value = true;
  }

  function choose(id: string): void {
    preferredId.value = id;
    void saveSetting(PREFERRED, id);
  }

  async function save(input: AiProviderInput): Promise<AiProvider> {
    const saved = await window.shelf.db.saveAiProvider(input);
    await refresh();
    // A provider added when there were none becomes the one in use, so adding
    // one is the whole of setting the feature up rather than the first half.
    if (!preferredId.value) choose(saved.id);
    return saved;
  }

  async function remove(id: string): Promise<void> {
    // A detected provider is not ours to delete: it is a program on the
    // machine, and the way to be rid of it is to uninstall it.
    if (isDetectedProviderId(id)) return;
    await window.shelf.db.removeAiProvider(id);
    if (preferredId.value === id) {
      preferredId.value = null;
      void saveSetting(PREFERRED, null);
    }
    await refresh();
  }

  /** A single-use handle for the provider in use, staged with the host. */
  async function handle(): Promise<string> {
    const provider = active.value;
    if (!provider) throw new Error('No assistant provider is configured.');
    return window.shelf.db.prepareAiProvider(provider.id);
  }

  /**
   * A name for a statement, from whichever provider is in use.
   *
   * Here rather than in the query tab because the provider, the handle and the
   * reader's language all live here — a caller that had to assemble those would
   * be a second place that knows how a provider is reached.
   *
   * Throws when nothing is configured, which the caller reports. Silently doing
   * nothing is the failure a reader cannot tell from the app being broken.
   */
  async function suggestName(sql: string): Promise<string> {
    const token = await handle();
    const { name } = await host.call('ai/name', {
      handle: token,
      sql,
      locale: i18next.resolvedLanguage ?? 'en-US',
    });
    return name;
  }

  /* --------------------------------------------------------------- warm-up */

  /**
   * Which connections have had their schema read ahead of being asked about.
   *
   * Per connection rather than a boolean, because switching back and forth
   * between two databases must not warm one and count the other done.
   */
  const warmed = new Set<string>();
  let warming: AbortController | undefined;

  /**
   * Reads the schema before anybody asks a question about it.
   *
   * The first turn of a conversation sat on "Reading the schema…" for as long
   * as an N+1 walk of the database takes — `listEntities`, then columns,
   * indexes and relations per entity, up to a couple of hundred round trips
   * before a word reaches the model. Every turn after it was free, because the
   * host already caches those reads per connection. Only the first one paid,
   * and it paid at the exact moment somebody had just finished typing.
   *
   * So it is paid earlier, when the reader is looking at a tree rather than at
   * a cursor. Nothing new is cached and no TTL is changed: this calls the same
   * channel a turn calls and fills the same cache, which is what makes it safe
   * — a warm-up that populated a store of its own would be a second answer that
   * could disagree with the first.
   *
   * Three things it deliberately does not do. It does not run where no provider
   * is configured, because then it is a couple of hundred queries for a feature
   * that cannot be reached. It does not report failure: nobody asked for this,
   * so a database that refuses it should cost a turn's wait later rather than
   * an error now. And it does not race the interface — the caller holds it
   * until the panel the reader is actually looking at has loaded.
   */
  async function warmSchema(connectionId: string | null | undefined): Promise<void> {
    if (!connectionId || !configured.value || warmed.has(connectionId)) return;

    warming?.abort();
    const controller = new AbortController();
    warming = controller;
    warmed.add(connectionId);

    try {
      await host.call(
        'ai/schema',
        { connectionId, scope: { kind: 'connection' } },
        controller.signal
      );
    } catch {
      /*
       * Forgotten rather than remembered as done. A connection that dropped
       * mid-walk, or a warm-up abandoned because the reader switched away,
       * should be warmed again next time rather than being written off — and
       * the turn that needs it will read the schema itself either way.
       */
      warmed.delete(connectionId);
    }
  }

  async function probe(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const token = await window.shelf.db.prepareAiProvider(id);
    return host.call('ai/probe', { handle: token });
  }

  // ----------------------------------------------------------- conversations

  function conversation(tabId: string, scope: SchemaScope): Conversation {
    const existing = conversations.value.get(tabId);
    if (existing) return existing;

    const now = Date.now();
    const created: Conversation = {
      tabId,
      id: '',
      title: '',
      scope,
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
    conversations.value.set(tabId, created);
    // The map is the reactive value, and mutating it in place does not notify.
    conversations.value = new Map(conversations.value);
    return conversations.value.get(tabId)!;
  }

  /** Puts a saved conversation into a tab, ready to be continued. */
  async function adopt(tabId: string, chat: SavedChat): Promise<Conversation> {
    const full = chat.body ? chat : ((await window.shelf.db.readChat(chat.id)) ?? chat);

    const stored = ((): StoredChat | null => {
      try {
        return JSON.parse(full.body) as StoredChat;
      } catch {
        // A body written by a newer version, or a half-written one. The card is
        // still real; it simply opens empty rather than refusing to open.
        return null;
      }
    })();

    const restored: Conversation = {
      tabId,
      id: full.id,
      title: full.title,
      scope: stored?.scope ?? { kind: 'connection' },
      turns: (stored?.turns ?? []).map((turn) => ({ ...turn, items: [...turn.items] })),
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
    };

    conversations.value.set(tabId, restored);
    conversations.value = new Map(conversations.value);
    return conversations.value.get(tabId)!;
  }

  async function refreshChats(connectionId: string | null): Promise<void> {
    chats.value = await window.shelf.db.listChats(connectionId).catch(() => []);
  }

  /**
   * Writes the conversation, and names it if it has no name yet.
   *
   * The title comes from the first question and is set once. Renaming it later
   * is the reader's to do; regenerating it from a conversation that has moved
   * on would rename a card someone had already learned to find.
   */
  async function persist(chat: Conversation, connectionId: string | null): Promise<void> {
    const first = chat.turns.find((turn) => turn.question)?.question ?? '';
    if (!first) return;

    const title = chat.title || chatTitle(first) || 'Chat';
    const body: StoredChat = { scope: chat.scope, turns: chat.turns };

    const saved = await window.shelf.db.saveChat({
      ...(chat.id ? { id: chat.id } : {}),
      connectionId,
      title,
      // Serialised here rather than at the bridge: a turn holds reactive
      // proxies, and the context bridge rejects one outright.
      body: JSON.stringify(body),
    });

    chat.id = saved.id;
    chat.title = saved.title;
    chat.updatedAt = saved.updatedAt;
    await refreshChats(connectionId);
  }

  async function rename(id: string, title: string): Promise<void> {
    await window.shelf.db.renameChat(id, title);
    for (const chat of conversations.value.values()) {
      if (chat.id === id) chat.title = title.trim();
    }
    chats.value = chats.value.map((chat) =>
      chat.id === id ? { ...chat, title: title.trim() } : chat
    );
  }

  async function discard(id: string, connectionId: string | null): Promise<void> {
    await window.shelf.db.removeChat(id);
    await refreshChats(connectionId);
  }

  function forget(tabId: string): void {
    const existing = conversations.value.get(tabId);
    existing?.controller?.abort();
    conversations.value.delete(tabId);
    conversations.value = new Map(conversations.value);
  }

  /** Everything said so far, as the model needs it: prose only, in order. */
  function historyOf(chat: Conversation): AiMessage[] {
    const messages: AiMessage[] = [];
    for (const turn of chat.turns) {
      if (turn.question) messages.push({ role: 'user', text: turn.question });
      const said = turn.items
        .filter((item) => item.kind === 'text' || item.kind === 'sql')
        .map((item) => (item.kind === 'sql' ? `\`\`\`sql\n${item.sql}\n\`\`\`` : item.text))
        .join('\n\n');
      if (said) messages.push({ role: 'assistant', text: said });
    }
    return messages;
  }

  function apply(turn: ChatTurn, item: AiItem): void {
    const at = turn.items.findIndex((existing) => existing.id === item.id);
    if (at === -1) turn.items.push(item);
    else turn.items.splice(at, 1, item);
  }

  /**
   * Asks, and streams the answer into the turn.
   *
   * The listeners are attached before the request and detached in `finally`,
   * never left on: every turn in every open chat tab shares one host client, so
   * a listener that outlives its turn writes another conversation's tokens into
   * this one's.
   */
  async function ask(
    tabId: string,
    connectionId: string,
    question: string,
    /**
     * Files put with this question.
     *
     * Not kept on the turn. A conversation is not persisted, and a transcript
     * that redrew the attachments would be redrawing what was *sent* rather
     * than what was said — the text of them is already in the question the
     * model answered, and a picture is not something this view can show back.
     */
    attachments: readonly AiAttachment[] = []
  ): Promise<void> {
    const chat = conversations.value.get(tabId);
    if (!chat) return;

    const turnId = nextTurnId();
    // `schema` rather than nothing, because it is what the host does first and
    // a label that arrives one round trip late is a flash of no label at all.
    chat.turns.push({ id: turnId, question, items: [], state: 'running', phase: 'schema' });

    /*
     * Which provider this turn is being asked of, read before the request.
     *
     * A sign-in failure comes back as a code and not as a provider, and by the
     * time it arrives the reader may well have changed the picker — so the
     * answer to "which CLI do I sign in to" is taken here, where it is certain.
     */
    const driver = active.value?.driver;

    /*
     * The turn as the interface sees it, not the object that was pushed.
     *
     * `conversations` is a ref holding a Map, so everything reachable through
     * it is deeply reactive: what the template renders is a *proxy* of this
     * turn. Writing to the object that was handed to `push` writes through the
     * raw value, which changes the data and notifies nothing — the answer
     * arrived, the store held it, and the chat sat on its spinner. Read it back
     * out of the array and every write goes through the proxy.
     */
    const turn = chat.turns[chat.turns.length - 1]!;

    /*
     * Not reactive, and deliberately so. An AbortController is an object with
     * identity and a live signal; wrapping it in a proxy buys nothing and
     * invites a listener to be registered on one identity and fired on another.
     */
    const controller = markRaw(new AbortController());
    chat.controller = controller;

    const mine = <T extends { turnId: string }>(payload: T) => payload.turnId === turnId;

    const stop = [
      host.on('ai/item', (payload) => {
        if (mine(payload)) apply(turn, payload.item);
      }),
      host.on('ai/delta', (payload) => {
        if (!mine(payload)) return;
        const at = turn.items.findIndex((item) => item.id === payload.itemId);
        const item = turn.items[at];
        if (!item || (item.kind !== 'text' && item.kind !== 'thinking')) return;
        turn.items.splice(at, 1, { ...item, text: item.text + payload.text });
      }),
      host.on('ai/phase', (payload) => {
        if (mine(payload)) turn.phase = payload.phase;
      }),
      host.on('ai/replace', (payload) => {
        if (!mine(payload)) return;
        const at = turn.items.findIndex((item) => item.id === payload.itemId);
        if (at === -1) return;
        turn.items.splice(at, 1, ...payload.items);
      }),
    ];

    try {
      const token = await handle();
      const result = await host.call(
        'ai/turn',
        {
          connectionId,
          handle: token,
          turnId,
          scope: chat.scope,
          // The turn being added is not part of its own history.
          history: historyOf(chat).slice(0, -1),
          question,
          ...(attachments.length > 0 ? { attachments } : {}),
          /*
           * Which language the reader reads. The host cannot work this out: it
           * is a renderer setting, and a utility process's own OS locale is not
           * the one anybody chose. `resolvedLanguage` is what "follow the
           * system" has already been resolved to.
           */
          locale: i18next.resolvedLanguage ?? 'en-US',
        },
        controller.signal
      );
      /*
       * The events already built the items, and the result carries the same
       * ones. Taking the result as authoritative closes the gap where an event
       * arrived after the reply — which happens, because they travel the same
       * port but are not ordered against each other by anything.
       */
      turn.items = [...result.items];
      turn.state = 'done';
    } catch (error) {
      if (error instanceof RpcCancelled || controller.signal.aborted) {
        turn.state = 'stopped';
      } else {
        turn.state = 'failed';
        turn.error = error instanceof Error ? error.message : String(error);
        // Branching on the code rather than on the message: the sentence is
        // there to be improved, and a match on English prose is a branch that
        // breaks the first time somebody improves it.
        if (error instanceof RpcError && error.code === AI_NOT_SIGNED_IN && driver) {
          turn.signIn = driver;
        }
      }
    } finally {
      for (const off of stop) off();
      if (chat.controller === controller) chat.controller = undefined;
      // Written once the turn has stopped moving, whatever it ended as: a
      // failed or interrupted exchange is still one the reader may want back.
      await persist(chat, connectionId).catch(() => undefined);
    }
  }

  function interrupt(tabId: string): void {
    conversations.value.get(tabId)?.controller?.abort();
  }

  return {
    providers,
    unavailable,
    filter,
    preferredId,
    loaded,
    active,
    configured,
    conversations,
    chats,
    adopt,
    refreshChats,
    rename,
    discard,
    refresh,
    choose,
    save,
    remove,
    probe,
    suggestName,
    warmSchema,
    conversation,
    forget,
    ask,
    interrupt,
  };
});
