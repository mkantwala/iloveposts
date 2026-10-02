import { Sandbox as BaseSandbox } from '@cloudflare/sandbox'
import type { OutboundHandlerContext } from '@cloudflare/containers'

/** One model call, as Workers AI reported it: `usage` is the response's usage object verbatim, with
 *  the totals alongside. */
export interface UsageEntry {
  model: string
  path: string
  at: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  usage: Record<string, unknown>
}

/** Passed by `setOutboundByHost`. The handler runs in the proxy's context, not the project's, so
 *  this is the only way it knows who made the call: `project` is where usage is reported, and
 *  `session` is the run's id, sent as `x-session-affinity`. */
type WorkersAiParams = { project?: string; session?: string }

/**
 * The sandbox, with an egress handler that holds the credentials the container never sees.
 *
 * Setting a real token as an environment variable inside the sandbox hands it to every process in
 * there — including code an agent wrote, and anything that code chooses to install. A leak needs
 * no exploit, just one `env | curl`.
 *
 * So the sandbox gets a placeholder, and the real token is attached on the way out, by a handler
 * that runs in the Workers runtime rather than in the container. This is Cloudflare's own
 * recommendation for exactly this problem — see
 * https://developers.cloudflare.com/sandbox/guides/outbound-traffic/ — and the credential lives in
 * `env`, which untrusted code has no path to.
 *
 * Scoped by host: only requests to Workers AI are rewritten. Anything else the container talks to
 * is left alone and carries the placeholder, which is worth nothing anywhere.
 */
export class Sandbox extends BaseSandbox<Env> {
  // Without this only plain HTTP is intercepted, and every request worth protecting is HTTPS —
  // the handler simply never runs and the placeholder goes out to the real API. Turning it on
  // makes the runtime terminate TLS in the sidecar with a per-instance ephemeral CA, whose private
  // key never enters the container.
  interceptHttps = true
}

Sandbox.outboundHandlers = {
  /** Swaps the placeholder for the real Workers AI token, reports what went out, and records the
   *  tokens that came back. */
  workersAi: async (request: Request, env: Env, ctx: OutboundHandlerContext<WorkersAiParams>) => {
    const token = env.CF_API_TOKEN?.trim()
    const url = new URL(request.url)
    const refused = await overBudget(env, ctx.params?.project)
    if (refused) return refused

    // Logged for now so the interception is observable: which requests were caught, and whether a
    // credential was actually attached. Never the token itself.
    console.log(`outbound → ${request.method} ${url.host}${url.pathname} (token ${token ? 'injected' : 'MISSING'})`)

    const headers = new Headers(request.headers)
    if (token) headers.set('authorization', `Bearer ${token}`)

    // Every step of a run resends the whole conversation, so consecutive requests share almost all
    // of their prompt. Pinning a run to one model instance lets Workers AI reuse that prefix
    // instead of recomputing it; the response's usage.prompt_tokens_details.cached_tokens shows
    // whether it did.
    if (ctx.params?.session) headers.set('x-session-affinity', ctx.params.session)

    // Read once: a request body is a stream that can only be consumed once.
    const raw = request.body ? await request.text() : null
    const body = parseJson(raw)
    if (body) logPayload(body)

    // Token counts only exist on the response. A streamed completion carries them in its final
    // chunk, and only when asked to — so ask, rather than depend on the client having done so.
    let forwardBody = raw
    if (body?.stream === true) {
      body.stream_options = { ...(body.stream_options as object | undefined), include_usage: true }
      forwardBody = JSON.stringify(body)
      headers.delete('content-length')
    }

    const response = await fetch(new Request(request.url, { method: request.method, headers, body: forwardBody }))

    const model = typeof body?.model === 'string' ? body.model : '?'
    const report = (usage: Record<string, unknown>) => recordUsage(env, ctx.params?.project, model, url.pathname, usage)

    const type = response.headers.get('content-type') ?? ''
    if (type.includes('text/event-stream') && response.body) {
      return new Response(response.body.pipeThrough(usageTap(report)), response)
    }
    if (type.includes('application/json')) {
      const usage = parseJson(await response.clone().text().catch(() => null))?.usage
      if (usage && typeof usage === 'object') await report(usage as Record<string, unknown>)
    }
    return response
  },
}

/**
 * Passes an SSE stream through untouched while watching it for `usage`. The last chunk that carries
 * one wins, which is right whether the model reports once at the end or cumulatively on every
 * chunk. Reported on flush, so the numbers are final.
 */
function usageTap(report: (usage: Record<string, unknown>) => Promise<void>): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ''
  let usage: Record<string, unknown> | null = null

  const scan = (line: string) => {
    if (!line.startsWith('data:')) return
    const event = parseJson(line.slice(5).trim())
    const found = event?.usage
    if (found && typeof found === 'object') usage = found as Record<string, unknown>
  }

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(scan)
    },
    async flush() {
      scan(buffer)
      if (usage) await report(usage)
    },
  })
}

/**
 * The agent's turn budget, enforced where it cannot be argued with: every model call the agent makes
 * passes through here, so once the run's allowance is spent (CardJob.admitModelCall) the request is
 * refused with a 400 — which the agent's SDK does not retry — and the run ends with whatever it has
 * written. An unreachable job admits the call rather than breaking the run.
 */
async function overBudget(env: Env, project: string | undefined): Promise<Response | null> {
  if (!project) return null
  try {
    const admitted = await env.CARD_JOBS.get(env.CARD_JOBS.idFromString(project)).admitModelCall()
    if (admitted) return null
  } catch {
    return null
  }
  console.log('outbound   refused: the run has used its model-call budget')
  return Response.json({ error: { code: 400, message: 'Model-call budget for this card is spent. Stop now.', status: 'INVALID_ARGUMENT' } }, { status: 400 })
}

/** Logs the call and hands it to the CardJob that started the run. Never throws: losing a
 *  usage record must not break the agent's request. */
async function recordUsage(env: Env, project: string | undefined, model: string, path: string, usage: Record<string, unknown>): Promise<void> {
  const entry: UsageEntry = {
    model,
    path,
    at: new Date().toISOString(),
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    usage,
  }
  console.log(`usage      model=${model} prompt=${entry.promptTokens} completion=${entry.completionTokens} total=${entry.totalTokens} ${JSON.stringify(usage)}`)

  if (!project) return
  try {
    await env.CARD_JOBS.get(env.CARD_JOBS.idFromString(project)).recordUsage(entry)
  } catch (err) {
    console.log('usage      could not reach the project:', err instanceof Error ? err.message : String(err))
  }
}

function parseJson(text: string | null): Record<string, any> | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Prints what the agent actually asked the model for.
 *
 * The prompt is assembled inside the container, out of files the agent chose to read, so this is
 * the only place the real request can be seen — the Worker never composes it. Truncated per
 * message, because a full tweet plus art direction runs to tens of kilobytes and would bury
 * everything else in the log.
 */
function logPayload(body: {
  model?: string
  max_tokens?: number
  messages?: Array<{ role?: string; content?: unknown }>
}): void {
  try {
    console.log(`outbound   model=${body.model ?? '?'} max_tokens=${body.max_tokens ?? '(default)'}`)

    for (const message of body.messages ?? []) {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      const oneLine = content.replace(/\s+/g, ' ').trim()
      console.log(`outbound   [${message.role}] ${oneLine.slice(0, 600)}${oneLine.length > 600 ? ` … (${oneLine.length} chars)` : ''}`)
    }
  } catch {
    // Unexpected shape — nothing to report, and this must never break the request.
  }
}
