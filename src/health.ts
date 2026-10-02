import { agentModel } from './card/engines'

/**
 * What this deployment is missing, checked on every request that would depend on it.
 *
 * A Worker has no start-up hook, so configuration is validated where it matters: /health reports
 * it, and POST /v1/cards refuses with 503 rather than creating a job that would spend minutes
 * failing. Only names are reported — never a value.
 *
 * scripts/preflight.mjs checks the same things, and more, before a deploy.
 */
export function configurationProblems(env: Env): string[] {
  const problems: string[] = []

  if (!agentModel(env)) problems.push('var AGENT_MODEL is not a Workers AI model id (@cf/…)')
  const engine = (env.DESIGN_ENGINE as string | undefined) ?? ''
  if (!['direct', 'agent'].includes(engine)) problems.push('var DESIGN_ENGINE must be "direct" or "agent"')
  // The direct designer needs only the AI binding. The opencode agent reaches Workers AI over HTTP
  // and needs the account and token (injected at egress) — required when it is the engine.
  if (engine === 'agent') {
    if (!/^[0-9a-f]{32}$/.test(env.CF_ACCOUNT_ID?.trim() ?? '')) problems.push('secret CF_ACCOUNT_ID is not set to a Cloudflare account id')
    if ((env.CF_API_TOKEN?.trim().length ?? 0) < 20) problems.push('secret CF_API_TOKEN is not set')
  }
  for (const key of ['CARDS_PER_HOUR_PER_CALLER', 'CARDS_PER_DAY_PER_CALLER', 'CARDS_PER_DAY_GLOBAL'] as const) {
    const n = Number(env[key])
    if (!Number.isInteger(n) || n <= 0) problems.push(`var ${key} is not a positive whole number`)
  }

  const bindings: Array<[string, unknown]> = [
    ['AI', env.AI],
    ['BROWSER', env.BROWSER],
    ['CARD_CACHE', env.CARD_CACHE],
    ['CARD_JOBS', env.CARD_JOBS],
    ['QUOTAS', env.QUOTAS],
    ['Sandbox', env.Sandbox],
    ['API_RATE_LIMITER', env.API_RATE_LIMITER],
    ['TWEET_RATE_LIMITER', env.TWEET_RATE_LIMITER],
  ]
  for (const [name, binding] of bindings) if (!binding) problems.push(`binding ${name} is missing`)

  return problems
}
