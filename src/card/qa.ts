import puppeteer from '@cloudflare/puppeteer'
import type { ContentAnalysis } from './analysis'
import type { CardFormat } from './formats'
import { FINISH_ANIMATIONS, MEASURE_SCRIPT, type Issue, type MeasureParams } from './measure'
import type { Tweet } from '../twitter/tweet'

/**
 * validateCard, deterministic half: render the bundle in Chromium and measure it.
 *
 * Catches the obvious failures — wrong canvas size, clipped text, tiny type, a changed excerpt, a
 * missing avatar, a See more button that does nothing — without spending a model call. The same
 * render produces the PNG export.
 */
export interface Inspection {
  issues: Issue[]
  metrics: Record<string, unknown>
  png: Uint8Array
}

type BrowserBinding = Parameters<typeof puppeteer.launch>[0]

/** How long a Motion & 3D card gets to finish its entrance before it is measured and captured. */
const SETTLE_MS = 3000
/** And a static one, to run its draw-once script. */
const STATIC_SETTLE_MS = 600

export function measureParams(tweet: Tweet, analysis: ContentAnalysis, motion: boolean, format: CardFormat, mediaAssets: string[]): MeasureParams {
  const count = (n: number) => n.toLocaleString('en-US')
  return {
    width: format.width,
    height: format.height,
    cardWidth: format.cardWidth,
    minBodyPx: format.minBodyPx,
    minTextPx: format.minTextPx,
    excerpt: analysis.excerpt.text,
    titleLine: analysis.titleLine && analysis.excerpt.text.startsWith(analysis.titleLine) ? analysis.titleLine : null,
    truncated: analysis.excerpt.truncated,
    fullLength: tweet.text.replace(/\s+/g, ' ').trim().length,
    name: tweet.author.name,
    handle: tweet.author.handle,
    verified: tweet.author.verified,
    mediaAssets,
    // The contract: no randomly underlined or highlighted words.
    emphasisAllowed: false,
    motion,
    metrics: [
      { key: 'replies', label: 'Replies', value: count(tweet.stats.replies) },
      { key: 'retweets', label: 'Retweets', value: count(tweet.stats.retweets) },
      { key: 'likes', label: 'Likes', value: count(tweet.stats.likes) },
      ...(tweet.stats.views === null ? [] : [{ key: 'views', label: 'Views', value: count(tweet.stats.views) }]),
    ],
  }
}

export async function inspectCard(binding: BrowserBinding, html: string, params: MeasureParams): Promise<Inspection> {
  const browser = await puppeteer.launch(binding)
  try {
    const page = await browser.newPage()
    // A card's own errors are failures: a broken script means a card that does not animate, or
    // worse, one whose See more does nothing.
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err instanceof Error ? err.message : String(err)))
    // A dialog (alert, confirm, prompt) blocks the page until answered — and nobody is there to answer.
    page.on('dialog', (dialog) => {
      errors.push(`the card opened a ${dialog.type()} dialog`)
      void dialog.dismiss().catch(() => {})
    })
    await page.setViewport({ width: params.width, height: params.height, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    // A moving card is measured, and exported, in its settled state: the brief requires everything
    // to settle within 2.5s.
    // A static card's script draws its artwork once, on load: a moment is enough for it to land.
    if (!params.motion) await new Promise((resolve) => setTimeout(resolve, STATIC_SETTLE_MS))
    if (params.motion) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
      // Then finish every finite animation, so the measurement and the PNG always see the end state
      // even on a slow browser. Infinite ones (an ambient field) keep running.
      await page.evaluate(FINISH_ANIMATIONS)
    }

    const measured = (await page.evaluate(`(${MEASURE_SCRIPT})(${JSON.stringify(params)})`)) as {
      issues: Issue[]
      metrics: Record<string, unknown>
    }

    // The measurement clicks See more open and shut, and showing the excerpt again restarts its
    // entrance animation — settle once more, or the PNG catches the tweet mid-fade.
    await page.evaluate(FINISH_ANIMATIONS)
    const clip = { x: 0, y: 0, width: params.width, height: params.height }
    const png = (await page.screenshot({ type: 'png', clip })) as Uint8Array
    for (const message of [...new Set(errors)].slice(0, 3)) {
      measured.issues.push({ severity: 'high', rule: 'script-error', detail: `The card threw: ${message.slice(0, 200)}`, source: 'qa' })
    }
    return { issues: measured.issues, metrics: measured.metrics, png }
  } finally {
    await browser.close().catch(() => {})
  }
}
