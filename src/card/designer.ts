import type { AssetFile } from '../api/assets'
import type { UsageEntry } from '../api/sandbox'
import { DIRECT_OUTPUT, designContract } from '../markdown/agents'
import type { ModelSpec } from './engines'
import type { CardFormat } from './formats'

/**
 * The direct designer: one model request in, one complete index.html out.
 *
 * The card is a 10–20 KB file. An autonomous coding agent gets there in a dozen or more turns —
 * reading files, grepping, running shell commands, rewriting — and every turn resends the whole
 * growing conversation, which is how a card came to cost 500k tokens. Here the model is handed
 * everything at once (the brief, the tweet, the page and the tweet's pictures, which it can look
 * at) and answers with the file: about 15–40k tokens for a build, and a repair is one more request
 * carrying only the current page and the measured violations.
 *
 * The request goes through the Worker's Workers AI binding: no token, and nothing leaves Cloudflare.
 * It is streamed, so the job's live log shows the model's reasoning and the file as they are
 * written.
 */
export interface DesignRequest {
  model: ModelSpec
  format: CardFormat
  motion: boolean
  /** context/tweet.md: the tweet, its assets with pixel sizes, and its signals. */
  tweetMarkdown: string
  request: string
  /** context/recent.md. */
  recent: string
  /** The page to design (the scaffold), or the current design for a repair. */
  page: string
  /** The tweet's pictures, shown to a model that can see. */
  images: AssetFile[]
  /** Set for a repair: the review, with the violations to fix. */
  review?: string
}

export interface DesignStream {
  thought(text: string): void
  text(text: string): void
  /** A request is being retried, and why. */
  retry(reason: string): void
}

export interface DesignResult {
  html: string
  usage: UsageEntry
  finishReason: string | null
}

/** Enough for the longest card plus the model's reasoning; a card that needs more is broken. */
const MAX_OUTPUT_TOKENS = 32_768
/** Pictures shown to the model, at most. Each costs a few hundred tokens. */
const MAX_IMAGES = 4

/** `rateLimited`: the provider refused for quota or load — retried here, and pointless to hand to
 *  the agent, which calls the same model. `retryable`: worth another request. */
export class DesignError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly rateLimited = false,
    readonly rejectedImages = false,
    /** The model cannot be used at all here — not on this plan, or no such model. */
    readonly unavailable = false,
  ) {
    super(message)
  }
}

/** Waits before each retry of a rate-limited or interrupted request. */
const RETRY_WAITS_MS = [10_000, 30_000]

