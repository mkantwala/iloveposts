/**
 * The export canvases a card can be made for — the one place their dimensions live.
 *
 * Every consumer — the agent brief, the design-system tokens, the viewer, the browser QA and the
 * PNG export — reads its numbers from here. None of them carries its own 1600 or 900, so a card
 * cannot be designed for one size and checked or exported at another.
 *
 * The canvas is the export's frame, not the card: the tweet card is a composition *inside* it and
 * sizes to its content (see ../markdown/agents.ts).
 *
 * All three are X (Twitter) sizes. An image in a post is shown at roughly 500–600 CSS pixels wide
 * in the timeline, so a 1600-wide canvas is displayed at about a third of its size — which is why
 * the type floors are high: 40px of body text reads as about 14px on a phone, the size of a tweet.
 */
export const CARD_FORMATS = {
  x_post: {
    label: 'X post image',
    width: 1600,
    height: 900,
    ratio: '16:9',
    /** How much of the tweet the card shows before "See more". */
    excerptWords: 35,
    /** Multiplies the design system's type and spacing scale (1 = sized for a 1080-wide canvas). */
    scale: 1.3,
    /** Legibility floors, in canvas pixels, checked by the browser QA. */
    minBodyPx: 40,
    minTextPx: 24,
    /** The card's width as a share of the canvas: a wide canvas wants a narrower card, or lines
     *  run far past a readable length. */
    cardWidth: { min: 0.5, max: 0.82 },
  },
  x_square: {
    label: 'X square image',
    width: 1200,
    height: 1200,
    ratio: '1:1',
    excerptWords: 50,
    scale: 1.12,
    minBodyPx: 36,
    minTextPx: 22,
    cardWidth: { min: 0.68, max: 0.9 },
  },
  x_card: {
    label: 'X link card (summary_large_image)',
    width: 1200,
    height: 628,
    ratio: '1.91:1',
    excerptWords: 16,
    scale: 1.05,
    minBodyPx: 34,
    minTextPx: 20,
    cardWidth: { min: 0.6, max: 0.9 },
  },
} as const

export type FormatId = keyof typeof CARD_FORMATS
export type CardFormat = (typeof CARD_FORMATS)[FormatId] & { id: FormatId }

export const DEFAULT_FORMAT: FormatId = 'x_post'

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && Object.hasOwn(CARD_FORMATS, value)
}

export function cardFormat(id: FormatId): CardFormat {
  return { id, ...CARD_FORMATS[id] }
}

/** What the API reports about a format. */
export function formatSummary(format: CardFormat) {
  return { id: format.id, label: format.label, width: format.width, height: format.height, ratio: format.ratio }
}
