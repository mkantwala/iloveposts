import type { Tweet } from '../twitter/tweet'

/**
 * The tweet's real pictures, fetched by the Worker and handed to the agent as local files.
 *
 * The card must not load anything remote — it has to render offline and export cleanly — so an
 * agent told "no remote URLs" and given only URLs either leaves the avatar out or draws a stand-in.
 * Downloading here means the card always shows the actual avatar, badge and media, and the agent
 * never needs network access to get them.
 *
 * Videos and GIFs contribute their poster frame: a still card cannot play them.
 */

/** Written into output/, so the paths are the ones index.html uses. */
const DIR = 'assets'

const FETCH_TIMEOUT_MS = 15_000

/** Well past any avatar or tweet photo; a guard against a proxy serving something huge. */
const MAX_BYTES = 8 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

export interface AssetFile {
  /** Relative to output/, as index.html references it. */
  path: string
  /** Base64 or UTF-8 content, matching `encoding`. */
  content: string
  encoding: 'base64' | 'utf-8'
  /** What it is, for the Assets section of context/tweet.md. */
  label: string
  mime: string
  /** Pixel size, read from the file's header, when it is a raster image. */
  width?: number
  height?: number
}

/** Every picture the tweet has, as files. Anything that fails to download is left out, not faked. */
export async function tweetAssets(tweet: Tweet): Promise<AssetFile[]> {
  const jobs: Array<Promise<AssetFile | null>> = []

  if (tweet.author.avatar) jobs.push(download(tweet.author.avatar, 'avatar', 'Author avatar'))
  if (tweet.author.verifiedBadge) jobs.push(Promise.resolve(badge(tweet.author.verifiedBadge, 'verified', 'Verified badge')))
  tweet.media.forEach((m, i) =>
    jobs.push(download(still(m), `media-${i + 1}`, `Media ${i + 1} (${m.type}${m.type === 'image' ? '' : ', poster frame'})`)),
  )

  if (tweet.quote) {
    const q = tweet.quote
    if (q.author.avatar) jobs.push(download(q.author.avatar, 'quote-avatar', 'Quoted author avatar'))
    if (q.author.verifiedBadge) jobs.push(Promise.resolve(badge(q.author.verifiedBadge, 'quote-verified', 'Quoted author verified badge')))
    q.media.forEach((m, i) =>
      jobs.push(download(still(m), `quote-media-${i + 1}`, `Quoted media ${i + 1} (${m.type}${m.type === 'image' ? '' : ', poster frame'})`)),
    )
  }

  return (await Promise.all(jobs)).filter((a): a is AssetFile => a !== null)
}

/** The Assets section appended to context/tweet.md, so the agent knows exactly which files exist. */
export function assetsMarkdown(assets: AssetFile[]): string {
  const lines = assets.length > 0 ? assets.map((a) => `- ${a.label}: ${a.path}${a.width && a.height ? ` — ${a.width}×${a.height}px` : ''}`) : ['No images']
  return [
    '',
    '## Assets',
    '',
    'Local files in output/, referenced from index.html by these paths. Use these for every picture',
    'on the card — never the URLs above, and never a stand-in.',
    '',
    ...lines,
    '',
  ].join('\n')
}

function still(media: Tweet['media'][number]): string {
  return media.type === 'image' ? media.url : (media.thumbnail ?? media.url)
}

/** The badge is already an SVG data URI, generated from the tweet's verification type. */
function badge(dataUri: string, name: string, label: string): AssetFile | null {
  const comma = dataUri.indexOf(',')
  if (comma < 0) return null
  return { path: `${DIR}/${name}.svg`, content: decodeURIComponent(dataUri.slice(comma + 1)), encoding: 'utf-8', label, mime: 'image/svg+xml' }
}

async function download(url: string, name: string, label: string): Promise<AssetFile | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const extension = EXTENSIONS[type]
    if (!response.ok || !extension) {
      console.log(`asset skipped: ${label} — HTTP ${response.status} ${type || '(no type)'}`)
      return null
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) {
      console.log(`asset skipped: ${label} — ${bytes.byteLength} bytes`)
      return null
    }
    return { path: `${DIR}/${name}.${extension}`, content: base64(bytes), encoding: 'base64', label, mime: type, ...imageSize(bytes) }
  } catch (err) {
    console.log(`asset skipped: ${label} — ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Width and height from a PNG, GIF, WebP or JPEG header; nothing for anything else. */
export function imageSize(b: Uint8Array): { width?: number; height?: number } {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1]
  const le16 = (i: number) => b[i] | (b[i + 1] << 8)
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  if (b[0] === 0x89 && b[1] === 0x50) return { width: u32(16), height: u32(20) }
  if (b[0] === 0x47 && b[1] === 0x49) return { width: le16(6), height: le16(8) }
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
    if (kind === 'VP8L') return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the first start-of-frame marker, which carries the size.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return {}
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) }
      i += 2 + u16(i + 2)
    }
  }
  return {}
}

/** Chunked, because spreading a multi-megabyte array into String.fromCharCode overflows the stack. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
