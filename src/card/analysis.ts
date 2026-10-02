import type { Tweet } from '../twitter/tweet'
import { cardExcerpt } from '../markdown/tweet'
import type { CardFormat } from './formats'

/**
 * What the tweet *is*, measured rather than guessed — the first stage after extraction.
 *
 * Everything here is counted from the parsed tweet — the excerpt that fits the format, whether the
 * opening line is a title — so the scaffold and the QA work from the same facts. None of it may
 * depend on a model.
 */
export interface ContentAnalysis {
  words: number
  characters: number
  paragraphs: number
  length: 'short' | 'medium' | 'long'
  /** The opening line reads as a title: short, no terminal punctuation, followed by more text. */
  titleLine: string | null
  excerpt: { text: string; words: number; truncated: boolean }
  media: { count: number; kinds: string[] }
  isReply: boolean
  hasQuote: boolean
  verified: boolean
  hasLinks: boolean
  hasEmoji: boolean
  metrics: { replies: number; retweets: number; likes: number; views: number | null }
  /** What the text contains, as raw material for a visual concept — see signalsMarkdown. */
  signals: string[]
}

/** Word counts at which a tweet stops being short or medium. Tuned to what fits a poster: under 25
 *  words sets large on its own; past 60 it needs the excerpt and "See more". */
const SHORT_WORDS = 25
const MEDIUM_WORDS = 60

const EMOJI = /\p{Extended_Pictographic}/u

export function analyzeContent(tweet: Tweet, format: CardFormat): ContentAnalysis {
  const text = tweet.text.trim()
  const words = countWords(text)
  const paragraphs = text ? text.split(/\n\s*\n/).filter((p) => p.trim()).length : 0
  const excerpt = cardExcerpt(text, format.excerptWords)

  const [first, ...rest] = text.split('\n')
  const titleLine =
    rest.join('').trim() && first && countWords(first) <= 8 && !/[.!?…:,;]$/.test(first.trim()) ? first.trim() : null

  const media = [...tweet.media, ...(tweet.quote?.media ?? [])]

  return {
    words,
    characters: text.length,
    paragraphs,
    length: words <= SHORT_WORDS ? 'short' : words <= MEDIUM_WORDS ? 'medium' : 'long',
    titleLine,
    excerpt: { text: excerpt.text, words: countWords(excerpt.text), truncated: excerpt.truncated },
    media: { count: media.length, kinds: [...new Set(media.map((m) => m.type))] },
    isReply: tweet.replyingTo.length > 0,
    hasQuote: tweet.quote !== null,
    verified: tweet.author.verified,
    hasLinks: /https?:\/\/\S+/.test(text),
    hasEmoji: EMOJI.test(text),
    metrics: { ...tweet.stats },
    signals: signals(tweet, text),
  }
}

/**
 * Facts about the content a designer can build a concept from — the figures it quotes, whether it
 * is technical, a question, a list, a reaction to something quoted. Counted, never interpreted:
 * what the tweet is about, and what it should look like, stays the designer's call.
 */
function signals(tweet: Tweet, text: string): string[] {
  const out: string[] = []
  const all = `${text}\n${tweet.quote?.text ?? ''}`
  const figures = [...new Set(all.match(/[$€£¥]\s?\d[\d,.]*\s?(?:[kmb]n?|million|billion|trillion)?\b|\b\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:k|m|bn|million|billion|trillion|x)\b|\b(?:19|20)\d\d\b/gi) ?? [])]
  if (figures.length) out.push(`Quotes figures: ${figures.slice(0, 5).join(', ')}`)
  const technical = all.match(/`[^`]+`|\b(?:api|sdk|cli|gpu|cpu|llm|model|token|agent|code|deploy|repo|github|python|rust|typescript|javascript|sql|kernel|compiler|latency|inference|database|server|benchmark)s?\b/gi)
  if (technical && technical.length >= 2) out.push(`Technical vocabulary: ${[...new Set(technical.map((t) => t.toLowerCase()))].slice(0, 6).join(', ')}`)
  if (/\?\s*$/.test(text)) out.push('Ends with a question')
  if (/^\s*(?:[-•*]|\d+[.)])\s+/m.test(text)) out.push('Contains a list')
  if (/!\s*$/.test(text) || /\b(?:wow|insane|incredible|huge|finally|lol|lmao)\b/i.test(text)) out.push('Exclamatory, high energy')
  const hashtags = text.match(/#\w+/g)
  if (hashtags) out.push(`Hashtags: ${hashtags.slice(0, 5).join(' ')}`)
  if (EMOJI.test(text)) out.push(`Emoji: ${[...text.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]).slice(0, 6).join(' ')}`)
  if (!text && tweet.quote) out.push('Has no text of its own: the quoted post carries it')
  else if (tweet.quote) out.push('Comments on a quoted post')
  if (tweet.replyingTo.length) out.push(`A reply to ${tweet.replyingTo.join(', ')}`)
  const media = tweet.media.length + (tweet.quote?.media.length ?? 0)
  if (media) out.push(`${media} picture${media === 1 ? '' : 's'} (attached — look at them)`)
  if (countWords(text) <= 12 && text) out.push('Very short: a few words that can be set large')
  return out
}

/** The Signals section of the brief's tweet context. */
export function signalsMarkdown(analysis: ContentAnalysis): string {
  return ['', '## Signals', '', 'Counted from the text — raw material for your concept, not instructions.', '', ...(analysis.signals.length ? analysis.signals.map((s) => `- ${s}`) : ['- Nothing notable']), ''].join('\n')
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}
