/**
 * The agent's output/ directory, folded into one self-contained HTML document.
 *
 * Stylesheets and the toggle script are inlined, and every local file an attribute or a CSS url()
 * points at becomes a data: URI. The result renders identically in the remote browser that checks
 * it, in the stored export, and offline — and needs no sandbox once it exists, which is what lets
 * the sandbox be destroyed as soon as a card is finished.
 *
 * Pictures keep their original path in data-asset, so the QA can still tell the avatar from the
 * badge after their src has become a data URI.
 */
export interface OutputFile {
  /** Relative to output/. */
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
  mime: string
}

export interface Bundle {
  html: string
  /** Local references that pointed at nothing. */
  missing: string[]
  /** http(s) references — forbidden on a card, and blocked by the export's CSP anyway. */
  remote: string[]
}

export function bundle(files: OutputFile[]): Bundle | null {
  const byPath = new Map(files.map((f) => [normalize(f.path), f]))
  const index = byPath.get('index.html')
  if (!index) return null

  const missing = new Set<string>()
  const remote = new Set<string>()

  const dataUri = (ref: string, from: string): string | null => {
    if (/^(data:|#|about:)/i.test(ref)) return null
    if (/^(https?:)?\/\//i.test(ref)) {
      remote.add(ref)
      return null
    }
    const file = byPath.get(resolve(from, ref))
    if (!file) {
      missing.add(ref)
      return null
    }
    const body = file.encoding === 'base64' ? file.content : utf8Base64(file.content)
    return `data:${file.mime};base64,${body}`
  }

  const inlineCss = (css: string, from: string): string =>
    css
      .replace(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?\s*;/gi, (whole, ref: string): string => {
        const file = byPath.get(resolve(from, ref))
        if (!file) {
          if (/^(https?:)?\/\//i.test(ref)) remote.add(ref)
          else missing.add(ref)
          return ''
        }
        return inlineCss(file.content, file.path)
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q, ref: string) => {
        const uri = dataUri(ref.trim(), from)
        return uri ? `url("${uri}")` : whole
      })

  let html = index.content

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag
    const href = attr(tag, 'href')
    if (!href) return tag
    if (/^(https?:)?\/\//i.test(href)) {
      remote.add(href)
      return ''
    }
    const file = byPath.get(resolve('index.html', href))
    if (!file) {
      missing.add(href)
      return ''
    }
    return `<style data-from="${escapeAttr(normalize(href))}">\n${inlineCss(file.content, file.path).replace(/<\/style/gi, '<\\/style')}\n</style>`
  })

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const src = attr(`<x ${attrs}>`, 'src')
    if (!src) return tag
    if (/^(https?:)?\/\//i.test(src)) {
      remote.add(src)
      return ''
    }
    const file = byPath.get(resolve('index.html', src))
    if (!file) {
      missing.add(src)
      return ''
    }
    return `<script data-from="${escapeAttr(normalize(src))}">\n${file.content.replace(/<\/script/gi, '<\\/script')}\n</script>`
  })

  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (tag, css: string) => tag.replace(css, () => inlineCss(css, 'index.html')))

  html = html.replace(/\b(src|poster|href)\s*=\s*(["'])([^"']*)\2/gi, (whole, name: string, q: string, ref: string) => {
    if (name.toLowerCase() === 'href') return whole
    const uri = dataUri(ref.trim(), 'index.html')
    return uri ? `${name}=${q}${uri}${q} data-asset=${q}${escapeAttr(normalize(ref))}${q}` : whole
  })

  html = html.replace(/\bstyle\s*=\s*(["'])([^"']*)\1/gi, (whole, q: string, css: string) => `style=${q}${inlineCss(css, 'index.html')}${q}`)

  return { html, missing: [...missing], remote: [...remote] }
}

function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i'))?.[1] ?? null
}

function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('?')[0].split('#')[0].split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** A reference, resolved against the file it appears in. */
function resolve(from: string, ref: string): string {
  if (ref.startsWith('/')) return normalize(ref)
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
  return normalize(dir + ref)
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;')
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
