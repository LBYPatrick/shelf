/**
 * The drivers the assistant ships with, as one declaration.
 *
 * The picker and the adapter registry read the same rows, for the same reason
 * `engines.ts` exists: a provider added to the host but not to the list is a
 * provider nobody can configure, and a row in the list with no adapter behind
 * it is a menu item that fails when chosen. Both are the kind of mistake that
 * only shows up when someone tries it.
 *
 * `models` is a list of suggestions, never a closed set. A provider ships new
 * model names faster than a desktop app ships releases, and an app that refuses
 * a name it has not heard of is an app that stops working on a Tuesday. The
 * field is free text; these are what the field offers before it is typed in.
 */

import type { AiCapabilities, AiDriverKind, AiProvider } from './ai';

export interface AiDriverInfo {
  readonly kind: AiDriverKind;
  /** The provider's own name for itself, so it is recognisable in a list. */
  readonly label: string;
  readonly defaultBaseUrl: string;
  /** Whether the base URL is a thing the reader is expected to set. */
  readonly baseUrlEditable: boolean;
  readonly needsKey: boolean;
  /**
   * Whether a key is a thing this driver has at all.
   *
   * Distinct from `needsKey`, which is about whether one is *required*: a local
   * server accepts a key and rarely wants one, while Claude Code signs itself
   * in and has nowhere to put one. A field for a value that can never be used
   * is a question the reader has to decide how to answer.
   */
  readonly acceptsKey: boolean;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly capabilities: AiCapabilities;
  /** Where the reader goes to get a key, shown beside the field. */
  readonly keyUrl?: string;
  /**
   * Whether this driver is found on the machine rather than configured.
   *
   * Claude Code and Codex are programs somebody installed. They sign themselves
   * in, hold their own credentials and pick their own model, so there is
   * nothing to fill in and nothing to name — and a name is worse than nothing,
   * because "my Claude Code" and "Claude Code" would be two rows for one
   * program that can only ever behave one way. They are detected on launch and
   * offered when present; the rest are added, named and keyed by hand.
   */
  readonly detected: boolean;
  /**
   * The command somebody runs in a terminal to sign this provider in.
   *
   * Only the detected CLIs have one, and it is here rather than in the sheet
   * that shows it for the same reason every other per-driver fact is: a sheet
   * with a `switch` in it is a second catalogue, and the two go out of step the
   * first time a CLI renames a subcommand.
   */
  readonly signInCommand?: string;
  /**
   * What the base-URL field actually holds for this driver.
   *
   * Three answers, because three things get typed into one box.
   *
   * `url` is the ordinary case: optional, and blank means the provider's own.
   * `region` is Bedrock, which needs an AWS region — SigV4 signs for one, and a
   * request signed for the wrong region is refused before it is read; asking
   * for it in a field labelled "Address" would be the interface lying about
   * what it wants. `resource` is Azure, where the address is a URL and is
   * *required*: an Azure endpoint is per-account, so there is no default that
   * could stand in and the placeholder is an example rather than a fallback.
   *
   * Declared here so the form relabels itself rather than carrying a `switch`
   * on the driver kind.
   */
  readonly baseUrlAs?: 'url' | 'region' | 'resource';
  /**
   * Whether `model` names a model or a deployment of one.
   *
   * Azure is the only one where it is a deployment: a name somebody gave a
   * model they turned on in their own resource, which no list here could
   * predict. The field is the same field; what it is asking for is not, and the
   * help under it has to say which.
   */
  readonly modelAs?: 'model' | 'deployment';
  /**
   * Where the credential comes from, when it does not come from this form.
   *
   * Only for a driver that accepts no key. Claude Code and Codex sign
   * themselves in; Bedrock reads the machine's AWS credentials. Either way the
   * form has nothing to show and somebody still has to be told why.
   */
  readonly credentialsNote?: 'cli' | 'aws';
}

const FULL: AiCapabilities = { streaming: true, tools: true, system: true };

