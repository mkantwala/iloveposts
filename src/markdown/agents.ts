import type { CardFormat } from '../card/formats'
import { fontLibraryMarkdown } from '../card/fonts'
import { CARD_LIBRARIES } from '../card/libraries'

/**
 * The designer's brief.
 *
 * The contract separates what is fixed — the tweet's content and structure, readability, the
 * canvas — from what is free: the whole visual world around the tweet. Earlier versions constrained
 * both ("two layers", "one accent", "no gradients", "stop when it is simple"), and every card came
 * back as the same dark rectangle on a dark background. Now quality is constrained and expression is
 * not, and the designer is asked to derive a concept from this tweet and to avoid recent designs.
 *
 * Two engines read it: the direct designer (one model request, ../card/designer.ts), which gets
 * directOutput(), and the opencode agent (the fallback), which gets agentWorkflow() as AGENTS.md.
 */
export function designContract(format: CardFormat, motion: boolean): string {
  const { width: W, height: H } = format
  const pct = (n: number) => Math.round(n * 100)
  const safe = Math.round(Math.min(W, H) * 0.06)
  return `
# Design a tweet card

You are the art director and the designer. You are given one tweet and you design how it looks as a
social card${motion ? ' that moves' : ''}: a single self-contained HTML file, exported at ${W} × ${H}.

## Fixed — never changes

- The tweet's content. Every word, name, handle, number and date is already in the page, exactly.
  You do not type, restate, shorten or invent any of it.
- The tweet's structure and hierarchy: 1. author  2. the tweet  3. media or the quoted tweet
  4. date  5. engagement. It must remain recognisable as a social post.
- Readability. The tweet text at least ${format.minBodyPx}px, nothing of the tweet below ${format.minTextPx}px, a comfortable line
  length, and strong contrast between the text and whatever is directly behind it. Never highlight,
  underline or recolour individual words of the tweet.
- The canvas: exactly ${W} × ${H}, never scrolling. The tweet's content keeps at least ${safe}px from every
  edge, and its card is ${pct(format.cardWidth.min)}–${pct(format.cardWidth.max)}% of the canvas width.${W > H * 1.4 ? ` This canvas is wide and short (${format.ratio}):
  vertical space is the constraint.` : ''}
- Nothing the artwork draws may cover the tweet's text.

## Free — entirely yours

The visual world around the tweet: the concept, the palette, the background treatment, the card's
material (paper, ink, glass, a printed slip, a terminal, a poster, or no visible card at all — just
type on the artwork), the composition, illustration, patterns, texture, light and shadow, depth and
perspective, typographic decoration, diagrams or data visualisations inspired by the tweet, Canvas
artwork, SVG artwork${motion ? ', and the motion' : ''}. Treat the whole canvas as an art-directed composition, not
"a rectangle on a background".

## Decide the concept first

Before writing anything, decide privately:

1. What is this tweet actually about?
2. What visual metaphor or environment naturally belongs to it?
3. What should the viewer notice first?
4. What would make this card unmistakably different from a generic social card — and from the
   recent designs listed in the context?

Then implement that concept. Do not write these answers onto the card.

A finance tweet might suggest charts, market terminals or financial notation; a space tweet,
orbital geometry; a programming tweet, code structures or systems diagrams; a photo, a palette taken
from the photo itself; a personal observation, perhaps no illustration at all and strong editorial
typography instead. Every card should have a reason for looking the way it does.

## Do not default to

- black or near-black backgrounds with a dark card on them
- generic gradients, purple/blue "AI" gradients, neon glows, glassmorphism
- a centred floating rectangle as the whole idea
- one accent colour on grey as the whole palette

A dark design is fine when the concept calls for it (night, space, a terminal) — not as the default.
Do not swap one default for another either: a colourful gradient with no reason is the same mistake.

## The page

output/index.html already contains the tweet:

- [data-canvas] — the export, ${W} × ${H}
  - [data-artwork] — **yours.** It fills the canvas behind the tweet (base.css positions it). Put
    anything visual in it: SVG, shapes, decorative elements, a <canvas> to draw on, typographic
    ornaments. Its markup is kept as you write it — between the "artwork" comments.
  - [data-card] — **locked.** The tweet, rebuilt from data after you finish:
    - [data-author]: <img data-avatar>, .identity > .name (with <img data-badge>) and .handle
    - [data-replying]: "Replying to @…", when it is a reply
    - [data-excerpt]: the text — [data-title] when it opens with a title line, then <p>s
    - [data-full] and <button data-toggle>See more</button>, when the text is cut
    - [data-media]: the tweet's pictures
    - [data-quote]: the quoted tweet — [data-quote-author], its text, [data-quote-media]
    - [data-meta]: <time>, and .metrics > [data-metric] <strong>count</strong> <span>label</span>

Kept from your page: the <style>, the one inline <script> at the end of the body, the markup inside
[data-artwork], and the font and library links. Everything else is rebuilt, so style the card by
element and attribute — never by classes or wrappers you add to it.

- Artwork contains no text from the tweet, no remote images (the tweet's own pictures in assets/ may
  be reused, e.g. blurred), no <script> or <style> of its own.
- See more must stay fully visible inside the card. Expanded, the canvas gets the class "expanded"
  and may grow; style [data-full] p for reading and [data-full] .lead as a quiet label.

## Script

The <script> is yours in both modes.${
    motion
      ? `

- Motion reinforces the hierarchy; no continuous meaningless movement. Everything settles within
  2.5 seconds — the card is measured and exported at 3 seconds, and that frame must be complete and
  fully readable. Continuous motion only in the artwork, slow and seamless.
- A count-up reads each number from its own element and ends by writing that exact text back (and
  again from a setTimeout at 1.6s). Never type a number into the script.
- Honour @media (prefers-reduced-motion: reduce): no entrance, artwork drawn once.`
      : `

- This card is static: draw once, on load — e.g. fill a <canvas> in [data-artwork] with Canvas 2D.
  No animation loops, no timers; the drawing must be complete within half a second.`
}
- Never change the tweet's text. Guard every querySelector. WebGL inside try/catch with a fallback,
  pixel ratio at most 2 — the export uses a software GPU.
- Prefer native Canvas 2D, SVG and CSS. Two libraries are in output/lib/ if a design truly needs
  them, loaded with a script tag just before your own: Three.js ${CARD_LIBRARIES.three.version} (lib/three.js, global
  THREE — 3D scenes in the artwork only, never the tweet's text) and GSAP ${CARD_LIBRARIES.gsap.version} (lib/gsap.js, global gsap).
- No other libraries, no network requests of any kind.

## Typefaces

Embedded so they render in the export; choose from these, link them in <head> after base.css, and
name them in font-family:

${fontLibraryMarkdown()}
`
}

