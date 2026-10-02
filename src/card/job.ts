import { DurableObject } from 'cloudflare:workers'
import { assetsMarkdown, type AssetFile } from '../api/assets'
import type { UsageEntry } from '../api/sandbox'
import { tweetToMarkdown } from '../markdown/tweet'
import { FetchError, fetchTweet } from '../twitter/fxtwitter'
import { parseTweetUrl, type Tweet } from '../twitter/tweet'
import { analyzeContent, signalsMarkdown, type ContentAnalysis } from './analysis'
import { bundle } from './bundle'
import { DesignError, design } from './designer'
import { WORKSPACE, agentModel, selectAgent, usageSummary, type ModelSpec } from './engines'
import { cardFormat, formatSummary, type FormatId } from './formats'
import { JobLog } from './log'
import type { Issue } from './measure'
import { inspectCard, measureParams } from './qa'
import { recentDesigns, recentMarkdown, rememberDesign } from './recent'
import { reviewMarkdown, score, type Review } from './review'
import { applyHouseDesign, cardSandbox, lockAgentContent, prepareWorkspace, readIndex, readOutput, runAgent, writeIndex, writeReview } from './workspace'

/**
 * CardJob — one card, from tweet URL to exported PNG, as a Durable Object per job.
 *
 *   extract → build → validate ⇄ repair → export
 *
 * extract turns the tweet into data; build hands it to the designer, which writes one
 * self-contained HTML file; validate renders it in Chromium, measures it and screenshots the PNG.
 *
 * The designer is one model request (./designer.ts) — about 15–40k tokens a card. The opencode agent
 * (a long tool loop, often hundreds of thousands of tokens) is the fallback when that request fails,
 * or the engine when DESIGN_ENGINE is "agent", and runs on a hard model-call budget either way.
 *
 * validate is deterministic: the card is rendered in Chromium and measured (./qa.ts). No model
 * looks at the result — a repair is only ever triggered by a measured violation.
 *
 * Each stage runs in its own alarm invocation and persists its result before scheduling the next,
 * so a stage is the unit of retry and no invocation comes near the 15-minute alarm limit. A crash,
 * a deploy or an eviction mid-job resumes at the stage it was on rather than starting again.
 *
 * The Worker only ever calls start() and snapshot(); everything else happens here.
 */

/** 'direct' only on jobs created before the director was removed; they move on to build. */
export type Stage = 'extract' | 'direct' | 'build' | 'validate' | 'repair' | 'export'
export type Status = 'queued' | 'processing' | 'completed' | 'failed'

export interface CardInput {
  url: string
  format: FormatId
  instructions: string
  /** Motion & 3D mode. Absent on jobs created before the mode existed. */
  motion?: boolean
}

interface JobState {
  id: string
  status: Status
  stage: Stage
  attempts: number
  input: CardInput
  createdAt: string
  updatedAt: string
  engine?: string
  tweet?: Tweet
  tweetMarkdown?: string
  analysis?: ContentAnalysis
  /** The tweet context the designer was given — the same again for a repair. */
  context?: string
  /** The recent designs it was told not to repeat. */
  recent?: string
  /** Set when the direct designer failed: the rest of the job uses the opencode agent. */
  agentFallback?: boolean
  repairs: number
  rebuilds: number
  /** True once the house design has been tried in place of the agent's (see ./house.ts). */
  housed?: boolean
  /** True when the best — exported — version is the house design. */
  housedBest?: boolean
  /** The review the next repair works from — always the best version's. */
  review?: Review
  /** Lower is better; see score(). The export is always the best-scoring version. */
  bestScore?: number
  exported: boolean
  seconds: Partial<Record<Stage, number>>
  error?: { code: string; message: string }
}

/** Repair passes after the first build: one. Each is minutes of agent time and most of a card's
 *  token cost, and a second pass rarely fixed what the first could not. */
const MAX_REPAIRS = 1
/** A repair is never retried either: if its one run fails, the best version so far is exported. */
const MAX_ATTEMPTS: Record<Stage, number> = { extract: 3, direct: 3, build: 3, validate: 2, repair: 1, export: 3 }
/** The agent's model calls per run, enforced at egress (../api/sandbox.ts): a build needs a read or
 *  two and one write; a repair, one read and one write. */
const AGENT_BUILD_CALLS = 12
const AGENT_REPAIR_CALLS = 6
const BUILD_TIMEOUT_MS = 10 * 60_000
const REPAIR_TIMEOUT_MS = 6 * 60_000
/** How long a finished job's record and exports are kept. */
export const RETENTION_SECONDS = 30 * 24 * 60 * 60

