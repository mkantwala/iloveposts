/**
 * The typefaces a card can use, embedded — so the PNG looks the way the card was designed.
 *
 * Cards are rendered and exported by Browser Rendering, a Linux Chromium with none of the Apple or
 * Windows fonts a system stack names, so a font a card wants has to travel with it. Eight
 * open-licence variable families are fetched by the Worker (never by the card, which stays
 * offline), cached in KV and written into output/fonts/, one stylesheet per family. The agent
 * links the families it chooses; ./bundle.ts inlines only those, so an unused family costs nothing.
 *
 * Which family, and how it is set, is the agent's decision. This is only what is on the shelf.
 */
export const FONT_LIBRARY = {
  inter: { family: 'Inter', kind: 'sans — neutral, precise, the X interface feel', query: 'Inter:ital,opsz,wght@0,14..32,300..800;1,14..32,300..800' },
  'source-sans-3': { family: 'Source Sans 3', kind: 'sans — humanist, warm, very readable', query: 'Source+Sans+3:ital,wght@0,300..800;1,300..800' },
  manrope: { family: 'Manrope', kind: 'sans — geometric, modern, rounded', query: 'Manrope:wght@300..800' },
  'space-grotesk': { family: 'Space Grotesk', kind: 'sans — technical, characterful', query: 'Space+Grotesk:wght@300..700' },
  'source-serif-4': { family: 'Source Serif 4', kind: 'serif — editorial, calm, long-form', query: 'Source+Serif+4:ital,opsz,wght@0,8..60,300..800;1,8..60,300..800' },
  fraunces: { family: 'Fraunces', kind: 'serif — expressive display with soft character', query: 'Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..800' },
  'eb-garamond': { family: 'EB Garamond', kind: 'serif — classical, literary', query: 'EB+Garamond:ital,wght@0,400..800;1,400..800' },
  'jetbrains-mono': { family: 'JetBrains Mono', kind: 'mono — code, data, terminal', query: 'JetBrains+Mono:ital,wght@0,300..800;1,300..800' },
} as const

export type FontSlug = keyof typeof FONT_LIBRARY

/** The stylesheet for a family, relative to output/. */
export const fontHref = (slug: FontSlug) => `fonts/${slug}.css`

/** Scripts kept. Others fall back to the browser's own fonts rather than bloating every card. */
const SUBSETS = new Set(['latin', 'latin-ext'])

/** Google serves woff2 with unicode-range only to a browser that says it supports them. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export interface FontFile {
  /** Relative to output/. */
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

/** Every family, as output/fonts/<slug>.css plus its woff2 files. A family that cannot be fetched
 *  is left out and logged; a card that links it falls back to the browser's default. */
export async function loadFontLibrary(cache: KVNamespace): Promise<FontFile[]> {
  const perFamily = await Promise.all(
    (Object.keys(FONT_LIBRARY) as FontSlug[]).map(async (slug) => {
      try {
        const files: FontFile[] = []
        const rules: string[] = []
        for (const [i, block] of (await faceBlocks(slug)).entries()) {
          const url = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1]
          if (!url) continue
          const bytes = await cachedFetch(cache, url)
          if (!bytes) continue
          const file = `${slug}-${i + 1}.woff2`
          files.push({ path: `fonts/${file}`, content: base64(new Uint8Array(bytes)), encoding: 'base64' })
          // Relative to the stylesheet, which sits beside its files in fonts/.
          rules.push(block.replace(url, file))
        }
        return rules.length ? [{ path: fontHref(slug), content: rules.join('\n'), encoding: 'utf-8' as const }, ...files] : []
      } catch (err) {
        console.log(`fonts      ${slug} unavailable (${err instanceof Error ? err.message : String(err)})`)
        return []
      }
    }),
  )
  return perFamily.flat()
}

/** The families a page links, from its <link href="fonts/<slug>.css"> tags. */
export function fontsIn(html: string): FontSlug[] {
  const hrefs = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']?(?:\.\/)?([^"'\s>]+)/gi)].map((m) => m[1])
  return (Object.keys(FONT_LIBRARY) as FontSlug[]).filter((slug) => hrefs.includes(fontHref(slug)))
}

/** The shelf, as the brief describes it. */
export function fontLibraryMarkdown(): string {
  return (Object.entries(FONT_LIBRARY) as Array<[FontSlug, (typeof FONT_LIBRARY)[FontSlug]]>)
    .map(([slug, f]) => `- "${f.family}" — ${f.kind}. Link: <link rel="stylesheet" href="${fontHref(slug)}">`)
    .join('\n')
}

/** The @font-face blocks for one family, latin subsets only. */
async function faceBlocks(slug: FontSlug): Promise<string[]> {
  const response = await fetch(`https://fonts.googleapis.com/css2?family=${FONT_LIBRARY[slug].query}&display=block`, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const css = await response.text()
  return [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)].filter((m) => SUBSETS.has(m[1])).map((m) => m[2])
}

/** Font files never change at a given URL, so they are cached without expiry. */
async function cachedFetch(cache: KVNamespace, url: string): Promise<ArrayBuffer | null> {
  const key = `fonts:v1:${url.replace(/^https:\/\/fonts\.gstatic\.com\//, '')}`
  const hit = await cache.get(key, 'arrayBuffer').catch(() => null)
  if (hit) return hit
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) return null
  const bytes = await response.arrayBuffer()
  await cache.put(key, bytes).catch(() => {})
  return bytes
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
