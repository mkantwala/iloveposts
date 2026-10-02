/**
 * Secrets, which `wrangler types` cannot generate: they are set with `wrangler secret put` (or a
 * local .dev.vars) and carry values, so they never appear in wrangler.jsonc. Declaration-merged
 * into the generated `Env` in ../worker-configuration.d.ts.
 *
 * Only the opencode agent needs them (src/card/engines.ts) — the direct designer uses the AI binding.
 * The token is attached at egress by the Worker; it never enters the container.
 */
interface Env {
  /** Cloudflare account id that owns the Workers AI models. */
  CF_ACCOUNT_ID?: string
  /** API token with Workers AI Read and Edit permissions (see docs/self-hosting.md). */
  CF_API_TOKEN?: string
}