/** What snapshot() returns. Typed from the method itself so the two cannot drift; the RPC stub's
 *  own type for it collapses to never because metrics are open-ended JSON. */
export type CardView = NonNullable<Awaited<ReturnType<CardJob['snapshot']>>>
export type CardLogs = NonNullable<Awaited<ReturnType<CardJob['logs']>>>

export const assetKey = (id: string, kind: 'html' | 'png') => `cards:${id}:${kind}`

/** A failure that retrying cannot fix. */
class Permanent extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class CardJob extends DurableObject<Env> {
  private readonly journal = new JobLog(this.ctx.storage)

  /** Creates the job, or returns the existing one: calling twice with the same id is harmless. */
  async start(id: string, input: CardInput): Promise<ReturnType<CardJob['view']>> {
    const existing = await this.ctx.storage.get<JobState>('job')
    if (existing) return this.view(existing, await this.usage())

    const now = new Date().toISOString()
    const job: JobState = {
      id,
      status: 'queued',
      stage: 'extract',
      attempts: 0,
      input,
      createdAt: now,
      updatedAt: now,
      repairs: 0,
      rebuilds: 0,
      exported: false,
      seconds: {},
    }
    await this.ctx.storage.put('job', job)
    await this.ctx.storage.setAlarm(Date.now())
    this.log(job, 'queued', input.url)
    return this.view(job, [])
  }

  async snapshot(): Promise<ReturnType<CardJob['view']> | null> {
    const job = await this.ctx.storage.get<JobState>('job')
    return job ? this.view(job, await this.usage()) : null
  }

  /** The live log after line `after`, with the job's status and stage so a reader needs only this. */
  async logs(after: number) {
    const job = await this.ctx.storage.get<JobState>('job')
    if (!job) return null
    const { lines, next } = await this.journal.read(after)
    return { status: job.status, stage: job.stage, lines, next }
  }

  /** One model call's tokens — from the direct designer, or over RPC from the egress handler in
   *  ../api/sandbox.ts for each of the agent's calls — and a line in the live log, so where the
   *  tokens go is visible call by call. */
  async recordUsage(entry: UsageEntry): Promise<void> {
    const all = await this.appendUsage([entry])
    const total = all.reduce((n, e) => n + e.totalTokens, 0)
    const n = (x: number) => x.toLocaleString('en-US')
    const line = `model call ${all.length} · ${entry.model} · ${n(entry.promptTokens)} in · ${n(entry.completionTokens)} out · ${n(total)} total so far`
    console.log(line)
    this.journal.pipeline(line)
  }

  /** Asked by the egress handler before each of the agent's model calls: false once the run's
   *  budget is spent. */
  async admitModelCall(): Promise<boolean> {
    const budget = await this.ctx.storage.get<{ used: number; limit: number }>('callBudget')
    if (!budget) return true
    if (budget.used >= budget.limit) {
      this.journal.pipeline(`model-call budget of ${budget.limit} spent — the agent is stopped`)
      return false
    }
    await this.ctx.storage.put('callBudget', { used: budget.used + 1, limit: budget.limit })
    return true
  }

  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<JobState>('job')
    if (!job) return

    // Past retention: a finished job's alarm is its expiry.
    if (job.status === 'completed' || job.status === 'failed') {
      if (Date.now() - Date.parse(job.updatedAt) >= RETENTION_SECONDS * 1000 - 60_000) await this.ctx.storage.deleteAll()
      return
    }

    job.status = 'processing'
    job.attempts++
    const stage = job.stage
    const started = Date.now()
    this.log(job, `stage ${stage} (attempt ${job.attempts})`)

    try {
      const next = await this.run(job)
      job.seconds[stage] = (job.seconds[stage] ?? 0) + Math.round((Date.now() - started) / 1000)
      job.attempts = 0
      if (next === 'done') await this.finish(job)
      else {
        job.stage = next
        await this.save(job)
        await this.ctx.storage.setAlarm(Date.now())
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(job, `stage ${stage} failed: ${message}`)
      if (err instanceof Permanent) return this.fail(job, err.code, message)
      if (stage === 'repair' && job.attempts >= MAX_ATTEMPTS.repair) {
        // A repair that keeps failing is not worth failing the card over: export what exists.
        job.stage = 'export'
        job.attempts = 0
        await this.save(job)
        await this.ctx.storage.setAlarm(Date.now())
        return
      }
      if (job.attempts >= MAX_ATTEMPTS[stage]) return this.fail(job, `${stage}_failed`, message)
      await this.save(job)
      await this.ctx.storage.setAlarm(Date.now() + 5_000 * 2 ** (job.attempts - 1))
    }
  }

