import { describe, expect, it } from 'vitest';
import type { SavedConnection } from '@shared/connections';
import {
  CONNECTION_DOCUMENT_KIND,
  parseConnections,
  serializeConnections,
} from '@shared/connectionFile';
import { parseSettings, serializeSettings, type SettingsState } from '@shared/settingsFile';

function connection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'c1',
    name: 'Staging',
    engine: 'postgres',
    folderId: null,
    position: 0,
    labelColor: '#ff0000',
    pinned: false,
    readOnly: true,
    rememberSecrets: true,
    config: { engine: 'postgres', host: 'db.internal', port: 5432, username: 'app' },
    createdAt: 1,
    updatedAt: 2,
    lastUsedAt: 3,
    ...overrides,
  } as SavedConnection;
}

describe('connection documents', () => {
  it('round-trips a connection through the file', () => {
    const result = parseConnections(serializeConnections([connection()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [imported] = result.connections;
    expect(imported?.name).toBe('Staging');
    expect(imported?.engine).toBe('postgres');
    expect(imported?.readOnly).toBe(true);
    expect(imported?.labelColor).toBe('#ff0000');
    expect(imported?.config.host).toBe('db.internal');
  });

  it('carries the secrets it was given, and says so in the note', () => {
    // The document is how a connection moves to another machine, and one that
    // arrives needing the password remembered is half a move.
    const json = serializeConnections([connection()], {
      [connection().id]: { password: 'hunter2', sshPassphrase: 'open sesame' },
    });

    const document = JSON.parse(json) as {
      note: string;
      connections: { secrets?: Record<string, string> }[];
    };
    expect(document.connections[0]?.secrets).toEqual({
      password: 'hunter2',
      sshPassphrase: 'open sesame',
    });

    // Said in the file itself, because this is the artefact people attach to a
    // ticket without opening it.
    expect(document.note).toContain('plain text');

    const result = parseConnections(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.connections[0]?.rememberSecrets).toBe(true);
      expect(result.connections[0]?.secrets?.['password']).toBe('hunter2');
    }
  });

  it('writes no secrets field when it was given none', () => {
    const json = serializeConnections([connection()]);
    const document = JSON.parse(json) as {
      note: string;
      connections: { secrets?: unknown }[];
    };

    // Absent rather than empty: `secrets: {}` would claim the export carried
    // credentials when it carried nothing.
    expect(document.connections[0]?.secrets).toBeUndefined();
    expect(document.note).toContain('No passwords');

    const result = parseConnections(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.connections[0]?.rememberSecrets).toBe(false);
  });

  it('never lets the old in-config password through', () => {
    // The saved shape has carried a `config.password` in the past. It is the
    // keyring's to hold, and a copy of it in `config` would be a second one
    // nothing knows about.
    const withSecret = connection({
      config: { engine: 'postgres', host: 'h', password: 'hunter2' },
    } as Partial<SavedConnection>);

    const document = JSON.parse(serializeConnections([withSecret])) as {
      connections: { config: Record<string, unknown> }[];
    };
    expect(document.connections[0]?.config['password']).toBeUndefined();
  });

  it('refuses a secret that is not text', () => {
    // A hand-edited file. A number here would reach the keyring stringified
    // and fail at connect time rather than at import time.
    const result = parseConnections(
      JSON.stringify({
        connections: [
          {
            name: 'Staging',
            engine: 'postgres',
            config: { engine: 'postgres', host: 'db.internal' },
            secrets: { password: 42 },
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('non-text secret');
  });

  it('names the entry that is wrong rather than failing anonymously', () => {
    const result = parseConnections(
      JSON.stringify({ connections: [connection(), { name: 'x', engine: 'oracle' }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('connections[1]');
  });

  it('accepts a bare array, which is what a pasted fragment is', () => {
    const document = JSON.parse(serializeConnections([connection()])) as {
      connections: unknown[];
    };
    const result = parseConnections(JSON.stringify(document.connections));
    expect(result.ok).toBe(true);
  });

  it('rejects a document that is not one', () => {
    expect(parseConnections('{').ok).toBe(false);
    expect(parseConnections('{"kind":"other"}').ok).toBe(false);
    expect(parseConnections('{"connections":[]}').ok).toBe(false);
  });

  it('declares what it is, so a reader knows before parsing it', () => {
    const document = JSON.parse(serializeConnections([connection()])) as { kind: string };
    expect(document.kind).toBe(CONNECTION_DOCUMENT_KIND);
  });
});

const state: SettingsState = {
  appearance: {
    mode: 'system',
    density: 'default',
    accent: { l: 0.6, c: 0.15, h: 250 },
    opacity: 0.9,
    syntax: { light: 'monokaiPro', dark: 'monokaiPro', sync: true },
  },
  preferences: {
    pageSize: 100,
    maxRows: 50_000,
    editTrigger: 'dblclick',
    wrapLines: true,
    language: 'system',
  },
  keymap: { 'tab.new': ['mod+shift+n'] },
};

describe('settings documents', () => {
  it('round-trips without changing anything', () => {
    const result = parseSettings(serializeSettings(state), state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(state);
  });

  it('takes a value the interface could also have produced', () => {
    const result = parseSettings(
      JSON.stringify({ appearance: { mode: 'dark' }, preferences: { pageSize: 250 } }),
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appearance.mode).toBe('dark');
    expect(result.state.preferences['pageSize']).toBe(250);
    // Untouched keys keep what they had, so a partial document is a patch.
    expect(result.state.preferences['maxRows']).toBe(50_000);
  });

  it('refuses a value no control could produce', () => {
    const result = parseSettings(
      JSON.stringify({ appearance: { density: 'enormous', mode: 7 } }),
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appearance.density).toBe('default');
    expect(result.state.appearance.mode).toBe('system');
  });

  it('clamps a number instead of rejecting the file over it', () => {
    const result = parseSettings(JSON.stringify({ preferences: { pageSize: 99_999 } }), state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.preferences['pageSize']).toBe(1000);
  });

  it('ignores keys it has never heard of', () => {
    // A document written by a later version must still import, or settings
    // become the thing that stops you moving between builds.
    const result = parseSettings(JSON.stringify({ preferences: { fromTheFuture: 1 } }), state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.preferences['fromTheFuture']).toBeUndefined();
  });

  it('takes the accent whole or not at all', () => {
    const partial = parseSettings(
      JSON.stringify({ appearance: { accent: { l: 0.4 } } }),
      state
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.state.appearance.accent).toEqual(state.appearance.accent);

    const whole = parseSettings(
      JSON.stringify({ appearance: { accent: { l: 0.5, c: 0.2, h: 30 } } }),
      state
    );
    expect(whole.ok).toBe(true);
    if (whole.ok) expect(whole.state.appearance.accent).toEqual({ l: 0.5, c: 0.2, h: 30 });
  });

  it('says why, when it is not a document at all', () => {
    expect(parseSettings('nonsense', state).ok).toBe(false);
    expect(parseSettings('[]', state).ok).toBe(false);
  });
});

/*
 * The two newest configurable things, and the reason they are here.
 *
 * A document that quietly drops half the state is worse than one that refuses
 * to load: the reader exports "my settings", moves machine, imports, and finds
 * their palette and their shortcuts back at the defaults with nothing saying
 * so.
 */
describe('the colour scheme and the keymap travel with the rest', () => {
  it('carries both through a round trip', () => {
    const result = parseSettings(serializeSettings(state), state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appearance.syntax).toEqual(state.appearance.syntax);
    expect(result.state.keymap).toEqual(state.keymap);
  });

  it('falls back on a scheme that no longer exists', () => {
    // A keymap outlives the build it was written in, and so does a palette.
    const result = parseSettings(
      JSON.stringify({ appearance: { syntax: { light: 'vaporwave', sync: false } } }),
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appearance.syntax.light).toBe('monokaiPro');
  });

  it('honours sync rather than leaving the interface to', () => {
    /*
     * "Synced, light: nord, dark: gruvbox" describes a state no control can
     * produce, and the flag is the one that says what was meant.
     */
    const result = parseSettings(
      JSON.stringify({
        appearance: { syntax: { light: 'nord', dark: 'gruvbox', sync: true } },
      }),
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.appearance.syntax).toEqual({
      light: 'nord',
      dark: 'nord',
      sync: true,
    });
  });

  it('spells an accelerator one way, whatever the file said', () => {
    const result = parseSettings(
      JSON.stringify({ keymap: { 'tab.close': ['Shift+Cmd+W'] } }),
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.keymap['tab.close']).toEqual(['mod+shift+w']);
  });

  it('drops a binding it cannot read rather than refusing the file', () => {
    const result = parseSettings(JSON.stringify({ keymap: { 'tab.new': ['mod+'] } }), state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.keymap['tab.new']).toBeUndefined();
  });
});
