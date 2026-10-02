import type { CardFormat } from './formats'

/**
 * The preview page: the card, scaled to fit the window, in a sandboxed frame.
 *
 * The card is a fixed-size export, usually taller than the window and never scrolling itself, so
 * shown directly it would be cropped. The frame is sandboxed (scripts only, opaque origin): the
 * card is model-written HTML, and must not be able to act on this origin. It can still post its
 * expanded height and its background colour, which is all toggle.js sends.
 *
 * Around the scaled card the page continues the card's own background, with no frame or shadow:
 * what the reader sees is the background and the tweet card, as in the export — not a card on a
 * poster on a page.
 */
export function viewerHtml(format: CardFormat, cardSrc: string, title: string): string {
  const W = format.width
  const H = format.height
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; background: #ffffff; }
  body { background-size: cover; background-position: center; background-attachment: fixed; }
  body { overflow: hidden; }
  body.tall { overflow-y: auto; }
  #frame { position: relative; margin: 0 auto; }
  iframe {
    position: absolute; left: 0; top: 0;
    width: ${W}px; height: ${H}px; border: 0;
    transform-origin: 0 0;
  }
</style>
</head>
<body>
<div id="frame"><iframe src="${escapeHtml(cardSrc)}" sandbox="allow-scripts" scrolling="no" title="${escapeHtml(title)}"></iframe></div>
<script>
  const W = ${W}
  const H = ${H}
  const frame = document.getElementById('frame')
  const card = frame.querySelector('iframe')
  let height = H

  // The poster fits the window whole. Expanded past the canvas height it fits the width and
  // scrolls instead: shrunk to fit a long text vertically, it would be unreadable.
  const fit = () => {
    const tall = height > H
    const scale = tall ? Math.min(innerWidth / W, 1) : Math.min(innerWidth / W, innerHeight / H)
    document.body.classList.toggle('tall', tall)
    card.style.height = height + 'px'
    card.style.transform = 'scale(' + scale + ')'
    frame.style.width = W * scale + 'px'
    frame.style.height = height * scale + 'px'
    frame.style.margin = (tall ? 0 : Math.max((innerHeight - H * scale) / 2, 0)) + 'px auto 0'
  }

  // Only colours and gradients are accepted, so the card cannot point this page at a URL.
  const safe = (value) => typeof value === 'string' && value.length < 4000 && !/url\\(|expression|image-set/i.test(value)
  addEventListener('message', (event) => {
    if (event.source !== card.contentWindow || !event.data) return
    if (event.data.type === 'card-height') {
      height = Math.max(H, Math.min(Number(event.data.height) || H, 40000))
      fit()
    } else if (event.data.type === 'card-background') {
      const { color, image } = event.data
      const clear = !safe(color) || /^rgba\\(.*,\\s*0\\)$|^transparent$/.test(color)
      if (!clear) document.body.style.backgroundColor = document.documentElement.style.backgroundColor = color
      // A gradient-only background is stretched over the page, so the edges still continue.
      if (safe(image) && image !== 'none' && (clear || /gradient/.test(image))) document.body.style.backgroundImage = image
    }
  })
  addEventListener('resize', fit)
  fit()
</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
