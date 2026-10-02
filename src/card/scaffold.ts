import type { Tweet } from '../twitter/tweet'
import { cardExcerpt } from '../markdown/tweet'
import type { ContentAnalysis } from './analysis'
import { fontHref, fontsIn, type FontSlug } from './fonts'
import { CARD_LIBRARIES, librariesIn, type LibraryName } from './libraries'

/**
 * output/index.html as the agent first finds it: the whole tweet, already correct.
 *
 * The semantic structure of a tweet card is fixed and written here from data — identity, "Replying
 * to", the text, media, a quoted tweet, the date and the counts, plus See more when the text is
 * cut. Two ownership zones share the canvas:
 *
 *   [data-artwork]   the designer's — anything visual: SVG, shapes, a <canvas>, decorative DOM
 *   [data-card]      the pipeline's — the tweet itself, locked
 *
 * plus the designer's <style> and <script>. The designer never types the tweet or rebuilds its
 * structure, so it cannot misquote it or turn it into something that is no longer a post.
 *
 * All text goes through escapeHtml; the tweet is data, never markup.
 */
export interface ScaffoldInput {
  tweet: Tweet
  analysis: ContentAnalysis
  /** Paths of the files in output/assets/, relative to output/. */
  assets: string[]
  motion: boolean
  /** The agent's design, when rebuilding after a run; the placeholders otherwise. */
  css?: string
  js?: string
  /** The markup inside [data-artwork]. */
  artwork?: string
  /** Font families the design links, from output/fonts/. */
  fonts?: FontSlug[]
  /** Libraries the design's script uses, loaded before it. */
  libraries?: LibraryName[]
}

/** How much of a quoted tweet the card shows. A quote supports the post; it is not the post. */
const QUOTE_WORDS = 40

