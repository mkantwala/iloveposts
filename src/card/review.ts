import type { Issue } from './measure'

/**
 * A rendered version's review: how bad it is, and what a repair is told to fix.
 */
export interface Review {
  issues: Issue[]
  metrics: Record<string, unknown>
  at: string
}

/** How bad a version is, from its measured issues. Lower is better. */
export function score(issues: Issue[]): number {
  const weight = { high: 10, medium: 3, low: 0 }
  return issues.reduce((n, i) => n + weight[i.severity], 0)
}

/** How to fix each measured rule without redesigning — the repair model is told what to change,
 *  not only what is wrong. */
const REMEDIES: Record<string, string> = {
  'card-outside-canvas': 'Make the card shorter: tighten vertical gaps and card padding, reduce media height, or step the body size down — never below the minimum. Never remove text.',
  'clipped-content': 'Nothing may be cut off. Shorten the card as for card-outside-canvas; remove fixed heights and max-heights on text containers.',
  'unbalanced-vertical': 'Centre the card vertically inside the canvas (the canvas is a flex container: align-items: center), then nudge it up slightly for optical balance.',
  'insufficient-outer-space': 'Narrow or shorten the card so it keeps clear space from every canvas edge.',
  'title-merged': 'Style [data-title] as its own block, visibly separate from the paragraph after it.',
  'excerpt-mismatch': 'Do not change the text of [data-excerpt]; remove any CSS content, text-transform or script that alters it.',
  'body-too-small': 'Raise the tweet text to at least the minimum body size in AGENTS.md.',
  'text-too-small': 'Raise the listed elements to at least the minimum text size in AGENTS.md.',
  'too-many-font-families': 'Use at most two font families, both linked from fonts/; remove every other font-family.',
  'badge-oversized': 'Use <img data-badge> with no width or height of your own; base.css sizes it to the name.',
  'metric-label': 'Put the label text (Replies, Retweets, Likes, Views) inside the same [data-metric] element as its number.',
  'metric-value': 'Show the exact count from context/tweet.md inside the [data-metric] element.',
  'see-more-hidden': 'Make room for the See more button inside the card, above the metadata.',
  'content-hidden': 'Make every entrance animation end at opacity 1 with animation-fill-mode: forwards (or no animation), and never start content hidden behind an event that may not fire.',
  'script-error': 'Fix the JavaScript error named above; guard every querySelector and never assume an element exists.',
  'no-reduced-motion': 'Add @media (prefers-reduced-motion: reduce) that removes the entrance and the tilt and draws the field once.',
  'extra-script': 'Keep all of your JavaScript in one inline <script> at the end of body, before toggle.js.',
  'artwork-covers-content': 'Keep everything in [data-artwork] behind the card: no z-index above it, no positioned artwork over the text. Move or fade the artwork where it meets the text.',
}

/** context/review.md for a repair pass: every violation, what was measured, and how to fix it. */
export function reviewMarkdown(review: Review): string {
  const actionable = review.issues.filter((i) => i.severity !== 'low')
  return [
    '# Review',
    '',
    'Fix only these violations. Do not redesign the card.',
    '',
    ...actionable.map(
      (i) =>
        `- [${i.severity}] ${i.rule}: ${i.detail}` +
        (REMEDIES[i.rule] ? `\n  Fix: ${REMEDIES[i.rule]}` : ''),
    ),
    '',
    '## Measurements',
    '',
    '```json',
    // What a repair needs: sizes and positions. The design fingerprint is for ./recent.ts.
    JSON.stringify(Object.fromEntries(Object.entries(review.metrics).filter(([k]) => k !== 'design' && k !== 'artwork'))),
    '```',
    '',
  ].join('\n')
}
