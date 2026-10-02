import { verifiedBadge, type QuotedTweet, type Tweet, type TweetAuthor, type TweetMedia, type TweetRef } from './tweet'

/**
 * Getting a tweet: one GET to the FxTwitter API, which returns it as structured JSON — author,
 * verification, text with its line breaks, date, media, every count, the reply target and any
 * quoted tweet. It is mapped field for field onto the Tweet record; nothing is scraped or guessed.
 *
 * Addressed by status id alone (/status/{id}): a wrong handle in the link does not matter, and a
 * missing tweet comes back as a JSON 404 rather than an HTML page.
 */

const API = 'https://api.fxtwitter.com'
const TIMEOUT_MS = 15_000
const USER_AGENT = 'iloveposts/1.0 (tweet card generator)'

/** Carries the HTTP status the caller should answer with. */
export class FetchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function fetchTweet(ref: TweetRef): Promise<Tweet> {
  let response: Response
  try {
    response = await fetch(`${API}/status/${ref.id}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new FetchError(502, `FxTwitter did not answer: ${err instanceof Error ? err.message : String(err)}`)
  }

  const body = (await response.json().catch(() => null)) as { code?: number; message?: string; tweet?: FxTweet | null } | null
  if (response.status === 404 || body?.code === 404) throw new FetchError(404, `Tweet ${ref.id} not found — it may be deleted, private or from a suspended account`)
  if (!response.ok || !body?.tweet) throw new FetchError(502, `FxTwitter returned ${response.status}${body?.message ? ` (${body.message})` : ''}`)

  const t = body.tweet
  const shown = displayed(t)
  return {
    id: t.id,
    url: t.url ?? `https://x.com/${t.author.screen_name}/status/${t.id}`,
    author: author(t.author),
    text: shown.text,
    date: date(t.created_timestamp),
    media: media(t.media),
    stats: {
      replies: t.replies ?? 0,
      retweets: t.retweets ?? 0,
      likes: t.likes ?? 0,
      views: t.views ?? null,
      bookmarks: t.bookmarks ?? null,
      quotes: t.quotes ?? null,
    },
    replyingTo: shown.replyingTo,
    quote: t.quote ? quote(t.quote) : null,
  }
}

/**
 * The text as X shows it. A reply's leading @mentions are not part of the displayed text — X shows
 * them as "Replying to …" — and neither is the link to a quoted tweet, which is shown as the quote.
 * raw_text.display_text_range says where the displayed text starts; its mention facets name who is
 * being replied to.
 */
function displayed(t: FxTweet): { text: string; replyingTo: string[] } {
  let text = t.text ?? ''
  const start = t.raw_text?.display_text_range?.[0] ?? 0
  const hidden = (t.raw_text?.facets ?? [])
    .filter((f) => f.type === 'mention' && f.original && f.indices[1] <= start)
    .map((f) => `@${f.original}`)
  // The same mentions lead the expanded text: removed one by one, and only while they match.
  for (const handle of hidden) {
    const lead = text.match(/^\s*(@\w+)\s*/)
    if (!lead || lead[1].toLowerCase() !== handle.toLowerCase()) break
    text = text.slice(lead[0].length)
  }
  if (t.quote?.id) text = text.replace(new RegExp(`\\s*https?://(?:www\\.)?(?:x|twitter)\\.com/\\w+/status/${t.quote.id}\\S*\\s*$`, 'i'), '')
  return { text: text.trim(), replyingTo: hidden.length ? hidden : t.replying_to ? [`@${t.replying_to}`] : [] }
}

function author(a: FxAuthor): TweetAuthor {
  const verified = a.verification?.verified === true
  // FxTwitter says "individual" / "business" / "government"; the badge speaks blue / business / government.
  const type = verified ? (a.verification?.type === 'business' || a.verification?.type === 'government' ? a.verification.type : 'blue') : null
  return {
    name: a.name ?? null,
    handle: `@${a.screen_name}`,
    // The API hands out the 200px avatar; the same file exists at 400px, which is what a card needs.
    avatar: a.avatar_url ? a.avatar_url.replace(/_(normal|bigger|200x200)(\.\w+)$/, '_400x400$2') : null,
    verified,
    verifiedType: type,
    verifiedBadge: verified ? verifiedBadge(type) : null,
  }
}

function media(m: FxTweet['media']): TweetMedia[] {
  return (m?.all ?? []).flatMap((item): TweetMedia[] => {
    if (!item.url) return []
    if (item.type === 'photo') return [{ type: 'image', url: item.url }]
    const kind = item.type === 'gif' ? 'gif' : 'video'
    return [{ type: kind, url: item.url, ...(item.thumbnail_url ? { thumbnail: item.thumbnail_url } : {}) }]
  })
}

function quote(q: FxTweet): QuotedTweet {
  return {
    url: q.url ?? null,
    author: author(q.author),
    text: q.text ?? '',
    date: date(q.created_timestamp),
    media: media(q.media),
  }
}

function date(seconds: number | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

/** The parts of FxTwitter's response this reads. */
interface FxAuthor {
  screen_name: string
  name?: string
  avatar_url?: string
  verification?: { verified?: boolean; type?: string }
}

interface FxTweet {
  id: string
  url?: string
  text?: string
  raw_text?: { display_text_range?: [number, number]; facets?: Array<{ type: string; indices: [number, number]; original?: string }> }
  author: FxAuthor
  created_timestamp?: number
  replies?: number
  retweets?: number
  likes?: number
  views?: number | null
  bookmarks?: number | null
  quotes?: number | null
  replying_to?: string | null
  media?: { all?: Array<{ type: string; url?: string; thumbnail_url?: string }> }
  quote?: FxTweet
}