  private async run(job: JobState): Promise<Stage | 'done'> {
    const format = cardFormat(job.input.format)
    const motion = job.input.motion === true

    switch (job.stage) {
      case 'extract': {
        const ref = parseTweetUrl(job.input.url)
        let tweet: Tweet
        try {
          tweet = await fetchTweet(ref)
        } catch (err) {
          if (err instanceof FetchError && err.status === 404) throw new Permanent('tweet_not_found', err.message)
          throw err
        }
        job.tweet = tweet
        job.tweetMarkdown = tweetToMarkdown(tweet, format.excerptWords)
        job.analysis = analyzeContent(tweet, format)
        this.log(job, `extracted ${tweet.author.handle}/${tweet.id} — ${job.analysis.words} words, ${job.analysis.length}`)
        return 'build'
      }

      case 'direct':
      case 'build': {
        const model = agentModel(this.env)
        if (!model) throw new Permanent('engine_unavailable', 'AGENT_MODEL is not a Workers AI model id (@cf/…)')
        const agent = this.usesAgent(job)
        const engine = agent ? selectAgent(this.env) : null
        if (engine && 'error' in engine) throw new Permanent('engine_unavailable', engine.error)
        job.engine = `${agent ? 'opencode' : 'direct'} · ${model.id}`
        const recent = recentMarkdown(await recentDesigns(this.env.CARD_CACHE))
        const sandbox = cardSandbox(this.env, job.id)
        const { assets, scaffold } = await prepareWorkspace(sandbox, {
          engine,
          format,
          tweet: job.tweet!,
          tweetMarkdown: job.tweetMarkdown!,
          analysis: job.analysis!,
          request: job.input.instructions,
          projectId: this.ctx.id.toString(),
          cache: this.env.CARD_CACHE,
          motion,
          recent,
        })
        job.context = job.tweetMarkdown! + assetsMarkdown(assets) + signalsMarkdown(job.analysis!)
        job.recent = recent

        let note = ''
        if (engine) {
          await this.ctx.storage.put('callBudget', { used: 0, limit: AGENT_BUILD_CALLS })
          const run = await runAgent(sandbox, engine, `Read ${engine.briefFile} and follow it. Build the card into output/.`, BUILD_TIMEOUT_MS, (d) => this.journal.agentOutput(d))
          await this.journal.flush()
          note = ` (opencode exit ${run.exitCode})`
        } else {
          try {
            await writeIndex(sandbox, await this.designDirect(job, model, format, motion, scaffold, assets))
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // A rate limit is the provider's, not the design's: the agent calls the same model and
            // would only spend its budget on retries. Anything else is retried as an agent run.
            // A model this account cannot run fails the card now: the agent would use the same model.
            if (err instanceof DesignError && err.unavailable) throw new Permanent('model_unavailable', `${message} — set AGENT_MODEL to a model this account can use (npx wrangler ai models list)`)
            if (err instanceof DesignError && err.rateLimited) throw new Error(`the model is rate-limited — the build will be retried: ${message}`)
            // The agent needs its own secrets; without them the request itself is retried.
            if ('error' in selectAgent(this.env)) throw new Error(`direct design failed — retrying: ${message}`)
            job.agentFallback = true
            throw new Error(`direct design failed — the next attempt uses the opencode agent: ${message}`)
          }
        }
        // Only the design is kept (content lock); an empty <style> means nothing was designed.
        const lock = await lockAgentContent(sandbox, { tweet: job.tweet!, analysis: job.analysis!, motion })
        this.log(job, `design kept: ${lock.cssLength} bytes of CSS, ${lock.artworkLength} of artwork, ${lock.jsLength} of JS${lock.fonts.length ? ` · ${lock.fonts.join(' + ')}` : ''}${lock.libraries.length ? ` · using ${lock.libraries.join(' + ')}` : ''}${lock.restored ? ' — content the designer changed was restored from data' : ''}`)
        if (lock.cssLength < 200) {
          if (!agent && !('error' in selectAgent(this.env))) job.agentFallback = true
          throw new Error(`the design is empty — its <style> has ${lock.cssLength} bytes${note}`)
        }
        return 'validate'
      }

      case 'validate': {
        const sandbox = cardSandbox(this.env, job.id)
        const files = await readOutput(sandbox)
        const built = bundle(files)
        if (!built) {
          // The workspace went away between stages (a restarted container keeps no files).
          if (job.rebuilds >= 1) throw new Permanent('workspace_lost', 'The build output disappeared twice.')
          job.rebuilds++
          return 'build'
        }

        const media = files.map((f) => f.path).filter((p) => /^assets\/(quote-)?media-\d+\./.test(p))
        const inspection = await inspectCard(this.env.BROWSER, built.html, measureParams(job.tweet!, job.analysis!, motion, format, media))
        const issues: Issue[] = [
          ...inspection.issues,
          ...built.remote.map((r): Issue => ({ severity: 'high', rule: 'remote-resource', detail: `The card references ${r}; only files in output/ are allowed.`, source: 'qa' })),
          ...built.missing.map((r): Issue => ({ severity: 'high', rule: 'missing-resource', detail: `The card references ${r}, which does not exist in output/.`, source: 'qa' })),
        ]

        const review: Review = { issues, metrics: inspection.metrics, at: new Date().toISOString() }
        const points = score(issues)
        const summary = issues.map((i) => `${i.severity}:${i.rule}`).join(', ') || 'none'
        this.log(job, `validated — score ${points}, issues: ${summary}`)

        if (job.bestScore === undefined || points < job.bestScore) {
          // A new best: it becomes the export, and the workspace is snapshotted so a repair that
          // makes things worse can be undone.
          const ttl = { expirationTtl: RETENTION_SECONDS }
          await this.env.CARD_CACHE.put(assetKey(job.id, 'html'), built.html, ttl)
          await this.env.CARD_CACHE.put(assetKey(job.id, 'png'), inspection.png, ttl)
          await sandbox.exec(`rm -rf ${WORKSPACE}/best && cp -r ${WORKSPACE}/output ${WORKSPACE}/best`)
          job.exported = true
          job.bestScore = points
          job.review = review
          job.housedBest = job.housed === true
        } else {
          // The repair made it worse: go back to the best version and repair from there.
          await sandbox.exec(`rm -rf ${WORKSPACE}/output && cp -r ${WORKSPACE}/best ${WORKSPACE}/output`)
          this.log(job, `repair did not improve on score ${job.bestScore} — restored the best version`)
        }

        const needsRepair = job.review!.issues.some((i) => i.severity !== 'low')
        if (needsRepair && job.repairs < MAX_REPAIRS) return 'repair'

        // Repairs spent and the best version is still broken — text off the canvas, clipped, hidden:
        // try the house design once. Keep-best above decides which of the two is exported.
        if (!job.housed && job.review!.issues.some((i) => i.severity === 'high')) {
          job.housed = true
          await applyHouseDesign(sandbox, { tweet: job.tweet!, analysis: job.analysis!, motion, format })
          this.log(job, 'best version still has high-severity issues — trying the house design')
          return 'validate'
        }
        return 'export'
      }

      case 'repair': {
        const model = agentModel(this.env)
        if (!model) throw new Permanent('engine_unavailable', 'AGENT_MODEL is not a Workers AI model id (@cf/…)')
        const sandbox = cardSandbox(this.env, job.id)
        const review = reviewMarkdown(job.review!)
        const engine = this.usesAgent(job) ? selectAgent(this.env) : null
        if (engine && 'error' in engine) throw new Permanent('engine_unavailable', engine.error)
        if (engine) {
          await writeReview(sandbox, review)
          await this.ctx.storage.put('callBudget', { used: 0, limit: AGENT_REPAIR_CALLS })
          await runAgent(sandbox, engine, 'Read context/repair.md, then fix only the violations listed in context/review.md.', REPAIR_TIMEOUT_MS, (d) => this.journal.agentOutput(d))
          await this.journal.flush()
        } else {
          // Only what a repair needs: the current page and the violations — not the conversation
          // that produced it.
          await writeIndex(sandbox, await this.designDirect(job, model, format, motion, await readIndex(sandbox), [], review))
        }
        const lock = await lockAgentContent(sandbox, { tweet: job.tweet!, analysis: job.analysis!, motion })
        if (lock.restored) this.log(job, 'repair: content the designer changed was restored from data')
        job.repairs++
        return 'validate'
      }

      case 'export':
        return 'done'
    }
  }

