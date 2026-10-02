/**
 * output/toggle.js — "See more" / "See less" for a card whose excerpt was cut.
 *
 * Written by the pipeline rather than the agent, for two reasons. The behaviour is the same on
 * every card and has to work every time, which is not something to regenerate per run. And the
 * full text arrives here as data from the parsed tweet, so a long tweet is never retyped by a
 * model — it cannot be paraphrased, shortened or mangled on the way onto the card.
 *
 * The agent's side of the contract is markup only (see ../markdown/agents.ts): a [data-excerpt]
 * element, an empty [data-full] after it, and a [data-toggle] button, all inside [data-canvas].
 *
 * Expanded, the canvas gets the class "expanded" — which ../card/base.ts lets grow past the
 * format's height — and the new height is posted to the viewer page (../card/viewer.ts) so it can
 * make room instead of cropping. It also posts the canvas background, so the viewer can continue
 * it past the canvas edges: the preview is the background and the card, with no frame around them.
 */
export function toggleScript(fullText: string, truncated: boolean): string {
  return `(() => {
  const FULL_TEXT = ${JSON.stringify(fullText)}
  const TRUNCATED = ${truncated}

  const canvas = document.querySelector('[data-canvas]')
  const excerpt = document.querySelector('[data-excerpt]')
  const full = document.querySelector('[data-full]')
  const button = document.querySelector('[data-toggle]')
  if (!canvas) return

  // Sent first, before any early return: every card has a background, not only a long one.
  const background = () => {
    if (window.parent === window) return
    const s = getComputedStyle(canvas)
    const image = s.backgroundImage.length < 4000 ? s.backgroundImage : 'none'
    window.parent.postMessage({ type: 'card-background', color: s.backgroundColor, image }, '*')
  }
  background()
  addEventListener('load', background)

  if (!excerpt || !full || !button) return

  if (!TRUNCATED) {
    full.remove()
    button.remove()
    return
  }

  // One <p> per paragraph. A short opening line ending in a colon ("Data ingest:") is a section
  // lead-in, marked .lead so the design can set it apart. Built with textContent, so the tweet
  // stays inert whatever it contains.
  for (const block of FULL_TEXT.split(/\\n\\s*\\n/)) {
    const lines = block.trim().split('\\n')
    if (!lines[0]) continue
    const p = document.createElement('p')
    if (lines.length > 1 && lines[0].trim().endsWith(':') && lines[0].trim().split(/\\s+/).length <= 5) {
      const lead = document.createElement('span')
      lead.className = 'lead'
      lead.textContent = lines.shift().trim()
      p.append(lead, ' ')
    }
    p.append(lines.join(' ').trim())
    full.append(p)
  }
  // The attribute and an inline !important display: the design's stylesheet may set any display on
  // these elements (one hid [data-full] outright), and See more is the pipeline's behaviour, not
  // the design's — an inline important declaration is the one thing a stylesheet cannot override.
  const show = (element, visible, as) => {
    element.hidden = !visible
    if (visible && as) element.style.setProperty('display', as, 'important')
    else if (visible) element.style.removeProperty('display')
    else element.style.setProperty('display', 'none', 'important')
  }
  // The button stays visible in both states, whatever the stylesheet says about it.
  const keepButton = () => {
    button.style.removeProperty('display')
    if (getComputedStyle(button).display === 'none') button.style.setProperty('display', 'inline-block', 'important')
  }
  show(full, false)
  keepButton()
  button.setAttribute('aria-expanded', 'false')

  const report = () =>
    requestAnimationFrame(() => {
      const height = Math.ceil(canvas.getBoundingClientRect().height)
      if (window.parent !== window) window.parent.postMessage({ type: 'card-height', height }, '*')
    })

  button.addEventListener('click', () => {
    const open = full.hidden
    show(full, open, 'block')
    show(excerpt, !open)
    canvas.classList.toggle('expanded', open)
    keepButton()
    document.documentElement.style.overflow = open ? 'auto' : ''
    document.body.style.overflow = open ? 'auto' : ''
    button.textContent = open ? 'See less' : 'See more'
    button.setAttribute('aria-expanded', String(open))
    report()
  })
})()
`
}
