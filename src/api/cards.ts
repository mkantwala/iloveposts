import { Hono, type Context } from 'hono'
import { RETENTION_SECONDS, assetKey, type CardInput, type CardLogs, type CardView } from '../card/job'
import { CARD_FORMATS, DEFAULT_FORMAT, cardFormat, isFormatId } from '../card/formats'
import { viewerHtml } from '../card/viewer'
import { TweetUrlError, parseTweetUrl } from '../twitter/tweet'
import { scopeFor } from '../scope'
import { takeCardQuota } from './quota'
import { configurationProblems } from '../health'

/**
 * The card API — asynchronous jobs.
 *
 *   POST /v1/cards                 { url, format?, instructions?, motion? } → 202 { id, status }
 *   GET  /v1/cards/:id             status, design, quality, usage, and asset links once exported
 *   GET  /v1/cards/:id/logs        ?after=N — the live build log, and the job's status and stage
 *   GET  /v1/cards/:id/preview     the card in a fitting, sandboxed viewer
 *   GET  /v1/cards/:id/html        the card as one self-contained HTML file
 *   GET  /v1/cards/:id/png         the card as a PNG at the format's exact size
 *
 * A build takes minutes, so creating a card returns immediately and the client polls. An
 * Idempotency-Key header makes a retried POST return the job it already created instead of
 * starting — and paying for — a second one.
 */

type Ctx = Context<{ Bindings: Env }>

const ID = /^card_[a-z0-9]{20}$/
const MAX_INSTRUCTIONS = 500
const IDEMPOTENCY_TTL = 24 * 60 * 60

export const cards = new Hono<{ Bindings: Env }>()

const fail = (c: Ctx, status: 400 | 404 | 409 | 429 | 500 | 503, code: string, message: string) => c.json({ error: { code, message } }, status)

/**
 * Burst protection for every /v1/cards request, per caller, via the Rate Limiting binding —
 * cheap, and enough for reads. Creation is additionally held to exact hourly, daily and global
 * quotas in ./quota.ts.
 */
cards.use('*', async (c, next) => {
  const scope = await scopeFor(c.req.raw)
  const { success } = await c.env.API_RATE_LIMITER.limit({ key: scope })
  if (!success) {
    c.header('retry-after', '60')
    return fail(c, 429, 'rate_limited', 'Too many requests — slow down and try again in a minute.')
  }
  await next()
})

cards.post('/', async (c) => {
  // Refuse up front rather than create a job that would fail minutes later.
  const problems = configurationProblems(c.env)
  if (problems.length) {
    console.error('cards: not configured —', problems.join('; '))
    return fail(c, 503, 'service_misconfigured', 'This deployment is not configured to build cards. Check /health.')
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return fail(c, 400, 'invalid_body', 'Send a JSON object: { "url": "https://x.com/…/status/…" }.')

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  try {
    const ref = parseTweetUrl(url)
    if (!/^https:\/\/(x|twitter)\.com\//i.test(url)) throw new TweetUrlError('Use an https://x.com/{handle}/status/{id} link.')
    void ref
  } catch (err) {
    return fail(c, 400, 'invalid_url', err instanceof Error ? err.message : 'Invalid tweet URL.')
  }

  const format = body.format ?? DEFAULT_FORMAT
  if (!isFormatId(format)) return fail(c, 400, 'invalid_format', `format must be one of: ${Object.keys(CARD_FORMATS).join(', ')}.`)


  const instructions = body.instructions ?? ''
  if (typeof instructions !== 'string' || instructions.length > MAX_INSTRUCTIONS) {
    return fail(c, 400, 'invalid_instructions', `instructions must be a string of at most ${MAX_INSTRUCTIONS} characters.`)
  }

  const motion = body.motion ?? false
  if (typeof motion !== 'boolean') return fail(c, 400, 'invalid_motion', 'motion must be true or false.')

  const scope = await scopeFor(c.req.raw)
  const cache = c.env.CARD_CACHE

  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (idempotencyKey && !/^[\w.:-]{8,128}$/.test(idempotencyKey)) {
    return fail(c, 400, 'invalid_idempotency_key', 'Idempotency-Key must be 8–128 characters of letters, digits, _ . : -')
  }
  const idemKey = idempotencyKey ? `cards:idem:${scope}:${idempotencyKey}` : null
  if (idemKey) {
    const existing = await cache.get(idemKey)
    if (existing) return c.json(await withAssets(c, existing, await stub(c.env, existing).snapshot()), 200)
  }

  const quota = await takeCardQuota(c.env, scope)
  if (!quota.ok) {
    c.header('retry-after', String(quota.retryAfter ?? 3600))
    const message =
      quota.rule === 'global-per-day'
        ? 'Today\'s card capacity has been reached. Try again tomorrow.'
        : `Limit reached — ${quota.limit} card${quota.limit === 1 ? '' : 's'} ${quota.rule === 'per-hour' ? 'per hour' : 'per day'}. Try again in ${Math.ceil((quota.retryAfter ?? 3600) / 60)} minutes.`
    return fail(c, 429, quota.rule === 'global-per-day' ? 'capacity_reached' : 'rate_limited', message)
  }

  const id = newId()
  const input: CardInput = { url, format, instructions: instructions.trim(), motion }
  const job = await stub(c.env, id).start(id, input)
  if (idemKey) await cache.put(idemKey, id, { expirationTtl: IDEMPOTENCY_TTL })

  c.header('location', `/v1/cards/${id}`)
  return c.json(await withAssets(c, id, job), 202)
})

cards.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return fail(c, 404, 'not_found', 'No such card.')
  const job = await stub(c.env, id).snapshot()
  if (!job) return fail(c, 404, 'not_found', 'No such card.')
  c.header('cache-control', 'no-store')
  return c.json(await withAssets(c, id, job))
})

