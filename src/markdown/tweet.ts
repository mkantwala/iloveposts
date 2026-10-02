import type { Tweet } from '../twitter/tweet'

/**
 * The tweet as Markdown, for the agent to read as context/tweet.md.
 *
 * Every value is taken from the parsed tweet — nothing here is written by a model, which is what
 * keeps the words and numbers on the finished card true. Anything the source did not give is
 * rendered as "Unknown" rather than guessed, so a missing field reads as missing instead of
 * quietly becoming a plausible-looking number.
 *
 * There is no bookmarks row: the extraction source has no bookmark count, and an "Unknown" row
 * was being put on cards as-is. The labels match the ones the card is required to use, so the
 * agent never has to translate "Reposts" into "Retweets".
 *
 * The "Card excerpt" is cut here, deterministically, rather than left to the agent: asked to cut a
 * long tweet itself, a small model keeps far too much and stops mid-thought.
 */
export function tweetToMarkdown(tweet: Tweet, excerptWords: number = DEFAULT_EXCERPT_WORDS): string {
  const excerpt = cardExcerpt(tweet.text, excerptWords)
  const sections = [
    '# Tweet',
    '',
    '## Author',
    '',
    `Name: ${tweet.author.name ?? 'Unknown'}`,
    '',
    `Username: ${tweet.author.handle}`,
    '',
    `Verified: ${tweet.author.verified ? `yes${tweet.author.verifiedType ? ` (${tweet.author.verifiedType})` : ''}` : 'no'}`,
    '',
    '## Card excerpt',
    '',
    excerpt.text || '(no text of its own)',
    '',
    excerpt.truncated ? 'Truncated: yes — the card needs See more (see AGENTS.md).' : 'Truncated: no — this is the whole tweet.',
    '',
    '## Full text',
    '',
    tweet.text || '(no text of its own)',
    '',
    '## Created',
    '',
    tweet.date ?? 'Unknown',
    '',
    '## Metrics',
    '',
    `Replies: ${count(tweet.stats.replies)}`,
    '',
    `Retweets: ${count(tweet.stats.retweets)}`,
    '',
    `Likes: ${count(tweet.stats.likes)}`,
    '',
    `Views: ${count(tweet.stats.views)}`,
  ]

  if (tweet.replyingTo.length > 0) {
    sections.push('', '## Replying to', '', tweet.replyingTo.join(' '))
  }

  sections.push(
    '',
    '## Media',
    '',
    ...(tweet.media.length > 0 ? tweet.media.map((m) => `- ${m.type}: ${m.url}`) : ['No media']),
  )

  if (tweet.quote) {
    sections.push(
      '',
      '## Quoted tweet',
      '',
      `Name: ${tweet.quote.author.name ?? 'Unknown'}`,
      '',
      `Username: ${tweet.quote.author.handle}`,
      '',
      tweet.quote.text || '(no text)',
    )
    if (tweet.quote.media.length > 0) {
      sections.push('', 'Quoted media:', '', ...tweet.quote.media.map((m) => `- ${m.type}: ${m.url}`))
    }
  }

  return `${sections.join('\n')}\n`
}

/** Thousands separators, or "Unknown" where the source gave nothing — `0` is a real count and must
 *  not be mistaken for missing. */
function count(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : 'Unknown'
}

/** Words the excerpt may run to unless the format says otherwise (see ../card/formats.ts). Enough
 *  for a thought, few enough to set at poster size. */
const DEFAULT_EXCERPT_WORDS = 60

/**
 * The opening of the tweet, cut at a sentence boundary, with an ellipsis when anything was dropped.
 *
 * Whole sentences are taken while they fit the budget. A trailing lead-in ("So:", "Data ingest:")
 * is dropped, since it promises something the card no longer shows. When whole sentences would
 * fill less than half the budget, the next one is cut at a word boundary instead.
 */
export function cardExcerpt(text: string, maxWords: number = DEFAULT_EXCERPT_WORDS): { text: string; truncated: boolean } {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const kept: string[][] = []
  let words = 0
  let truncated = false

  outer: for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
    const current: string[] = []
    for (const sentence of sentences) {
      const n = sentence.split(/\s+/).length
      if (words + n > maxWords) {
        // Whole sentences only — unless that would leave the card almost empty (a title and
        // nothing else), in which case the next sentence is cut at a word boundary to fill it.
        if (words < maxWords * 0.5) current.push(sentence.split(/\s+/).slice(0, maxWords - words).join(' '))
        truncated = true
        if (current.length) kept.push(current)
        break outer
      }
      current.push(sentence)
      words += n
    }
    kept.push(current)
  }

  // Drop dangling lead-ins from the end of what was kept.
  while (truncated && kept.length) {
    const last = kept[kept.length - 1]
    if (last.length && /:$/.test(last[last.length - 1])) last.pop()
    if (last.length) break
    kept.pop()
  }

  const excerpt = kept.map((p) => p.join(' ')).join('\n\n')
  return truncated ? { text: `${excerpt.replace(/[\s.,;:]+$/, '')}…`, truncated } : { text: excerpt, truncated }
}
