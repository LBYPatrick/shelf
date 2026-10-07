import { beforeEach, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../../src/main/appdb/database';

const { decrypt } = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => true, decryptString: decrypt },
}));
import { createSecretStore } from '../../src/main/secrets';

beforeEach(() => {
  decrypt.mockReset();
});

it('preserves encrypted credentials when a build cannot decrypt them', () => {
  const run = vi.fn();
  const get = vi.fn(() => ({ value: Buffer.from('encrypted-test-value') }));
  const db = { exec: vi.fn(), prepare: vi.fn(() => ({ run, get })) } as unknown as AppDatabase;
  const secrets = createSecretStore(db);
  decrypt.mockImplementation(() => {
    throw new Error('Key unavailable');
  });
  expect(() => secrets.get('connection', 'password')).toThrow(
    'could not decrypt the saved credentials'
  );
  expect(run).not.toHaveBeenCalled();
  decrypt.mockReturnValue('restored-password');
  expect(secrets.get('connection', 'password')).toBe('restored-password');
});
