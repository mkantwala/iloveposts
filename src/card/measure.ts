/**
 * The measurement script the QA runs inside the rendered card — kept as a string on purpose.
 *
 * page.evaluate() can take a function, but the Worker bundle wraps functions in __name() helpers
 * that do not exist in the page, and the call fails there. A string is sent as written. String.raw
 * keeps its regex backslashes intact; scripts/check-generated.mjs checks that it parses.
 *
 * It takes MeasureParams and returns { issues, metrics }. Every issue carries a measured value, so
 * the repair agent is told "the card is 18px from the canvas edge", not "improve the spacing".
 */
export interface MeasureParams {
  width: number
  height: number
  /** The card's allowed width, as a share of the canvas. */
  cardWidth: { min: number; max: number }
  minBodyPx: number
  minTextPx: number
  excerpt: string
  /** The excerpt's opening title line, when it has one — it must be set as its own block. */
  titleLine: string | null
  truncated: boolean
  fullLength: number
  name: string | null
  handle: string
  verified: boolean
  mediaAssets: string[]
  emphasisAllowed: boolean
  metrics: Array<{ key: string; label: string; value: string }>
  /** Motion & 3D mode: a reduced-motion fallback is required. Any card may have one inline script. */
  motion: boolean
}

export interface Issue {
  severity: 'high' | 'medium' | 'low'
  rule: string
  detail: string
  source?: 'qa'
}