export function cardScaffold(input: ScaffoldInput): string {
  const { tweet, analysis, assets } = input
  const asset = (name: string) => assets.find((a) => a.startsWith(`assets/${name}.`)) ?? null
  const media = assets.filter((a) => /^assets\/media-\d+\./.test(a))
  const count = (n: number) => n.toLocaleString('en-US')

  const paragraphs = analysis.excerpt.text.split(/\n\s*\n/).filter((p) => p.trim())
  // A title line is set as its own block, whether a blank line or a single line break follows it.
  let title: string | null = null
  if (analysis.titleLine && paragraphs[0]?.startsWith(analysis.titleLine)) {
    title = analysis.titleLine
    const rest = paragraphs[0].slice(title.length).trim()
    if (rest) paragraphs[0] = rest
    else paragraphs.shift()
  }

  const metrics = [
    ['replies', 'Replies', tweet.stats.replies],
    ['retweets', 'Retweets', tweet.stats.retweets],
    ['likes', 'Likes', tweet.stats.likes],
    ...(tweet.stats.views === null ? [] : [['views', 'Views', tweet.stats.views] as const]),
  ] as const

  const quote = tweet.quote
  const quoteMedia = assets.filter((a) => /^assets\/quote-media-\d+\./.test(a))
  const quoteText = quote ? cardExcerpt(quote.text, QUOTE_WORDS).text : ''

  const identity = (author: Tweet['author'], avatar: string | null, badge: string | null, indent: string) => [
    ...(avatar ? [`${indent}<img data-avatar src="${avatar}" alt="">`] : []),
    `${indent}<div class="identity">`,
    `${indent}  <div class="name"><span>${escapeHtml(author.name ?? author.handle)}</span>${badge ? ` <img data-badge src="${badge}" alt="Verified">` : ''}</div>`,
    `${indent}  <div class="handle">${escapeHtml(author.handle)}</div>`,
    `${indent}</div>`,
  ]

  const lines = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(tweet.author.name ?? tweet.author.handle)} on X</title>`,
    '<link rel="stylesheet" href="base.css">',
    ...(input.fonts ?? []).map((slug) => `<link rel="stylesheet" href="${fontHref(slug)}">`),
    '<style>',
    input.css ?? CSS_PLACEHOLDER,
    '</style>',
    '</head>',
    '<body>',
    '<div data-canvas>',
    '  <div data-artwork aria-hidden="true">',
    ARTWORK_START,
    input.artwork ?? '',
    ARTWORK_END,
    '  </div>',
    '  <article data-card>',
    '    <header data-author>',
    ...identity(tweet.author, asset('avatar'), asset('verified'), '      '),
    '    </header>',
    ...(tweet.replyingTo.length
      ? [`    <p data-replying>Replying to ${tweet.replyingTo.map((h) => `<span>${escapeHtml(h)}</span>`).join(' ')}</p>`]
      : []),
    // A reply that is only a quote has no text of its own: the element stays, empty.
    ...(title || paragraphs.length
      ? [
          '    <div data-excerpt>',
          ...(title ? [`      <p data-title>${escapeHtml(title)}</p>`] : []),
          ...paragraphs.map((p) => `      <p>${escapeHtml(p)}</p>`),
          '    </div>',
        ]
      : ['    <div data-excerpt></div>']),
    ...(analysis.excerpt.truncated ? ['    <div data-full></div>', '    <button data-toggle type="button">See more</button>'] : []),
    ...(media.length ? ['    <figure data-media>', ...media.map((path) => `      <img src="${path}" alt="">`), '    </figure>'] : []),
    ...(quote
      ? [
          '    <blockquote data-quote>',
          '      <header data-quote-author>',
          ...identity(quote.author, asset('quote-avatar'), asset('quote-verified'), '        '),
          '      </header>',
          ...(quoteText ? [`      <p>${escapeHtml(quoteText)}</p>`] : []),
          ...(quoteMedia.length ? ['      <figure data-quote-media>', ...quoteMedia.map((path) => `        <img src="${path}" alt="">`), '      </figure>'] : []),
          '    </blockquote>',
        ]
      : []),
    '    <footer data-meta>',
    ...(tweet.date ? [`      <time datetime="${escapeHtml(tweet.date)}">${formatDate(tweet.date)}</time>`] : []),
    '      <ul class="metrics">',
    ...metrics.map(([key, label, n]) => `        <li data-metric="${key}"><strong>${count(n)}</strong> <span>${label}</span></li>`),
    '      </ul>',
    '    </footer>',
    '  </article>',
    '</div>',
    ...(input.libraries ?? []).map((name) => `<script src="${CARD_LIBRARIES[name].path}"></script>`),
    '<script>',
    input.js ?? JS_PLACEHOLDER,
    '</script>',
    '<script src="toggle.js"></script>',
    '</body>',
    '</html>',
    '',
  ]
  return lines.join('\n')
}

const CSS_PLACEHOLDER = '/* The design of this card: your CSS goes here. */'
const JS_PLACEHOLDER = '// Your JavaScript, if the design needs any, goes here.'
const ARTWORK_START = '<!-- artwork: yours -->'
const ARTWORK_END = '<!-- /artwork -->'
/** Far beyond any hand-made SVG; a guard against a model pasting a bitmap in as markup. */
const MAX_ARTWORK = 200_000
/** The pipeline's own hooks: artwork may not carry them, or it could pass for the tweet in the QA. */
const RESERVED = /\bdata-(canvas|card|author|replying|excerpt|title|full|toggle|media|quote|quote-author|quote-media|meta|metric|avatar|badge|artwork)\b/gi

/**
 * Content lock: the agent's page, reduced to its design and rebuilt around the data.
 *
 * Kept from the agent: its <style>, its inline <script>, the markup inside [data-artwork], the font
 * families it linked and the vendored libraries it loaded. Everything else — every word, count,
 * image and attribute of the tweet — is regenerated with cardScaffold, whatever the model did.
 */
export function lockContent(agentHtml: string, input: Omit<ScaffoldInput, 'css' | 'js' | 'fonts' | 'libraries' | 'artwork'>) {
  const artwork = sanitizeArtwork(artworkOf(agentHtml))
  // The artwork's own <style> and <script> blocks are collected with the rest, then removed from it.
  const outside = agentHtml.replace(artworkRegion, ' ')
  const css = [...agentHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1].replace(CSS_PLACEHOLDER, '').trim()).filter(Boolean).join('\n\n')
  const js = [...agentHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/.test(m[1]))
    .map((m) => m[2].replace(JS_PLACEHOLDER, '').trim())
    .filter(Boolean)
    .join('\n\n')
  // Nothing may close the tag it lives in early.
  const safeCss = css.replace(/<\/style/gi, '<\\/style')
  const safeJs = js.replace(/<\/script/gi, '<\\/script')
  const fonts = fontsIn(agentHtml)
  const libraries = librariesIn(agentHtml)
  const html = cardScaffold({ ...input, css: safeCss || CSS_PLACEHOLDER, js: safeJs || JS_PLACEHOLDER, fonts, libraries, artwork })
  return { html, cssLength: css.length, jsLength: js.length, artworkLength: artwork.length, fonts, libraries, content: contentOf(outside) }
}

/** The page's tweet content, for telling whether the agent changed it: body markup without the
 *  artwork, styles and scripts. */
export function contentOf(html: string): string {
  return html
    .slice(Math.max(0, html.search(/<body\b/i)))
    .replace(artworkRegion, ' ')
    .replace(/<style[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+/g, ' ')
}

/** From the [data-artwork] opening tag to the card: whatever the designer put in between. */
const artworkRegion = /<div\b[^>]*\bdata-artwork\b[^>]*>[\s\S]*?(?=<article\b[^>]*\bdata-card\b)/i

function artworkOf(html: string): string {
  const start = html.indexOf(ARTWORK_START)
  const end = html.indexOf(ARTWORK_END, start + 1)
  if (start >= 0 && end > start) return html.slice(start + ARTWORK_START.length, end).trim()
  // The markers were dropped: take the region up to the card and remove the wrapper's closing tag.
  const region = html.match(artworkRegion)?.[0]
  if (!region) return ''
  return region.replace(/^<div\b[^>]*>/i, '').replace(/<\/div>\s*$/i, '').trim()
}

/** Artwork is decoration: no scripts or styles of its own (they belong in the page's), no handlers,
 *  no remote anything, and none of the tweet's hooks. */
function sanitizeArtwork(markup: string): string {
  if (markup.length > MAX_ARTWORK) return ''
  return markup
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<(link|meta|base|iframe|object|embed|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(RESERVED, (_, name: string) => `data-art-${name}`)
    .replace(new RegExp(ARTWORK_END.replace(/[/]/g, '\\/'), 'g'), '')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? escapeHtml(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
