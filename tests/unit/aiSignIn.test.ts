import { describe, expect, it } from 'vitest';
import { cliFailure, readsAsSignedOut } from '@ai/cli';
import { AiSignInError } from '@ai/types';
import { AI_NOT_SIGNED_IN } from '@shared/ai';
import { driverInfo } from '@shared/aiDrivers';

/**
 * Telling "signed out" apart from every other way a CLI fails.
 *
 * The pre-flight check in `installed.ts` is the first line and it needs a real
 * machine to exercise; this is the second, and it is a regular expression over
 * whatever the program printed. Both directions matter and the false positive
 * is the worse one: sending somebody to a terminal to sign in to something they
 * are already signed in to wastes their time and teaches them to ignore the
 * sheet the next time it is right.
 */
describe('a CLI saying it is not signed in', () => {
  it('is recognised in the wordings both programs use', () => {
    for (const said of [
      'Not logged in. Run `codex login` to continue.',
      'Error: not authenticated',
      'Invalid API key · Please run /login',
      'Request failed: unauthorized',
      'Your OAuth token has expired.',
      'Session expired, sign in again',
      'credentials not found',
    ]) {
      expect(readsAsSignedOut(said), said).toBe(true);
    }
  });

  it('is not read into a failure that is about something else', () => {
    for (const said of [
      'Claude Code exited with 1.',
      'Error: connect ECONNREFUSED 127.0.0.1:11434',
      'The model `gpt-9` does not exist.',
      'error: unrecognized subcommand `auth`',
      'rate limit exceeded, try again in 30s',
      '',
    ]) {
      expect(readsAsSignedOut(said), said).toBe(false);
    }
  });
});

describe('a CLI failure, classified', () => {
  it('carries the code the interface branches on, and the driver to sign in to', () => {
    const error = cliFailure('codex', 'Not logged in.');

    expect(error).toBeInstanceOf(AiSignInError);
    expect((error as AiSignInError).code).toBe(AI_NOT_SIGNED_IN);
    expect((error as AiSignInError).kind).toBe('codex');
  });

  it('leaves everything else an ordinary failure', () => {
    const error = cliFailure('claudeCode', 'Claude Code exited with 1.');

    expect(error).not.toBeInstanceOf(AiSignInError);
    expect(error.message).toBe('Claude Code exited with 1.');
  });
});

/**
 * The sheet reads the command out of the catalogue, so a driver that can be
 * signed out of and has no command to offer is a sheet with an empty step in it.
 */
describe('every detected driver', () => {
  it('names the command that signs it in', () => {
    for (const kind of ['claudeCode', 'codex'] as const) {
      expect(driverInfo(kind).signInCommand, kind).toBeTruthy();
    }
  });
});