export const MEASURE_SCRIPT = String.raw`(params) => {
  const issues = []
  const add = (severity, rule, detail) => issues.push({ severity, rule, detail, source: 'qa' })
  const round = (n) => Math.round(n)
  const W = params.width
  const H = params.height
  const norm = (t) => (t || '').replace(/\.\.\./g, '…').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
  const metrics = {}

  const canvas = document.querySelector('[data-canvas]')
  if (!canvas) {
    add('high', 'missing-canvas', 'There is no [data-canvas] element.')
    return { issues, metrics }
  }
  const c = canvas.getBoundingClientRect()
  metrics.canvas = { width: round(c.width), height: round(c.height) }
  if (Math.abs(c.width - W) > 1 || Math.abs(c.height - H) > 1 || Math.abs(c.left) > 1 || Math.abs(c.top) > 1) {
    add('high', 'canvas-size', 'The canvas is ' + round(c.width) + '×' + round(c.height) + ' at ' + round(c.left) + ',' + round(c.top) + '; it must be ' + W + '×' + H + ' at 0,0.')
  }
  const doc = document.documentElement
  if (doc.scrollWidth > W + 1 || doc.scrollHeight > H + 1) {
    add('high', 'page-overflow', 'The page is ' + doc.scrollWidth + '×' + doc.scrollHeight + ', larger than the ' + W + '×' + H + ' canvas.')
  }

  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
  // Text as read: a space wherever one block ends and the next begins, which textContent omits.
  const blockText = (root) => {
    const blockOf = (node) => {
      for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        if (!/^inline/.test(getComputedStyle(el).display)) return el
      }
      return root
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let out = ''
    let last = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const block = blockOf(node)
      if (last && block !== last) out += ' '
      out += node.textContent
      last = block
    }
    return out
  }
  // The tweet's text only: whatever the artwork contains is decoration, checked separately below.
  const textElements = [...canvas.querySelectorAll('*')].filter((el) => ownText(el) && visible(el) && !el.closest('[data-artwork]'))

  // The card: inside the canvas, with negative space around it.
  const card = canvas.querySelector('[data-card]')
  let cardRect = null
  if (!card) add('high', 'missing-card', 'There is no [data-card] element inside the canvas.')
  else {
    const r = card.getBoundingClientRect()
    cardRect = r
    const margins = { left: r.left - c.left, right: c.right - r.right, top: r.top - c.top, bottom: c.bottom - r.bottom }
    metrics.card = { width: round(r.width), height: round(r.height), widthRatio: Number((r.width / W).toFixed(3)), margins: Object.fromEntries(Object.entries(margins).map(([k, v]) => [k, round(v)])) }
    const smallest = Math.min(...Object.values(margins))
    const wanted = Math.min(W, H) * 0.04
    if (smallest < -1) add('high', 'card-outside-canvas', 'The card extends ' + round(-smallest) + 'px past the canvas edge.')
    else if (smallest < wanted) add('medium', 'insufficient-outer-space', 'The card is only ' + round(smallest) + 'px from the canvas edge; leave at least ' + round(wanted) + 'px (about 6–16% of the canvas).')
    const range = round(params.cardWidth.min * 100) + '–' + round(params.cardWidth.max * 100) + '%'
    if (r.width / W > params.cardWidth.max + 0.03) add('medium', 'card-too-wide', 'The card is ' + round((r.width / W) * 100) + '% of the canvas width; keep it within ' + range + '.')
    if (r.width / W < params.cardWidth.min - 0.03) add('medium', 'card-too-narrow', 'The card is ' + round((r.width / W) * 100) + '% of the canvas width; keep it within ' + range + '.')
    // Optically centred means a little more room below than above; a card pushed to one end reads
    // as leftover space rather than composition.
    if (margins.top >= 0 && margins.bottom >= 0 && r.height < H * 0.9) {
      const ratio = margins.top / Math.max(margins.bottom, 1)
      if (ratio < 0.55 || ratio > 1.35) add('medium', 'unbalanced-vertical', 'The card has ' + round(margins.top) + 'px above it and ' + round(margins.bottom) + 'px below; centre it optically (top margin about 85–95% of the bottom).')
    }
  }

  // Clipping, tiny text and font families, over every visible element that holds text.
  const clipped = []
  const tiny = []
  const families = new Set()
  for (const el of textElements) {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    families.add(s.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase())
    if (parseFloat(s.fontSize) < params.minTextPx - 0.5) tiny.push(el.tagName.toLowerCase() + ' "' + ownText(el).slice(0, 30) + '" at ' + round(parseFloat(s.fontSize)) + 'px')
    let outside = r.right > c.right + 2 || r.bottom > c.bottom + 2 || r.left < c.left - 2 || r.top < c.top - 2
    for (let a = el.parentElement; a && !outside && a !== canvas.parentElement; a = a.parentElement) {
      const as = getComputedStyle(a)
      if (/hidden|clip/.test(as.overflowX + as.overflowY)) {
        const ar = a.getBoundingClientRect()
        if (r.right > ar.right + 2 || r.bottom > ar.bottom + 2 || r.left < ar.left - 2 || r.top < ar.top - 2) outside = true
      }
    }
    if (!outside && /hidden|clip/.test(s.overflowX + s.overflowY) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)) outside = true
    if (outside) clipped.push(el.tagName.toLowerCase() + ' "' + ownText(el).slice(0, 40) + '"')
  }
  if (clipped.length) add('high', 'clipped-content', clipped.length + ' text element(s) are cut off or outside the canvas: ' + clipped.slice(0, 4).join('; ') + '.')
  if (tiny.length) add('medium', 'text-too-small', tiny.length + ' text element(s) are below ' + params.minTextPx + 'px: ' + tiny.slice(0, 4).join('; ') + '.')
  metrics.fontFamilies = [...families]
  if (families.size > 2) add('medium', 'too-many-font-families', families.size + ' font families are used (' + [...families].join(', ') + '); use at most 2.')

  // The excerpt: word for word, readable, and uniform unless emphasis was asked for.
  const excerpt = canvas.querySelector('[data-excerpt]')
  let bodySize = 0
  if (!excerpt) add('high', 'missing-excerpt', 'There is no [data-excerpt] element.')
  else {
    const got = norm(blockText(excerpt))
    const want = norm(params.excerpt)
    if (got !== want) {
      let i = 0
      while (i < got.length && got[i] === want[i]) i++
      add('high', 'excerpt-mismatch', 'The excerpt text differs from the "Card excerpt" at character ' + i + ': expected "…' + want.slice(Math.max(0, i - 20), i + 40) + '…" but found "…' + got.slice(Math.max(0, i - 20), i + 40) + '…".')
    }
    if (params.titleLine) {
      const title = norm(params.titleLine)
      const own = [...excerpt.querySelectorAll('*')].some((el) => !/^inline/.test(getComputedStyle(el).display) && norm(blockText(el)) === title)
      if (!own) add('medium', 'title-merged', 'The title line "' + params.titleLine + '" runs into the text; style [data-title] as its own block above the first paragraph.')
    }
    const inside = [excerpt, ...excerpt.querySelectorAll('*')].filter((el) => ownText(el) && visible(el))
    const weightOf = (el) => ownText(el).length
    const sizes = new Map()
    for (const el of inside) {
      const size = parseFloat(getComputedStyle(el).fontSize)
      sizes.set(size, (sizes.get(size) || 0) + weightOf(el))
    }
    bodySize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0
    const base = inside.slice().sort((a, b) => weightOf(b) - weightOf(a))[0]
    if (base) {
      const bs = getComputedStyle(base)
      const lineHeight = parseFloat(bs.lineHeight) || bodySize * 1.2
      const perLine = base.getBoundingClientRect().width / (bodySize * 0.5)
      metrics.body = { fontSize: round(bodySize), lineHeight: Number((lineHeight / bodySize).toFixed(2)), charsPerLine: round(perLine), color: bs.color }
      if (bodySize < params.minBodyPx - 0.5) add('high', 'body-too-small', 'The tweet body is ' + round(bodySize) + 'px; it must be at least ' + params.minBodyPx + 'px.')
      if (perLine > 78) add('medium', 'long-lines', 'Body lines run to about ' + round(perLine) + ' characters; aim for 28–60.')
      if (lineHeight / bodySize < 1.15) add('medium', 'tight-leading', 'Body line height is ' + (lineHeight / bodySize).toFixed(2) + '; use at least 1.25.')

      const colors = new Set(inside.map((el) => getComputedStyle(el).color))
      metrics.body.colors = colors.size
      if (colors.size > 2) add('medium', 'excessive-inline-colors', 'The tweet body uses ' + colors.size + ' text colours; use one, two at most.')

      const emphasised = []
      let stacked = false
      for (const el of inside) {
        if (el === base || /^H[1-6]$/.test(el.tagName) || getComputedStyle(el).display !== 'inline') continue
        const s = getComputedStyle(el)
        const flags = {
          weight: Math.abs(parseInt(s.fontWeight) - parseInt(bs.fontWeight)) >= 200,
          italic: s.fontStyle !== bs.fontStyle,
          color: s.color !== bs.color,
          background: (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || s.backgroundImage !== 'none',
          decoration: s.textDecorationLine !== 'none' && s.textDecorationLine !== bs.textDecorationLine,
        }
        if (Object.values(flags).some(Boolean)) {
          emphasised.push('"' + ownText(el).slice(0, 30) + '"')
          if ([flags.color, flags.background, flags.decoration].filter(Boolean).length >= 2) stacked = true
        }
      }
      metrics.body.emphasis = emphasised.length
      if (emphasised.length && !params.emphasisAllowed) add('medium', 'unjustified-emphasis', 'The design contract forbids randomly emphasised words, but ' + emphasised.join(', ') + ' are styled differently.')
      else if (emphasised.length > 1) add('medium', 'excessive-inline-emphasis', emphasised.length + ' phrases are emphasised (' + emphasised.join(', ') + '); at most one.')
      if (stacked) add('medium', 'stacked-emphasis', 'An emphasised phrase combines colour, highlight and/or underline; use one technique.')
    }
  }

  // Everything that carries content must be fully visible once the card has settled — an entrance
  // that never finishes would otherwise export an empty card and, being invisible, escape the
  // checks above.
  const effectiveOpacity = (el) => {
    let opacity = 1
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity)
    return opacity
  }
  for (const selector of ['[data-author]', '[data-replying]', '[data-excerpt]', '[data-quote]', '[data-meta]']) {
    const root = canvas.querySelector(selector)
    if (!root) continue
    // Every element that carries text, not just the container: an entrance on the children can
    // leave a fully opaque container holding invisible text.
    const holders = [root, ...root.querySelectorAll('*')].filter((el) => ownText(el))
    const hidden = holders.filter((el) => {
      const s = getComputedStyle(el)
      return effectiveOpacity(el) < 0.9 || s.visibility !== 'visible' || s.display === 'none'
    })
    if (hidden.length) {
      add('high', 'content-hidden', selector + ': ' + hidden.length + ' text element(s) are not fully visible once the card has settled (e.g. ' + hidden[0].tagName.toLowerCase() + ' "' + ownText(hidden[0]).slice(0, 30) + '" at opacity ' + effectiveOpacity(hidden[0]).toFixed(2) + '); every entrance must end fully visible.')
    }
  }

  // Identity, metadata and counts.
  const author = canvas.querySelector('[data-author]')
  if (!author) add('high', 'missing-author', 'There is no [data-author] element.')
  else {
    const t = norm(author.textContent)
    if (params.name && !t.includes(norm(params.name))) add('high', 'missing-author', 'The display name "' + params.name + '" is not in [data-author].')
    if (!t.includes(params.handle)) add('medium', 'missing-handle', 'The handle ' + params.handle + ' is not in [data-author].')
  }
  const meta = canvas.querySelector('[data-meta]')
  if (!meta) add('medium', 'missing-meta', 'There is no [data-meta] element for the date and counts.')
  else if (bodySize) {
    const loudest = Math.max(0, ...[...meta.querySelectorAll('*')].filter((el) => ownText(el) && visible(el)).map((el) => parseFloat(getComputedStyle(el).fontSize)))
    if (loudest >= bodySize) add('medium', 'footer-competes', 'Metadata text reaches ' + round(loudest) + 'px, as large as the ' + round(bodySize) + 'px tweet body.')
  }
  for (const m of params.metrics) {
    const el = canvas.querySelector('[data-metric="' + m.key + '"]')
    if (!el) {
      add('medium', 'missing-metric', 'There is no [data-metric="' + m.key + '"] element.')
      continue
    }
    const t = el.textContent || ''
    if (!t.toLowerCase().includes(m.label.toLowerCase())) add('medium', 'metric-label', '[data-metric="' + m.key + '"] should be labelled "' + m.label + '".')
    if (!t.replace(/\D/g, '').includes(m.value.replace(/\D/g, ''))) add('medium', 'metric-value', '[data-metric="' + m.key + '"] should show ' + m.value + '.')
  }

  // Pictures: loaded, present, and in proportion. The tweet's own are looked for on the card, so an
  // avatar reused in the artwork does not stand in for the real one.
  const allImages = [...canvas.querySelectorAll('img')]
  const images = card ? [...card.querySelectorAll('img')] : []
  const broken = allImages.filter((img) => !img.complete || !img.naturalWidth)
  if (broken.length) add('high', 'broken-image', broken.length + ' image(s) did not load: ' + broken.map((i) => i.getAttribute('data-asset') || 'inline').join(', ') + '.')
  const byAsset = (prefix) => images.find((img) => (img.getAttribute('data-asset') || '').startsWith(prefix))
  const avatar = byAsset('assets/avatar')
  if (!avatar) add('high', 'missing-avatar', 'The avatar is not on the card as an <img> of assets/avatar.*.')
  else if (visible(avatar)) {
    const r = avatar.getBoundingClientRect()
    metrics.avatar = round(r.width)
    if (r.width < 56) add('medium', 'avatar-too-small', 'The avatar is ' + round(r.width) + 'px; make it clearly visible (at least 56px).')
    if (cardRect && r.width > cardRect.width * 0.3) add('medium', 'avatar-dominant', 'The avatar is ' + round(r.width) + 'px, over 30% of the card width.')
  }
  const badge = byAsset('assets/verified')
  if (params.verified && !badge) add('medium', 'missing-badge', 'The verified badge (assets/verified.svg) is not on the card.')
  if (badge && author && visible(badge)) {
    const nameSize = Math.max(0, ...[...author.querySelectorAll('*')].filter((el) => ownText(el) && visible(el)).map((el) => parseFloat(getComputedStyle(el).fontSize)))
    const h = badge.getBoundingClientRect().height
    if (nameSize && h > nameSize * 1.4) add('medium', 'badge-oversized', 'The verified badge is ' + round(h) + 'px tall beside ' + round(nameSize) + 'px text; size it to the name (about 1–1.2× its font size).')
  }
  for (const asset of params.mediaAssets) {
    if (!images.some((img) => img.getAttribute('data-asset') === asset)) add('high', 'missing-media', asset + ' is not on the card.')
  }

  // The pipeline's own scripts — toggle.js and the vendored libraries — do not count.
  const scripts = [...document.querySelectorAll('script')].filter((s) => {
    const from = s.getAttribute('data-from') || ''
    return from !== 'toggle.js' && !from.startsWith('lib/')
  })
  if (scripts.length > 1) add('medium', 'extra-script', scripts.length + ' script(s) besides toggle.js and the libraries; use one inline script.')
  if (params.motion) {
    const css = [...document.styleSheets].map((sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText).join(' ') } catch (e) { return '' } }).join(' ')
    if (!/prefers-reduced-motion/.test(css)) add('medium', 'no-reduced-motion', 'There is no @media (prefers-reduced-motion: reduce) fallback.')
    metrics.motion = { canvases: document.querySelectorAll('[data-canvas] canvas').length, perspective: getComputedStyle(canvas).perspective }
  }

  // The artwork stays behind the tweet: nothing it draws may sit on top of the tweet's text. Its
  // layer ignores the pointer, so it is made hit-testable for the duration of the check.
  const artwork = canvas.querySelector('[data-artwork]')
  if (artwork && card) {
    const probe = document.createElement('style')
    probe.textContent = '[data-artwork], [data-artwork] * { pointer-events: auto !important; }'
    document.head.append(probe)
    const covered = []
    for (const el of textElements) {
      if (!card.contains(el)) continue
      const r = el.getBoundingClientRect()
      const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + Math.min(12, r.width / 2), r.top + r.height / 2]]
      const hidden = points.some(([x, y]) => {
        if (x < 0 || y < 0 || x > W || y > H) return false
        const hit = document.elementFromPoint(x, y)
        return hit && artwork.contains(hit)
      })
      if (hidden) covered.push(el.tagName.toLowerCase() + ' "' + ownText(el).slice(0, 30) + '"')
    }
    probe.remove()
    if (covered.length) add('high', 'artwork-covers-content', 'The artwork sits on top of ' + covered.length + ' piece(s) of the tweet: ' + covered.slice(0, 3).join('; ') + '. Keep [data-artwork] behind [data-card].')
    metrics.artwork = {
      // Decorative DOM of its own — not the insides of an SVG, not a canvas.
      elements: [...artwork.querySelectorAll('*')].filter((el) => !el.closest('svg') && el.tagName !== 'CANVAS').length,
      canvases: artwork.querySelectorAll('canvas').length,
      svgs: artwork.querySelectorAll('svg').length,
      scriptCanvases: canvas.querySelectorAll('canvas').length - artwork.querySelectorAll('canvas').length,
    }
  }

  // What the design looks like, in a few words' worth of facts — recorded so the next card can be
  // told not to repeat it (./recent.ts).
  const style = (el) => (el ? getComputedStyle(el) : null)
  const cs = style(canvas)
  const ks = style(card)
  const bodyEl = canvas.querySelector('[data-excerpt] p') || canvas.querySelector('[data-quote] p')
  metrics.design = {
    canvas: { color: cs.backgroundColor, image: cs.backgroundImage === 'none' ? null : cs.backgroundImage.slice(0, 120) },
    card: ks ? { color: ks.backgroundColor, image: ks.backgroundImage === 'none' ? null : ks.backgroundImage.slice(0, 120), radius: ks.borderRadius, border: ks.borderTopWidth + ' ' + ks.borderTopColor, shadow: ks.boxShadow !== 'none' } : null,
    text: bodyEl ? { color: getComputedStyle(bodyEl).color, font: getComputedStyle(bodyEl).fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: round(parseFloat(getComputedStyle(bodyEl).fontSize)) } : null,
    artwork: metrics.artwork || null,
  }

  // See more / See less: present, visible, and actually working.
  const button = canvas.querySelector('[data-toggle]')
  const full = canvas.querySelector('[data-full]')
  if (params.truncated) {
    if (!button || !full) add('high', 'missing-see-more', 'The excerpt is truncated but [data-toggle] or [data-full] is missing.')
    else {
      const r = button.getBoundingClientRect()
      const within = cardRect ? r.top >= cardRect.top - 1 && r.bottom <= cardRect.bottom + 1 : r.bottom <= c.bottom
      if (!visible(button) || !within) add('high', 'see-more-hidden', 'The See more button is not fully visible inside the card.')
      button.click()
      const opened = full.offsetHeight > 0 && (full.textContent || '').length >= params.fullLength * 0.9 && canvas.classList.contains('expanded')
      metrics.expandedHeight = round(canvas.getBoundingClientRect().height)
      button.click()
      const closed = full.offsetHeight === 0 && !canvas.classList.contains('expanded')
      if (!opened || !closed) add('high', 'toggle-broken', 'See more / See less does not expand to the full text and back (opened: ' + opened + ', closed: ' + closed + ').')
    }
  } else if (button) add('low', 'unneeded-see-more', 'The tweet is not truncated, so there should be no See more button.')

  return { issues, metrics }
}`

/**
 * Brings every finite animation to its end state — CSS and Web Animations, and GSAP tweens, which
 * run on GSAP's own clock and are invisible to document.getAnimations(). Repeating ones (an ambient
 * field, a looping scene) are left running.
 */
export const FINISH_ANIMATIONS = `(() => {
  for (const animation of document.getAnimations()) {
    const timing = animation.effect && animation.effect.getComputedTiming ? animation.effect.getComputedTiming() : null
    if (timing && timing.iterations !== Infinity) animation.finish()
  }
  const gsap = window.gsap
  if (gsap && gsap.globalTimeline && gsap.globalTimeline.getChildren) {
    for (const tween of gsap.globalTimeline.getChildren(true, true, true)) {
      if (typeof tween.repeat === 'function' && tween.repeat() === -1) continue
      try { tween.progress(1) } catch (e) {}
    }
  }
  return true
})()`
