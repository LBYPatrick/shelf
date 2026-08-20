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

  it('never writes a password, whatever the connection is carrying', () => {
    // The whole posture of the app is that the renderer does not hold secrets,
    // but a document is the one artefact that leaves the machine — so this is
    // asserted rather than assumed.
    const withSecret = connection({
      config: { engine: 'postgres', host: 'h', password: 'hunter2' },
    } as Partial<SavedConnection>);

    const json = serializeConnections([withSecret]);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('password');

    const result = parseConnections(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.connections[0]?.rememberSecrets).toBe(false);
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
  },
  preferences: {
    pageSize: 100,
    maxRows: 50_000,
    editTrigger: 'dblclick',
    wrapLines: true,
    language: 'system',
  },
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
