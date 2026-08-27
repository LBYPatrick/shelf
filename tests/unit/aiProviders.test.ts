import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AI_DRIVERS,
  CONFIGURABLE_DRIVERS,
  detectedDriverOf,
  detectedProvider,
  detectedProviderId,
  driverInfo,
  isDetectedProviderId,
} from '../../src/shared/aiDrivers';

/**
 * Which providers are added and which are found.
 *
 * Claude Code and Codex are programs somebody installed: they sign themselves
 * in, hold their own credentials and choose their own model, so there is
 * nothing to configure and nothing to name. Every assertion here is a way the
 * two kinds could get mixed up — a CLI offered in the add form, a detected row
 * that could be deleted, or an id that changes between launches and takes the
 * reader's choice of provider with it.
 */
describe('the driver catalogue', () => {
  it('says of every driver whether it is found or configured', () => {
    for (const driver of AI_DRIVERS) {
      expect(typeof driver.detected, driver.kind).toBe('boolean');
    }
  });

  it('offers only the configurable ones to be added', () => {
    const offered = CONFIGURABLE_DRIVERS.map((driver) => driver.kind);
    expect(offered).not.toContain('claudeCode');
    expect(offered).not.toContain('codex');
    expect(offered).toContain('anthropic');
  });

  it('does not default a new provider to a CLI', () => {
    // The add form starts on the first configurable driver, and it used to
    // start on the first of all of them — which named every new provider
    // "Claude Code" before the reader had chosen anything.
    expect(CONFIGURABLE_DRIVERS[0]?.detected).toBe(false);
  });

  it('has a key-less, url-less shape for the ones it detects', () => {
    for (const driver of AI_DRIVERS.filter((candidate) => candidate.detected)) {
      expect(driver.acceptsKey, driver.kind).toBe(false);
      expect(driver.baseUrlEditable, driver.kind).toBe(false);
    }
  });
});

describe('a detected provider', () => {
  it('comes back the same across launches', () => {
    // Derived, not random: the preferred-provider setting stores an id, so an
    // id that changed on every launch would forget the choice every launch.
    expect(detectedProviderId('claudeCode')).toBe(detectedProviderId('claudeCode'));
    expect(detectedProviderId('claudeCode')).not.toBe(detectedProviderId('codex'));
  });

  it('is named after its driver and has no key of its own', () => {
    const provider = detectedProvider('claudeCode');
    expect(provider.name).toBe(driverInfo('claudeCode').label);
    expect(provider.model).toBe(driverInfo('claudeCode').defaultModel);
    expect(provider.driver).toBe('claudeCode');
  });

  it('is told apart from a stored one by its id alone', () => {
    expect(isDetectedProviderId(detectedProviderId('codex'))).toBe(true);
    expect(detectedDriverOf(detectedProviderId('codex'))).toBe('codex');

    // What a stored provider's id looks like: a UUID from the application
    // database, which must never be mistaken for one of these.
    expect(isDetectedProviderId('3f1a6c2e-9b74-4a0f-8f2b-1d4c5e6a7b8c')).toBe(false);
    expect(detectedDriverOf('3f1a6c2e-9b74-4a0f-8f2b-1d4c5e6a7b8c')).toBeNull();
    expect(isDetectedProviderId('cli:nonesuch')).toBe(false);
  });
});

/**
 * The marks in front of the providers.
 *
 * Every row used to be the same sparkle, which said "assistant" in a list of
 * nothing but assistants — where the one fact a reader wants is which company
 * is about to be sent their question.
 */
describe('the provider marks', () => {
  it('draws a real mark for every driver that is one company', async () => {
    const source = await readFile(
      new URL('../../src/renderer/components/assistant/ProviderMark.vue', import.meta.url),
      'utf8'
    );

    for (const driver of AI_DRIVERS) {
      if (driver.kind === 'openaiCompatible') continue;
      expect(source, `${driver.kind} has no mark`).toContain(`${driver.kind}:`);
    }
  });

  it('leaves the generic driver generic', () => {
    // One driver for Ollama, LM Studio, vLLM and OpenRouter: any one mark there
    // would name the wrong company most of the time.
    expect(driverInfo('openaiCompatible').detected).toBe(false);
  });
});