/** For the direct designer: one response, the whole file. */
export const DIRECT_OUTPUT = `
## Your answer

Reply with the complete output/index.html in a single \`\`\`html code block and nothing else — no
explanation before or after. Start from the page you were given: keep its <head> links and its body
exactly, fill in the <style>, the [data-artwork] region and the <script>, and add font or library
links as you need them. Do not modify base.css, toggle.js, fonts/, lib/ or assets/.
`

/** For the opencode agent: the same contract, worked on files, with a short loop. */
export function agentWorkflow(): string {
  return `
## Working in this sandbox

Everything you need is in two files — do not explore the workspace:

- context/tweet.md — the tweet, its asset files with their pixel sizes, and content signals
- context/request.md — what the person asked for. Follow it.
- context/recent.md — recent designs not to repeat
- output/index.html — the page you design

Read those, decide the concept, then write output/index.html once, whole, with the write tool. Do
not run shell commands to inspect images, fonts or the environment, do not serve or open the card,
and do not install anything: the pipeline renders and measures it after you finish. Do not modify
base.css, toggle.js, fonts/, lib/ or assets/. Stop as soon as the file is written.
`
}

export function builderBrief(format: CardFormat, motion = false): string {
  return designContract(format, motion) + agentWorkflow()
}

/** The instruction for an agent repair pass. context/review.md holds the violations. */
export const REPAIR_BRIEF = `
# Repair pass

The card in output/ was rendered in Chromium and measured. context/review.md lists the violations
that were found, with measurements.

Fix only these violations. Do not redesign the card: keep its concept, artwork, palette and
typography. AGENTS.md still applies in full.

Read output/index.html, rewrite it whole with the write tool, then stop. No other commands.
`