  /** The direct designer, streaming its thinking and its file into the live log. */
  private async designDirect(job: JobState, model: ModelSpec, format: ReturnType<typeof cardFormat>, motion: boolean, page: string, images: AssetFile[], review?: string): Promise<string> {
    const pictures = images.filter((a) => /media-\d/.test(a.path)).length
    const avoiding = (job.recent?.match(/^\d+\. /gm) ?? []).length
    this.log(job, `${review ? 'repairing' : 'designing'} in one request to ${model.id}${pictures ? `, with ${pictures} picture(s) to look at` : ''}${!review && avoiding ? `, avoiding ${avoiding} recent design(s)` : ''}`)
    const result = await design(
      this.env,
      { model, format, motion, tweetMarkdown: job.context ?? job.tweetMarkdown!, request: job.input.instructions, recent: job.recent ?? '', page, images, review },
      { thought: (t) => this.journal.thought(t), text: (t) => this.journal.agentOutput(t), retry: (reason) => this.log(job, reason) },
    )
    await this.journal.flush()
    await this.recordUsage(result.usage)
    if (result.finishReason && !/^(STOP|stop)$/.test(result.finishReason)) this.log(job, `the model stopped early: ${result.finishReason}`)
    return result.html
  }

  private usesAgent(job: JobState): boolean {
    return job.agentFallback === true || (this.env.DESIGN_ENGINE as string) === 'agent'
  }

