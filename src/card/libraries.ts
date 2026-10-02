/**
 * The JavaScript libraries a Motion & 3D card may use.
 *
 * They are built into the sandbox image (see the Dockerfile), copied into output/lib/ for motion
 * cards, and inlined by ./bundle.ts like any other local file — so a card that uses Three.js still
 * renders offline, exports deterministically and passes the export's no-network CSP. Nothing else
 * can be loaded: an arbitrary package would mean fetching code at build or view time.
 */
export const CARD_LIBRARIES = {
  three: { path: 'lib/three.js', global: 'THREE', version: '0.186.1', use: '3D scenes in WebGL: geometry, lights, materials, shaders, particles' },
  gsap: { path: 'lib/gsap.js', global: 'gsap', version: '3.15.0', use: 'timelines and easing for entrances, count-ups and choreographed motion' },
} as const

export type LibraryName = keyof typeof CARD_LIBRARIES

/** Where the image keeps them. */
export const LIBRARY_DIR = '/opt/card-libs'

/** The libraries a page loads, in their canonical order, from its <script src="lib/…"> tags. */
export function librariesIn(html: string): LibraryName[] {
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?(?:\.\/)?([^"'\s>]+)/gi)].map((m) => m[1])
  return (Object.keys(CARD_LIBRARIES) as LibraryName[]).filter((name) => srcs.includes(CARD_LIBRARIES[name].path))
}
