import type { UsageEntry } from '../api/sandbox'

/**
 * The models, all on Workers AI, and the opencode agent.
 *
 *   the direct designer   one request through the Worker's AI binding (./designer.ts) — no token,
 *                         nothing leaves Cloudflare
 *   opencode              the fallback agent, in the sandbox. It reaches Workers AI over HTTP, so it
 *                         needs CF_ACCOUNT_ID and CF_API_TOKEN — and its token never enters the
 *                         container: it holds a placeholder, and ../api/sandbox.ts swaps in the real
 *                         token at egress, which is also where its tokens are counted.
 *
 * The model is configuration, not code: AGENT_MODEL in wrangler.jsonc (overridable per environment
 * or in .dev.vars), any Workers AI text-generation id.
 */

export const WORKSPACE = '/workspace'

/** What opencode is told its API key is. Deliberately useless — see ../api/sandbox.ts. */
export const PLACEHOLDER_TOKEN = 'injected-at-egress'

export interface Engine {
  name: 'opencode'
  /** The model it drives, as configured. */
  model: ModelSpec
  /** Where the engine looks for its standing brief. */
  briefFile: string
  /** Config files to write before running, as absolute paths. */
  files: Array<{ path: string; content: string }>
  /** Hosts whose requests the egress handler in ../api/sandbox.ts rewrites, and with which handler. */
  egress: Array<{ host: string; handler: 'workersAi' }>
  command(instruction: string): string
}

/** A Workers AI model, e.g. "@cf/zai-org/glm-5.3-flash". */
export interface ModelSpec {
  id: string
}

/** AGENT_MODEL, or null when it is unset or not a Workers AI id. */
export function agentModel(env: Env): ModelSpec | null {
  const value = env.AGENT_MODEL?.trim() ?? ''
  return /^@(cf|hf)\/[\w.-]+\/[\w.:-]+$/.test(value) ? { id: value } : null
}

/** The opencode agent, or why it cannot run here. */
export function selectAgent(env: Env): Engine | { error: string } {
  const model = agentModel(env)
  if (!model) return { error: 'AGENT_MODEL is not a Workers AI model id (@cf/…)' }
  const account = env.CF_ACCOUNT_ID?.trim()
  // Checked here, used only by the egress handler — the token never enters the container.
  if (!account || !env.CF_API_TOKEN?.trim()) return { error: 'CF_ACCOUNT_ID / CF_API_TOKEN are not set, so the opencode agent cannot reach Workers AI' }
  return openCode(model, {
    workersai: {
      npm: '@ai-sdk/openai-compatible',
      name: 'Cloudflare Workers AI',
      options: {
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
        // Read from the environment at run time, so it is never on the sandbox's disk.
        apiKey: '{env:AGENT_API_KEY}',
      },
      models: { [model.id]: { name: model.id, limit: { context: 131_072, output: 32_768 } } },
    },
  }, `workersai/${model.id}`, [{ host: 'api.cloudflare.com', handler: 'workersAi' }])
}

function openCode(model: ModelSpec, provider: Record<string, unknown>, modelRef: string, egress: Engine['egress']): Engine {
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider,
    model: modelRef,
    // Nobody is here to answer a prompt; without this opencode auto-rejects what it would ask about.
    permission: { '*': 'allow', bash: 'allow', edit: 'allow', external_directory: 'allow' },
  }
  return {
    name: 'opencode',
    model,
    briefFile: 'AGENTS.md',
    files: [{ path: `${WORKSPACE}/opencode.json`, content: JSON.stringify(config, null, 2) }],
    egress,
    command: (instruction) => `opencode run ${shellQuote(instruction)}`,
  }
}

/** Totals, overall and per model — one entry per model call. */
export function usageSummary(usage: UsageEntry[]) {
  const sum = (entries: UsageEntry[]) => ({
    requests: entries.length,
    promptTokens: entries.reduce((n, e) => n + e.promptTokens, 0),
    completionTokens: entries.reduce((n, e) => n + e.completionTokens, 0),
    totalTokens: entries.reduce((n, e) => n + e.totalTokens, 0),
  })
  const byModel = Object.fromEntries([...new Set(usage.map((e) => e.model))].map((m) => [m, sum(usage.filter((e) => e.model === m))]))
  return { ...sum(usage), byModel }
}

/** Single-quotes for the shell, with embedded single quotes escaped. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