  private async finish(job: JobState): Promise<void> {
    job.status = 'completed'
    await this.save(job)
    // Remembered so the next card avoids it — unless it is the house design, which is not a choice.
    if (!job.housedBest) await rememberDesign(this.env.CARD_CACHE, job.review?.metrics)
    await this.destroySandbox(job)
    this.log(job, `completed after ${job.repairs} repair(s) — quality ${this.quality(job).passed ? 'passed' : 'has open issues'}`)
    console.log(`[${job.id}] final usage`, JSON.stringify(usageSummary(await this.usage())))
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_SECONDS * 1000)
  }

  private async fail(job: JobState, code: string, message: string): Promise<void> {
    job.status = 'failed'
    job.error = { code, message: message.slice(0, 500) }
    await this.save(job)
    await this.destroySandbox(job)
    console.log(`[${job.id}] final usage`, JSON.stringify(usageSummary(await this.usage())))
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_SECONDS * 1000)
  }

  private async destroySandbox(job: JobState): Promise<void> {
    if (!job.engine) return
    await cardSandbox(this.env, job.id)
      .destroy()
      .catch((err: unknown) => this.log(job, `sandbox destroy failed: ${err instanceof Error ? err.message : String(err)}`))
  }

  private quality(job: JobState) {
    const issues = job.review?.issues ?? []
    return {
      passed: job.exported && !issues.some((i) => i.severity !== 'low'),
      repairs: job.repairs,
      /** True when the exported card uses the house design because the agent's could not pass. */
      houseDesign: job.housedBest === true,
      metrics: job.review?.metrics ?? null,
      issues,
    }
  }

  private view(job: JobState, usage: UsageEntry[]) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      format: formatSummary(cardFormat(job.input.format)),
      input: job.input,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      engine: job.engine ?? null,
      exported: job.exported,
      tweet: job.tweet
        ? { url: job.tweet.url, author: job.tweet.author, text: job.tweet.text, date: job.tweet.date, stats: job.tweet.stats, media: job.tweet.media.length, replyingTo: job.tweet.replyingTo, quote: job.tweet.quote ? { url: job.tweet.quote.url, author: job.tweet.quote.author } : null }
        : null,
      motion: job.input.motion === true,
      quality: job.status === 'completed' ? this.quality(job) : null,
      timings: job.seconds,
      usage: usageSummary(usage),
      error: job.error ?? null,
    }
  }

  private async save(job: JobState): Promise<void> {
    await this.journal.flush()
    job.updatedAt = new Date().toISOString()
    await this.ctx.storage.put('job', job)
  }

  private async usage(): Promise<UsageEntry[]> {
    return (await this.ctx.storage.get<UsageEntry[]>('usage')) ?? []
  }

  private async appendUsage(entries: UsageEntry[]): Promise<UsageEntry[]> {
    const all = [...(await this.usage()), ...entries]
    if (entries.length) await this.ctx.storage.put('usage', all)
    return all
  }

  private log(job: JobState, message: string, detail?: string): void {
    console.log(`[${job.id}] ${message}${detail ? ` — ${detail}` : ''}`)
    this.journal.pipeline(message)
  }
}
