import type { FontSlug } from './fonts'
import type { CardFormat } from './formats'

/**
 * The house design: a restrained, known-good design for the tweet markup, used when the agent's
 * best version still has high-severity problems after its repair pass.
 *
 * Two layers and nothing else — a soft background and the tweet card floating on it — set in Inter
 * with generous spacing. It passes the browser QA in every format, static and Motion & 3D, so a card
 * is never shipped with its text off the canvas because a model could not lay it out.
 */
export function houseDesign(format: CardFormat, motion: boolean): { css: string; js: string; fonts: FontSlug[] } {
  const width = Math.round(((format.cardWidth.min + format.cardWidth.max) / 2) * 100)
  const wide = format.width > format.height * 1.4
  const u = format.scale
  const px = (n: number) => `${Math.round(n * u)}px`
  const body = Math.max(Math.round(34 * u), format.minBodyPx)
  const small = Math.max(Math.round(20 * u), format.minTextPx)
  // A short canvas has no height to spare: the quote is set at the small size, pictures lower.
  const quoteText = wide ? small : Math.max(Math.round(24 * u), small)

  const css = `[data-canvas] {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #f6f1ea 0%, #efe9f4 55%, #e6eef6 100%);
  color: #14171a; font-family: "Inter", system-ui, sans-serif;
  ${motion ? 'perspective: 1400px;' : ''}
}
[data-card] {
  position: relative; width: ${width}%;
  background: #ffffff; border-radius: ${px(28)};
  box-shadow: 0 ${px(2)} ${px(4)} rgb(20 23 26 / 0.04), 0 ${px(22)} ${px(60)} rgb(20 23 26 / 0.10);
  padding: ${wide ? `${px(40)} ${px(48)}` : `${px(52)} ${px(56)}`};
  ${motion ? 'transform-style: preserve-3d; transition: transform .5s cubic-bezier(.2,.7,.2,1);' : ''}
}
[data-author] { display: flex; align-items: center; gap: ${px(16)}; }
[data-author] [data-avatar] { width: ${px(wide ? 60 : 72)}; height: ${px(wide ? 60 : 72)}; }
[data-author] .name { font-size: ${Math.max(Math.round(26 * u), small)}px; font-weight: 700; letter-spacing: -0.01em; }
[data-author] .handle, [data-quote-author] .handle { font-size: ${small}px; color: #536471; margin-top: ${px(2)}; }
[data-replying] { margin: ${px(wide ? 12 : 18)} 0 0; font-size: ${small}px; color: #536471; }
[data-replying] span { color: #1d9bf0; }
[data-excerpt] { margin-top: ${wide ? px(22) : px(28)}; }
[data-excerpt] p, [data-full] p { font-size: ${body}px; line-height: 1.38; letter-spacing: -0.012em; margin: 0 0 ${px(14)}; }
[data-excerpt] [data-title] { font-weight: 700; }
[data-excerpt] p:last-child { margin-bottom: 0; }
[data-full] { margin-top: ${wide ? px(22) : px(28)}; }
[data-full] .lead { font-weight: 700; }
[data-toggle] { margin-top: ${px(14)}; font: 600 ${small}px "Inter", system-ui, sans-serif; background: none; border: 0; padding: 0; color: #1d9bf0; cursor: pointer; }
[data-media] { margin-top: ${px(wide ? 16 : 22)}; border-radius: ${px(18)}; overflow: hidden; border: 1px solid #e6ecf0; }
[data-media] img { max-height: ${Math.round(format.height * (wide ? 0.3 : 0.34))}px; }
[data-quote] { margin: ${px(wide ? 16 : 22)} 0 0; padding: ${px(wide ? 14 : 18)} ${px(22)}; border: 1px solid #e1e8ed; border-radius: ${px(18)}; }
[data-quote-author] { display: flex; align-items: center; gap: ${px(10)}; }
[data-quote-author] [data-avatar] { width: ${px(32)}; height: ${px(32)}; }
[data-quote-author] .identity { display: flex; align-items: baseline; gap: ${px(8)}; }
[data-quote-author] .name { font-size: ${small}px; font-weight: 700; }
[data-quote] > p { margin: ${px(8)} 0 0; font-size: ${quoteText}px; line-height: 1.4; }
[data-quote-media] { margin: ${px(12)} 0 0; border-radius: ${px(12)}; overflow: hidden; }
[data-quote-media] img { max-height: ${Math.round(format.height * (wide ? 0.12 : 0.18))}px; }
[data-meta] {
  margin-top: ${px(wide ? 16 : 24)}; padding-top: ${px(wide ? 12 : 18)}; border-top: 1px solid #eff3f4;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: ${px(8)} ${px(24)};
  font-size: ${small}px; color: #536471;
}
[data-meta] .metrics { display: contents; list-style: none; margin: 0; padding: 0; }
[data-meta] li { display: inline; }
[data-meta] strong { color: #14171a; font-weight: 700; }
${
  motion
    ? `@keyframes house-in { from { opacity: 0; translate: 0 14px; } to { opacity: 1; translate: 0 0; } }
[data-card] > * { animation: house-in .8s cubic-bezier(.2,.7,.2,1) both; }
[data-card] > :nth-child(2) { animation-delay: .15s; }
[data-card] > :nth-child(3) { animation-delay: .3s; }
[data-card] > :nth-child(n+4) { animation-delay: .45s; }
@media (prefers-reduced-motion: reduce) {
  [data-card] > * { animation: none; }
  [data-card] { transition: none; transform: none !important; }
}`
    : ''
}`

  const js = motion
    ? `(() => {
  const stage = document.querySelector('[data-canvas]')
  const card = document.querySelector('[data-card]')
  if (!stage || !card || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    card.style.transform = 'rotateX(' + (-y * 6).toFixed(2) + 'deg) rotateY(' + (x * 8).toFixed(2) + 'deg)'
  })
  stage.addEventListener('pointerleave', () => { card.style.transform = '' })
})()`
    : ''

  return { css, js, fonts: ['inter'] }
}
