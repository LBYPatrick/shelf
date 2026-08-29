import type { AiDriverKind, AiProvider } from '@shared/ai';
import { AnthropicDriver, BedrockDriver } from './drivers/anthropic';
import { ClaudeCodeDriver } from './drivers/claudeCode';
import { CodexDriver } from './drivers/codex';
import { GrokDriver } from './drivers/grok';
import { GoogleDriver } from './drivers/google';
import { AzureDriver, OpenAiCompatibleDriver, OpenAiDriver } from './drivers/openai';
import { AiError, type AiAdapter, type AiDriver } from './types';

/**
 * Every driver this build knows how to instantiate.
 *
 * The counterpart of `AI_DRIVERS` in shared: that one is what the interface can
 * *offer*, this one is what the host can *build*. They are separate because
 * they are read in separate processes and one of them must never reach the
 * renderer — but they name the same set, and a mismatch is a menu item that
 * fails when chosen, so the registry checks itself against the catalogue at
 * startup rather than at first use.
 */
const DRIVERS: readonly AiDriver[] = [
  ClaudeCodeDriver,
  CodexDriver,
  GrokDriver,
  AnthropicDriver,
  OpenAiDriver,
  GoogleDriver,
  BedrockDriver,
  AzureDriver,
  OpenAiCompatibleDriver,
];

const BY_KIND = new Map<AiDriverKind, AiDriver>(DRIVERS.map((driver) => [driver.kind, driver]));

export function createAiAdapter(instance: AiProvider, apiKey: string | undefined): AiAdapter {
  const driver = BY_KIND.get(instance.driver);
  if (!driver) {
    /*
     * Reachable in practice, not only in theory: a provider configured by a
     * newer build, or by a fork, survives in the settings of an older one. It
     * is reported as this instance being unavailable rather than crashing the
     * host, which is the same courtesy the sibling project extends to a driver
     * it does not recognise.
     */
    throw new AiError(
      `“${instance.name}” uses a provider this build does not have: ${instance.driver}. ` +
        'If the app was just updated, restart it — the process that talks to providers is ' +
        'started once and keeps whichever drivers it was built with.'
    );
  }
  return driver.create(instance, apiKey);
}

export function aiDriverKinds(): readonly AiDriverKind[] {
  return DRIVERS.map((driver) => driver.kind);
}
