import { DurableObject } from 'cloudflare:workers'

/**
 * Exact usage quotas for card creation — one Durable Object per key.
 *
 * A card costs minutes of container time, a browser session and several hundred thousand model
 * tokens, and the API is unauthenticated, so creation is capped three ways: per caller per hour,
 * per caller per day, and globally per day (the cost ceiling for the whole deployment). The limits
 * come from wrangler.jsonc vars, so they change without a code change.
 *
 * A Durable Object rather than KV or the Rate Limiting binding: KV counts are eventually
 * consistent (a burst races past the limit), and the binding only offers 10- or 60-second windows
 * counted per location. An object is single-threaded, so take() is exact.
 */
interface Window {
  /** The window this count belongs to, e.g. "2026-09-28T15" or "2026-09-28". */
  stamp: string
  count: number
}

export interface QuotaRule {
  name: string
  limit: number
  period: 'hour' | 'day'
}

export interface QuotaResult {
  ok: boolean
  /** The rule that refused, when one did. */
  rule?: string
  limit?: number
  /** Seconds until the refusing window resets. */
  retryAfter?: number
}

export class Quota extends DurableObject<Env> {
  /** Counts one use against every rule, or none of them if any rule is exhausted. */
  async take(rules: QuotaRule[]): Promise<QuotaResult> {
    const now = new Date()
    const windows = await Promise.all(
      rules.map(async (rule) => {
        const stamp = stampFor(rule.period, now)
        const stored = await this.ctx.storage.get<Window>(rule.name)
        return { rule, stamp, count: stored?.stamp === stamp ? stored.count : 0 }
      }),
    )

    const refused = windows.find((w) => w.count >= w.rule.limit)
    if (refused) return { ok: false, rule: refused.rule.name, limit: refused.rule.limit, retryAfter: secondsUntilReset(refused.rule.period, now) }

    await this.ctx.storage.put(Object.fromEntries(windows.map((w) => [w.rule.name, { stamp: w.stamp, count: w.count + 1 } satisfies Window])))
    return { ok: true }
  }

  /** Gives one use back — when a later check refused the request this one had counted. */
  async refund(names: string[]): Promise<void> {
    for (const name of names) {
      const stored = await this.ctx.storage.get<Window>(name)
      if (stored && stored.count > 0) await this.ctx.storage.put(name, { ...stored, count: stored.count - 1 })
    }
  }
}

function stampFor(period: QuotaRule['period'], now: Date): string {
  return now.toISOString().slice(0, period === 'hour' ? 13 : 10)
}

function secondsUntilReset(period: QuotaRule['period'], now: Date): number {
  const next = new Date(now)
  if (period === 'hour') next.setUTCMinutes(60, 0, 0)
  else next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000))
}

/** A positive whole number from a wrangler var, or the fallback. */
function limitFrom(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/**
 * Takes one card creation for `scope` (a hashed caller IP). Checks the caller first, then the
 * global ceiling, and hands the caller's use back if the ceiling refuses.
 */
export async function takeCardQuota(env: Env, scope: string): Promise<QuotaResult> {
  const caller = env.QUOTAS.get(env.QUOTAS.idFromName(`caller:${scope}`))
  const callerRules: QuotaRule[] = [
    { name: 'per-hour', limit: limitFrom(env.CARDS_PER_HOUR_PER_CALLER, 5), period: 'hour' },
    { name: 'per-day', limit: limitFrom(env.CARDS_PER_DAY_PER_CALLER, 20), period: 'day' },
  ]
  const mine = await caller.take(callerRules)
  if (!mine.ok) return mine

  const global = env.QUOTAS.get(env.QUOTAS.idFromName('global'))
  const all = await global.take([{ name: 'global-per-day', limit: limitFrom(env.CARDS_PER_DAY_GLOBAL, 200), period: 'day' }])
  if (!all.ok) await caller.refund(callerRules.map((r) => r.name))
  return all
}