export const AI_DRIVERS: readonly AiDriverInfo[] = [
  {
    /*
     * First in the list because it is first in effort: someone who already has
     * Claude Code on this machine is already signed in, and choosing this row
     * is the whole of setting the assistant up. Every other row starts with a
     * trip to a website to create a key.
     *
     * It runs the read-only tools like every other provider, over a loopback
     * MCP endpoint that lives for one turn — see `drivers/claudeCode.ts`.
     */
    kind: 'claudeCode',
    detected: true,
    label: 'Claude Code',
    defaultBaseUrl: '',
    baseUrlEditable: false,
    needsKey: false,
    acceptsKey: false,
    defaultModel: 'default',
    models: ['default', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    capabilities: FULL,
    signInCommand: 'claude auth login',
    credentialsNote: 'cli',
  },
  {
    /*
     * Codex, run as a subprocess. It signs itself in, so there is no key to
     * hold and nowhere to put one.
     *
     * `system: false` is the one real difference from Claude Code: the CLI has
     * no flag that replaces the system prompt, so the composed instructions
     * ride at the head of the message instead. Declared rather than discovered
     * — the same rule the database drivers follow.
     */
    kind: 'codex',
    detected: true,
    label: 'Codex',
    defaultBaseUrl: '',
    baseUrlEditable: false,
    needsKey: false,
    acceptsKey: false,
    defaultModel: 'default',
    models: ['default', 'gpt-5-codex', 'gpt-5', 'o3'],
    capabilities: { streaming: true, tools: true, system: false },
    signInCommand: 'codex login',
    credentialsNote: 'cli',
  },
  {
    kind: 'anthropic',
    detected: false,
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEditable: true,
    needsKey: true,
    acceptsKey: true,
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    capabilities: FULL,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    kind: 'openai',
    detected: false,
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: true,
    needsKey: true,
    acceptsKey: true,
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    capabilities: FULL,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    kind: 'google',
    detected: false,
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    baseUrlEditable: true,
    needsKey: true,
    acceptsKey: true,
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    capabilities: FULL,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    /*
     * The same Claude models, billed through an AWS account.
     *
     * A driver rather than a base URL on the Anthropic row, because the
     * difference is the credential: Bedrock signs with AWS keys instead of
     * carrying one, and the SDK reads those from wherever the machine already
     * keeps them. So this is the second provider in the list that asks for no
     * key at all — and, like the two CLIs, the reason is that the reader has
     * already set it up somewhere this app has no business duplicating.
     *
     * The model ids are Bedrock's own, which are not Anthropic's: they carry a
     * vendor prefix, a version suffix, and for the current models a region
     * prefix naming an inference profile. The list is a starting point, as
     * every list here is — the field takes whatever the account actually has.
     */
    kind: 'bedrock',
    detected: false,
    label: 'AWS Bedrock',
    defaultBaseUrl: 'us-east-1',
    baseUrlEditable: true,
    baseUrlAs: 'region',
    needsKey: false,
    acceptsKey: false,
    defaultModel: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    models: [
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
    ],
    capabilities: FULL,
    credentialsNote: 'aws',
  },
  {
    /*
     * OpenAI's models in somebody's own Azure resource.
     *
     * Azure's answer to Bedrock, and it differs from OpenAI in two ways a base
     * URL cannot express: the deployment goes in the path and the key goes in
     * `api-key` rather than in `Authorization`. Hence a driver rather than a
     * row of `openaiCompatible`.
     *
     * `model` is the *deployment name* — whatever the account called the model
     * it turned on — so there is no model list worth offering. The suggestions
     * are the names people most often give a deployment, which is a guess at a
     * convention rather than a fact about an API.
     */
    kind: 'azure',
    detected: false,
    label: 'Azure AI Foundry',
    defaultBaseUrl: 'https://your-resource.openai.azure.com',
    baseUrlEditable: true,
    baseUrlAs: 'resource',
    needsKey: true,
    acceptsKey: true,
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    modelAs: 'deployment',
    capabilities: FULL,
    keyUrl: 'https://ai.azure.com/',
  },
  {
    /*
     * One driver for every server that speaks OpenAI's chat protocol, which by
     * now is most of them — Ollama, LM Studio, vLLM, OpenRouter, a gateway on
     * the company network. The difference between them is a URL, and a
     * separate driver per vendor would be the same file copied with the URL
     * changed and the maintenance multiplied.
     */
    kind: 'openaiCompatible',
    detected: false,
    label: 'OpenAI-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    // A local model has no key, and a gateway usually does. Asking for one and
    // accepting nothing is the shape that covers both.
    needsKey: false,
    acceptsKey: true,
    defaultModel: 'qwen2.5-coder',
    models: ['qwen2.5-coder', 'llama3.1', 'mistral'],
    capabilities: FULL,
  },
];

/** The drivers a reader adds, names and gives a key. Never the detected ones. */
export const CONFIGURABLE_DRIVERS: readonly AiDriverInfo[] = AI_DRIVERS.filter(
  (driver) => !driver.detected
);

/**
 * The id a detected provider goes by.
 *
 * Prefixed rather than random because it is not stored anywhere: it is derived
 * from the driver every time the machine is looked at, and the same CLI has to
 * come back as the same provider across launches or the preferred-provider
 * setting would forget which one was chosen every time the app started.
 */
export function detectedProviderId(kind: AiDriverKind): string {
  return `cli:${kind}`;
}

export function isDetectedProviderId(id: string): boolean {
  return detectedDriverOf(id) !== null;
}

/** The driver behind a detected id, or `null` if this is a stored provider. */
export function detectedDriverOf(id: string): AiDriverKind | null {
  const found = AI_DRIVERS.find(
    (driver) => driver.detected && detectedProviderId(driver.kind) === id
  );
  return found ? found.kind : null;
}

/**
 * The provider record for a detected CLI.
 *
 * Made rather than read. There is no row in the application database for these
 * and there should not be: the machine is the record, so a stored copy could
 * only go stale — still listing Codex on a machine it was removed from. The
 * model is the driver's default, which for both CLIs means "whatever the CLI
 * itself is set to use".
 */
export function detectedProvider(kind: AiDriverKind): AiProvider {
  const info = driverInfo(kind);
  return {
    id: detectedProviderId(kind),
    name: info.label,
    driver: kind,
    model: info.defaultModel,
    createdAt: 0,
  };
}

export function driverInfo(kind: AiDriverKind): AiDriverInfo {
  const found = AI_DRIVERS.find((driver) => driver.kind === kind);
  if (!found) throw new Error(`Unknown assistant driver: ${kind}`);
  return found;
}

/** The base URL an instance actually reaches, given what it did or did not set. */
export function resolveBaseUrl(kind: AiDriverKind, baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  const resolved = trimmed && trimmed.length > 0 ? trimmed : driverInfo(kind).defaultBaseUrl;
  return resolved.replace(/\/+$/, '');
}
