import { Hono } from 'hono'
import { cards } from './api/cards'
import { page } from './site/page'
import { configurationProblems } from './health'
import { scopeFor } from './scope'
import { FetchError, fetchTweet } from './twitter/fxtwitter'
import { TweetUrlError, parseTweetUrl } from './twitter/tweet'
// The Sandbox subclass carries the egress handler; ContainerProxy must be exported from the
// entrypoint so the Sandbox DO can build outbound-interception fetchers that reference it.
export { Sandbox } from './api/sandbox'
export { ContainerProxy } from '@cloudflare/sandbox'
export { CardJob } from './card/job'
export { Quota } from './api/quota'

/**
 * iloveposts — a tweet URL in, a designed card out.
 *
 *   GET  /                 the landing page
 *   GET  /health
 *   GET  /tweet?url=…      the structured tweet on its own
 *   /v1/cards              the card API (./api/cards.ts)
 *
 * The pipeline behind /v1/cards lives in ./card/: extract → build → validate
 * → repair → export, run as one Durable Object per card (./card/job.ts).
 */

const app = new Hono<{ Bindings: Env }>()

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500)
})

app.get('/', (c) => c.html(page))

// Liveness plus configuration: 503, naming what is missing (never a value), when this deployment
// cannot build cards — so a monitor or a deploy check catches it before a user does.
app.get('/health', (c) => {
  const problems = configurationProblems(c.env)
  return c.json({ ok: problems.length === 0, service: 'iloveposts', timestamp: new Date().toISOString(), problems }, problems.length ? 503 : 200)
})

// One tweet URL in, the structured record out: the author (name, handle, avatar, verification badge
// as an <img>-ready data URI), the text with its line breaks intact, the date, attached media, the
// engagement counts, who it replies to, and any quoted tweet.
app.get('/tweet', async (c) => {
  // Each call is an upstream fetch, so it is held to a tighter burst limit than the card API.
  const { success } = await c.env.TWEET_RATE_LIMITER.limit({ key: await scopeFor(c.req.raw) })
  if (!success) return c.json({ ok: false, error: 'Too many requests — try again in a minute.' }, 429, { 'retry-after': '60' })

  const url = c.req.query('url')
  if (!url) {
    return c.json({ ok: false, error: 'Missing "url" query param, e.g. /tweet?url=https://x.com/karpathy/status/123' }, 400)
  }

  try {
    const tweet = await fetchTweet(parseTweetUrl(url))
    return c.json({ ok: true, tweet, source: 'fxtwitter' })
  } catch (err) {
    if (err instanceof TweetUrlError) return c.json({ ok: false, url, error: err.message }, 400)
    if (err instanceof FetchError) return c.json({ ok: false, url, error: err.message }, err.status as 404 | 502)
    throw err
  }
})

app.route('/v1/cards', cards)

export default app
