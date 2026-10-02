/**
 * The tweet record — what extraction (./fxtwitter.ts) produces and every later stage reads — plus
 * the URL parser and the verification badge.
 */

export interface TweetMedia {
  type: 'image' | 'video' | 'gif'
  /** The original pbs.twimg.com / video.twimg.com URL. */
  url: string
  /** A still frame, for video and GIF. */
  thumbnail?: string
}

export interface TweetStats {
  replies: number
  retweets: number
  likes: number
  /** Null on tweets old enough to predate view counts. */
  views: number | null
  bookmarks: number | null
  quotes: number | null
}

export interface TweetAuthor {
  /** Display name, e.g. "Andrej Karpathy". */
  name: string | null
  /** @-prefixed, as it is rendered on a card. */
  handle: string
  /** pbs.twimg.com URL, at 400×400. */
  avatar: string | null
  verified: boolean
  /** Which badge: blue, business or government. Null when unverified. */
  verifiedType: string | null
  /** The badge as an `<img src>`-ready SVG data URI, tinted for `verifiedType`. Null when
   *  unverified. See `verifiedBadge()` for why it is generated rather than scraped. */
  verifiedBadge: string | null
}

/**
 * A tweet embedded inside another one.
 *
 * Carries its own author, because a quote is very often someone else's tweet, and its own media,
 * because that is where the pictures live on a quote-tweet whose outer half is just a comment.
 */
export interface QuotedTweet {
  url: string | null
  author: TweetAuthor
  text: string
  /** ISO 8601 UTC. */
  date: string | null
  media: TweetMedia[]
}

export interface Tweet {
  id: string
  /** Canonical x.com permalink. */
  url: string
  author: TweetAuthor
  text: string
  /** ISO 8601 UTC. */
  date: string | null
  media: TweetMedia[]
  stats: TweetStats
  /** Handles this tweet is a reply to, @-prefixed. Empty when it isn't a reply. A reply's own text
   *  often makes no sense without these. */
  replyingTo: string[]
  /** The tweet this one quotes, or null. On a reply that quotes something, the outer tweet's text
   *  is frequently empty and *all* the content — text, pictures, video — is in here. */
  quote: QuotedTweet | null
}

export interface TweetRef {
  username: string
  id: string
}

const STATUS_RE = /^\/?([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/

export class TweetUrlError extends Error {}

/**
 * The handle and status id behind a tweet link.
 *
 * Accepts any host that uses the `/{handle}/status/{id}` path — x.com, twitter.com, fxtwitter and
 * the other embed mirrors — because that path is the only part worth reading. Query strings and
 * fragments are ignored.
 */
export function parseTweetUrl(input: string): TweetRef {
  const raw = input.trim()
  if (!raw) throw new TweetUrlError('Missing tweet URL')

  let path = raw
  if (raw.includes('://') || raw.includes('.')) {
    try {
      path = new URL(raw.startsWith('http') ? raw : `https://${raw}`).pathname
    } catch {
      throw new TweetUrlError(`Could not read "${input}" as a URL`)
    }
  }

  const match = path.match(STATUS_RE)
  if (!match) {
    throw new TweetUrlError(`Not a tweet URL: "${input}" — expected something like https://x.com/{handle}/status/{id}`)
  }
  return { username: match[1], id: match[2] }
}

/** X's badge colours: blue for a personal check, gold for a business, grey for a government or
 *  multilateral account. Anything unrecognised falls back to blue. */
const BADGE_COLORS: Record<string, string> = {
  blue: '#1D9BF0',
  business: '#E2B719',
  government: '#829AAB',
}

/** The badge outline, from X's own 24×24 icon: the scalloped disc plus the tick knocked out of it,
 *  as one even-odd path so the tick shows whatever is behind the badge rather than a painted
 *  white — which is how X's own badge behaves in light and dark. */
const BADGE_PATH =
  'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91c-1.31.67-2.19 1.91-2.19 3.34s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z'

/**
 * The verification badge as something that can go straight in `src=""`.
 *
 * X serves no stable standalone badge image, so the mark is generated: a self-contained data URI
 * that needs no network request during rendering and scales to whatever size the layout asks for.
 *
 * Encoded with encodeURIComponent rather than base64 so the tint stays greppable in a response,
 * and because the `#` in the colour has to be escaped to survive an HTML attribute either way.
 */
export function verifiedBadge(type: string | null): string {
  const color = BADGE_COLORS[type ?? ''] ?? BADGE_COLORS.blue
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Verified">` +
    `<path fill="${color}" fill-rule="evenodd" d="${BADGE_PATH}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
