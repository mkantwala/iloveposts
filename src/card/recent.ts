/**
 * Recent designs: what the last few cards looked like, so the next one does not look the same.
 *
 * Left alone, a model converges on one safe look — a dark background, a dark card, white text, one
 * accent — and every card comes out as a variation of it. After each export the measured design
 * (metrics.design from ./measure.ts) is described in plain words and kept in KV; the designer is
 * shown the list and told not to repeat its palette, background treatment, composition or motif.
 *
 * The description is computed from the render, not asked of a model, so it is what the card
 * actually looks like.
 */
const KEY = 'designs:recent:v1'
const KEEP = 6

interface Measured {
  canvas?: { color?: string; image?: string | null }
  card?: { color?: string; image?: string | null; radius?: string; border?: string; shadow?: boolean } | null
  text?: { color?: string; font?: string; size?: number } | null
  artwork?: { elements?: number; canvases?: number; svgs?: number; scriptCanvases?: number } | null
}

interface Entry {
  at: string
  description: string
}

export async function recentDesigns(cache: KVNamespace): Promise<string[]> {
  const list = await cache.get<Entry[]>(KEY, 'json').catch(() => null)
  return (list ?? []).map((e) => e.description)
}

export async function rememberDesign(cache: KVNamespace, metrics: Record<string, unknown> | null | undefined): Promise<void> {
  const design = metrics?.design as Measured | undefined
  if (!design) return
  const description = describeDesign(design)
  const list = (await cache.get<Entry[]>(KEY, 'json').catch(() => null)) ?? []
  await cache.put(KEY, JSON.stringify([{ at: new Date().toISOString(), description }, ...list].slice(0, KEEP))).catch(() => {})
}

/** context/recent.md, and the same section of the direct designer's prompt. */
export function recentMarkdown(recent: string[]): string {
  if (!recent.length) return '# Recent designs\n\nNone yet — this is the first card. Still avoid the defaults listed in the brief.\n'
  return [
    '# Recent designs',
    '',
    'The last cards made, most recent first. Yours must not substantially repeat their dominant',
    'palette, background treatment, composition or decorative motif.',
    '',
    ...recent.map((d, i) => `${i + 1}. ${d}`),
    '',
  ].join('\n')
}

export function describeDesign(d: Measured): string {
  const parts: string[] = []
  const canvas = colour(d.canvas?.color)
  const gradient = kindOf(d.canvas?.image)
  if (canvas) parts.push(`${canvas} background${gradient ? ` with a ${gradient}` : ''}`)
  else parts.push(gradient ? `${gradient} background` : 'background drawn by the artwork')

  const card = colour(d.card?.color)
  const cardImage = kindOf(d.card?.image)
  if (card) parts.push(`${card} card${cardImage ? ` (${cardImage})` : ''}${d.card?.shadow ? ', shadowed' : ''}${d.card?.radius && parseFloat(d.card.radius) >= 20 ? ', strongly rounded' : ''}`)
  else parts.push('no card surface — the text sits on the artwork')

  const text = colour(d.text?.color)
  if (text || d.text?.font) parts.push(`${text ? `${text} ` : ''}text in ${d.text?.font ?? 'an unknown face'}`)

  const art = d.artwork
  const motifs = [art?.canvases || art?.scriptCanvases ? 'canvas artwork' : '', art?.svgs ? 'SVG artwork' : '', art?.elements ? 'decorative shapes' : ''].filter(Boolean)
  parts.push(motifs.length ? motifs.join(', ') : 'no artwork')
  return parts.join('; ')
}

/** "radial gradient", "linear gradient", "image" — or null for none. */
function kindOf(image: string | null | undefined): string | null {
  if (!image) return null
  const kind = image.match(/(repeating-)?(linear|radial|conic)-gradient/)
  if (kind) return `${kind[1] ? 'repeating ' : ''}${kind[2]} gradient`
  return /url\(/.test(image) ? 'image' : null
}

/** A computed colour, in words: "very dark navy", "light warm grey". Null when transparent. */
export function colour(css: string | undefined): string | null {
  const m = css?.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  if (alpha < 0.15) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  let h = 0
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / (max - min) + 2) * 60
    else h = ((r - g) / (max - min) + 4) * 60
  }
  const lightness = l < 0.1 ? 'near-black' : l < 0.25 ? 'very dark' : l < 0.42 ? 'dark' : l < 0.62 ? 'mid-tone' : l < 0.86 ? 'light' : 'near-white'
  if (s < 0.12) return lightness === 'near-black' || lightness === 'near-white' ? lightness : `${lightness} neutral grey`
  const hues: Array<[number, string]> = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [90, 'lime'], [150, 'green'], [190, 'teal'], [215, 'sky blue'], [245, 'blue'], [270, 'indigo'], [300, 'purple'], [335, 'pink'], [360, 'red']]
  const hue = hues.find(([limit]) => h < limit)?.[1] ?? 'red'
  return `${lightness} ${s < 0.3 ? 'muted ' : ''}${hue}`
}