export async function design(env: Env, req: DesignRequest, stream: DesignStream): Promise<DesignResult> {
  const system = designContract(req.format, req.motion) + DIRECT_OUTPUT
  const user = userPrompt(req)
  let images = visualAssets(req.images)
  let out: StreamOut
  for (let attempt = 0; ; attempt++) {
    try {
      out = await workersAiStream(env, req.model, system, user, images, stream)
      break
    } catch (err) {
      // Not every model can see: a refusal of the pictures is answered by asking again without them.
      if (images.length && err instanceof DesignError && err.rejectedImages) {
        stream.retry(`${req.model.id} did not accept the pictures — asking again without them`)
        images = []
        attempt--
        continue
      }
      if (!(err instanceof DesignError) || !err.retryable || attempt >= RETRY_WAITS_MS.length) throw err
      stream.retry(`${err.message} — retrying in ${RETRY_WAITS_MS[attempt] / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]))
    }
  }
  const html = extractHtml(out.text)
  if (!html) throw new DesignError(`the model's answer had no HTML document (${out.text.length} characters, finish: ${out.finishReason ?? 'unknown'})`)
  return { html, usage: out.usage, finishReason: out.finishReason }
}

function userPrompt(req: DesignRequest): string {
  const sections = [
    '# The tweet',
    '',
    req.tweetMarkdown.trim(),
    '',
    '# What the person asked for',
    '',
    req.request.trim() || 'No particular request — design what suits this tweet.',
    '',
    req.recent.trim(),
    '',
  ]
  if (req.review) {
    sections.push(
      '# Repair',
      '',
      'This is your design, rendered in Chromium and measured. Fix only the violations below. Do not',
      'redesign it: keep its concept, artwork, palette and typography exactly. Answer with the whole',
      'corrected file.',
      '',
      req.review.trim(),
      '',
      '# output/index.html — the current design',
    )
  } else sections.push('# output/index.html — the page you design')
  sections.push('', '```html', req.page, '```', '')
  return sections.join('\n')
}

/** Raster pictures the model can look at: the tweet's media first, then the quote's. */
function visualAssets(assets: AssetFile[]): AssetFile[] {
  const order = (a: AssetFile) => (a.path.includes('/media-') ? 0 : a.path.includes('quote-media') ? 1 : 2)
  return assets
    .filter((a) => a.encoding === 'base64' && /^image\/(jpeg|png|webp)$/.test(a.mime) && /media-\d/.test(a.path))
    .sort((a, b) => order(a) - order(b))
    .slice(0, MAX_IMAGES)
}

/** The ```html block of the answer, or a bare document if the model skipped the fence. */
export function extractHtml(answer: string): string | null {
  const fenced = [...answer.matchAll(/```(?:html)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0]
  const candidate = (fenced ?? answer).trim()
  const start = candidate.search(/<!doctype html|<html\b/i)
  if (start < 0) return null
  const end = candidate.toLowerCase().lastIndexOf('</html>')
  return end > start ? candidate.slice(start, end + '</html>'.length) : candidate.slice(start)
}

interface StreamOut {
  text: string
  usage: UsageEntry
  finishReason: string | null
}

/**
 * Workers AI through the AI binding, streamed. Models answer in one of two shapes — OpenAI-style
 * chunks (choices[0].delta, with reasoning_content for reasoning models) or Workers AI's own
 * ({ response }) — and report usage in a final chunk; both are read.
 */
async function workersAiStream(env: Env, model: ModelSpec, system: string, user: string, images: AssetFile[], stream: DesignStream): Promise<StreamOut> {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.flatMap((image) => [
        { type: 'text', text: `Attached picture: ${image.path} — ${image.label}` },
        { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.content}` } },
      ])]
    : user
  let body: unknown
  try {
    // The binding's types name each model; AGENT_MODEL is configuration, so it is called by string.
    const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }
    body = await ai.run(model.id, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
    })
  } catch (err) {
    throw bindingError(err, images.length > 0)
  }
  if (!(body instanceof ReadableStream)) throw new DesignError(`Workers AI did not stream an answer from ${model.id}`)

  let text = ''
  let usage: Record<string, unknown> = {}
  let finishReason: string | null = null
  let events = 0
  let last: Record<string, any> = {}
  // Some models report usage once, cumulatively; others on every chunk, as that chunk's own count.
  // The larger of the last cumulative figure and the running sum is the true total either way.
  let maxCompletion = 0
  let sumCompletion = 0
  let neurons = 0
  await readSse(body, (event) => {
    events++
    last = event
    if (event.error || event.errors) throw bindingError(new Error(JSON.stringify(event.error ?? event.errors)), images.length > 0)
    const choice = event.choices?.[0]
    const delta = choice?.delta ?? {}
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) stream.thought(reasoning)
    const piece = typeof delta.content === 'string' ? delta.content : typeof event.response === 'string' ? event.response : ''
    if (piece) {
      text += piece
      stream.text(piece)
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (event.usage) {
      usage = event.usage
      const completion = Number(event.usage.completion_tokens ?? 0)
      maxCompletion = Math.max(maxCompletion, completion)
      sumCompletion += completion
      neurons += Number(event.usage.neurons ?? 0)
    }
  })
  const completionTokens = maxCompletion > 1 ? maxCompletion : sumCompletion
  if (!text) {
    // What the stream ended on says why: a length stop (the reasoning used the whole allowance),
    // an error, or nothing at all.
    const detail = `${events} events, finish ${finishReason ?? 'none'}, usage ${JSON.stringify(usage)}, last ${JSON.stringify(last).slice(0, 240)}`
    console.log(`designer   empty answer from ${model.id}: ${detail}`)
    if (finishReason === 'length') throw new DesignError(`${model.id} spent its whole output allowance reasoning and never wrote the card (${detail})`)
    throw new DesignError(`Workers AI ended the stream from ${model.id} before answering (${detail})`, true)
  }
  return {
    text,
    finishReason: finishReason ?? (text ? 'stop' : null),
    usage: entry(model.id, 'ai.run', {
      prompt: Number(usage.prompt_tokens ?? 0),
      completion: completionTokens,
      total: Number(usage.prompt_tokens ?? 0) + completionTokens,
      raw: { ...usage, completion_tokens: completionTokens, neurons },
    }),
  }
}

/**
 * What a Workers AI failure means for the next step. 4006 is the account's daily free allocation
 * spent — no retry helps today; 3040 and 429 are capacity, worth a retry after a pause; an error
 * about the request's content, when pictures were sent, is the model not taking pictures.
 */
function bindingError(err: unknown, sentImages: boolean): DesignError {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
  // Codes first: "5035" must not read as an HTTP 5xx.
  if (/\b5035\b|not available on the Workers Free plan|\b5007\b|no such model|model not found/i.test(message)) return new DesignError(`Workers AI cannot run this model: ${message}`, false, false, false, true)
  if (/4006|daily free allocation|neurons/i.test(message)) return new DesignError(`Workers AI allocation is spent: ${message}`, false, true)
  if (/3040|429|capacity|rate.?limit|too many/i.test(message)) return new DesignError(`Workers AI is at capacity: ${message}`, true, true)
  if (sentImages && /image|content|multimodal|vision|5006|input/i.test(message)) return new DesignError(`Workers AI refused the request: ${message}`, false, false, true)
  if (/\b3043\b|internal server|timed? ?out|temporarily unavailable|\b50[0-4]\b/i.test(message)) return new DesignError(`Workers AI failed: ${message}`, true)
  return new DesignError(`Workers AI refused the request: ${message}`)
}

function entry(model: string, path: string, u: { prompt: number; completion: number; total: number; raw: Record<string, unknown> }): UsageEntry {
  return { model, path, at: new Date().toISOString(), promptTokens: u.prompt, completionTokens: u.completion, totalTokens: u.total || u.prompt + u.completion, usage: u.raw }
}

/** Calls `onEvent` with each `data:` JSON of a server-sent-event stream. */
async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: Record<string, any>) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  const flush = (line: string) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let event: Record<string, any>
    try {
      event = JSON.parse(data)
    } catch {
      return // A malformed event is skipped; the stream goes on.
    }
    onEvent(event)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(flush)
  }
  flush(buffer)
}
