import type { CardFormat } from './formats'

/**
 * output/base.css — the technical floor under every card, written by the pipeline.
 *
 * Only what a card must not get wrong: the export canvas at exactly the format's size with nothing
 * scrolling, the artwork layer behind the tweet, the See more expansion, and sane defaults for the
 * pictures. No colours, no typefaces,
 * no type scale, no spacing system — the look of the card is entirely the agent's.
 */
export function baseCss(format: CardFormat): string {
  return `/* base.css — written by the pipeline. The card's own <style> is linked after it and wins. */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; overflow: hidden; }
[data-canvas] {
  position: relative;
  width: ${format.width}px;
  height: ${format.height}px;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
[data-canvas].expanded { height: auto; min-height: ${format.height}px; overflow: visible; }
/* The designer's layer: fills the canvas, behind the tweet. Its contents are entirely the design's. */
[data-artwork] { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
[data-artwork] canvas, [data-artwork] svg { display: block; }
[data-card] { position: relative; z-index: 1; }
[data-avatar] { display: block; object-fit: cover; border-radius: 50%; flex: none; }
[data-badge] { width: 1.1em; height: 1.1em; vertical-align: -0.18em; display: inline-block; flex: none; }
[data-media] { margin: 0; }
[data-media] img, [data-quote-media] img { display: block; width: 100%; object-fit: cover; }
[data-excerpt], [data-full], [data-quote] { overflow-wrap: anywhere; }
[data-excerpt]:empty { display: none; }
[data-full] p { margin: 0 0 1em; }
`
}
