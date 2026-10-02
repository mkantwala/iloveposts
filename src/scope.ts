/**
 * Who a card belongs to.
 *
 * Used to key per-caller state that is not a card of its own: the rate limit and idempotency keys
 * in ./api/cards.ts.
 *
 * It is derived from the caller's IP, hashed. The hash is not for secrecy — an IP is not a secret
 * worth protecting here — but because it ends up in a URL, and a URL that carries a visitor's raw
 * address is a needless thing to hand out and log.
 */

/** Cloudflare sets this on every request at the edge. Absent under `wrangler dev`, where a single
 *  local scope is exactly right. */
const IP_HEADER = 'CF-Connecting-IP'

export async function scopeFor(request: Request): Promise<string> {
  const ip = request.headers.get(IP_HEADER)?.trim()
  if (!ip) return 'local'

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return [...new Uint8Array(digest)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