cards.get('/:id/logs', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return fail(c, 404, 'not_found', 'No such card.')
  const after = Number(c.req.query('after') ?? 0)
  const logs = await stub(c.env, id).logs(Number.isSafeInteger(after) && after >= 0 ? after : 0)
  if (!logs) return fail(c, 404, 'not_found', 'No such card.')
  c.header('cache-control', 'no-store')
  return c.json(logs)
})

cards.get('/:id/preview', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return fail(c, 404, 'not_found', 'No such card.')
  const job = await stub(c.env, id).snapshot()
  if (!job?.exported) return fail(c, 404, 'not_ready', 'This card has not been rendered yet.')
  const title = job.tweet ? `${job.tweet.author.name ?? job.tweet.author.handle} — card` : 'Card'
  return c.html(viewerHtml(cardFormat(job.format.id), `/v1/cards/${id}/html`, title), 200, { 'cache-control': 'no-store' })
})

cards.get('/:id/html', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return fail(c, 404, 'not_found', 'No such card.')
  const html = await c.env.CARD_CACHE.get(assetKey(id, 'html'))
  if (!html) return fail(c, 404, 'not_ready', 'This card has not been rendered yet.')
  return c.body(html, 200, {
    'content-type': 'text/html; charset=utf-8',
    // Model-written HTML: no network, no access to this origin, framed only by our own viewer.
    'content-security-policy':
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; frame-ancestors 'self'; sandbox allow-scripts",
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
})

cards.get('/:id/png', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return fail(c, 404, 'not_found', 'No such card.')
  const png = await c.env.CARD_CACHE.get(assetKey(id, 'png'), 'arrayBuffer')
  if (!png) return fail(c, 404, 'not_ready', 'This card has not been rendered yet.')
  return c.body(png, 200, {
    'content-type': 'image/png',
    'content-disposition': c.req.query('download') !== undefined ? `attachment; filename="${id}.png"` : 'inline',
    'cache-control': 'no-store',
  })
})

function stub(env: Env, id: string) {
  const job = env.CARD_JOBS.get(env.CARD_JOBS.idFromName(id))
  return {
    start: (jobId: string, input: CardInput) => job.start(jobId, input) as unknown as Promise<CardView>,
    snapshot: () => job.snapshot() as unknown as Promise<CardView | null>,
    logs: (after: number) => job.logs(after) as unknown as Promise<CardLogs | null>,
  }
}

/** Asset links appear once there is something behind them. */
async function withAssets<T extends { exported?: boolean } | null>(c: Ctx, id: string, job: T) {
  const origin = new URL(c.req.url).origin
  const base = `${origin}/v1/cards/${id}`
  return {
    ...job,
    assets: job?.exported ? { preview: `${base}/preview`, png: `${base}/png`, html: `${base}/html` } : null,
    retentionSeconds: RETENTION_SECONDS,
  }
}

function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return `card_${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`
}
