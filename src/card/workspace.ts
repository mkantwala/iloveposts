import { getSandbox } from '@cloudflare/sandbox'
import { assetsMarkdown, tweetAssets, type AssetFile } from '../api/assets'
import { toggleScript } from '../api/toggle'
import { REPAIR_BRIEF, builderBrief } from '../markdown/agents'
import type { Tweet } from '../twitter/tweet'
import { signalsMarkdown, type ContentAnalysis } from './analysis'
import type { OutputFile } from './bundle'
import { PLACEHOLDER_TOKEN, WORKSPACE, type Engine } from './engines'
import type { CardFormat } from './formats'
import { baseCss } from './base'
import { loadFontLibrary } from './fonts'
import { houseDesign } from './house'
import { LIBRARY_DIR } from './libraries'
import { cardScaffold, contentOf, lockContent } from './scaffold'

/**
 * The sandbox side of the pipeline: lay out the workspace, run an engine in it, read the result.
 *
 *   /workspace/AGENTS.md                the design brief and contract (../markdown/agents.ts)
 *   /workspace/context/tweet.md         the tweet, with the Assets section appended
 *   /workspace/context/request.md       what the person asked for
 *   /workspace/context/recent.md        the last few cards' designs, not to be repeated
 *   /workspace/context/review.md        written before a repair pass: the violations to fix
 *   /workspace/output/index.html        the tweet, already marked up — the agent designs it
 *   /workspace/output/base.css          the technical floor: canvas size, See more, picture defaults
 *   /workspace/output/toggle.js         See more / See less
 *   /workspace/output/assets/*          the real avatar, badge and media (and the quoted tweet's)
 *   /workspace/output/fonts/*           the embeddable type shelf, one stylesheet per family
 *   /workspace/output/lib/*             Three.js and GSAP, for designs that need them
 */

export type CardSandbox = ReturnType<typeof getSandbox>

/** Text files are read as UTF-8; everything else comes back base64. Above this size a file is not
 *  something a card should contain, and is skipped rather than inlined. */
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024

const TEXT_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  txt: 'text/plain',
}
const BINARY_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  woff2: 'font/woff2',
  woff: 'font/woff',
}

export function cardSandbox(env: Env, jobId: string): CardSandbox {
  // Kept awake between stages, which arrive as separate alarms seconds apart.
  return getSandbox(env.Sandbox, `card-${jobId}`, { sleepAfter: '20m' })
}

export async function prepareWorkspace(
  sandbox: CardSandbox,
  input: {
    /** The opencode agent, when it is the one designing; null for the direct designer, which needs
     *  only the files. */
    engine: Engine | null
    format: CardFormat
    tweet: Tweet
    tweetMarkdown: string
    analysis: ContentAnalysis
    request: string
    /** The job's Durable Object id: where the egress handler reports token usage. */
    projectId: string
    /** Where font files are cached between cards. */
    cache: KVNamespace
    /** Motion & 3D mode: one self-contained index.html, with the motion contract in the brief. */
    motion: boolean
    /** The last few cards' designs, described (./recent.ts). */
    recent: string
  },
): Promise<{ assets: AssetFile[]; scaffold: string }> {
  await sandbox.killAllProcesses().catch(() => 0)
  await sandbox.exec(`rm -rf ${WORKSPACE}/context ${WORKSPACE}/output ${WORKSPACE}/best ${WORKSPACE}/AGENTS.md`)
  await sandbox.mkdir(`${WORKSPACE}/context`, { recursive: true })
  await sandbox.mkdir(`${WORKSPACE}/output/assets`, { recursive: true })

  // The real pictures, as local files: the card may not load anything remote.
  const assets = await tweetAssets(input.tweet)
  for (const asset of assets) {
    await sandbox.writeFile(`${WORKSPACE}/output/${asset.path}`, asset.content, { encoding: asset.encoding })
  }
  console.log('build      assets:', assets.map((a) => a.path).join(', ') || '(none)')

  // The whole type shelf; the design links the families it chooses and only those are inlined.
  const fonts = await loadFontLibrary(input.cache)
  await sandbox.mkdir(`${WORKSPACE}/output/fonts`, { recursive: true })
  for (const font of fonts) await sandbox.writeFile(`${WORKSPACE}/output/${font.path}`, font.content, { encoding: font.encoding })
  console.log(`build      fonts: ${fonts.filter((f) => f.path.endsWith('.css')).length} families (${fonts.length} files)`)

  // Any card may use the vendored libraries — a static one can render a Three.js scene once.
  await sandbox.exec(`mkdir -p ${WORKSPACE}/output/lib && cp ${LIBRARY_DIR}/*.js ${WORKSPACE}/output/lib/`)

  const { format } = input
  const scaffold = cardScaffold({ tweet: input.tweet, analysis: input.analysis, assets: assets.map((a) => a.path), motion: input.motion })
  await Promise.all([
    sandbox.writeFile(`${WORKSPACE}/AGENTS.md`, builderBrief(format, input.motion)),
    sandbox.writeFile(`${WORKSPACE}/context/tweet.md`, input.tweetMarkdown + assetsMarkdown(assets) + signalsMarkdown(input.analysis)),
    sandbox.writeFile(`${WORKSPACE}/context/recent.md`, input.recent),
    sandbox.writeFile(`${WORKSPACE}/context/request.md`, input.request || 'No particular request — design what suits this tweet.'),
    sandbox.writeFile(`${WORKSPACE}/output/base.css`, baseCss(format)),
    sandbox.writeFile(`${WORKSPACE}/output/toggle.js`, toggleScript(input.tweet.text, input.analysis.excerpt.truncated)),
    // The card's content, already correct: the agent designs it rather than typing it.
    sandbox.writeFile(`${WORKSPACE}/output/index.html`, scaffold),
    ...(input.engine?.files ?? []).map((f) => sandbox.writeFile(f.path, f.content)),
  ])

  // A placeholder, not the real token: see ../api/sandbox.ts. The session id is one per job, so
  // every call lands on the same model instance and can share its prompt cache.
  if (input.engine) {
    await sandbox.setEnvVars({ AGENT_API_KEY: PLACEHOLDER_TOKEN })
    for (const { host, handler } of input.engine.egress) {
      await sandbox.setOutboundByHost(host, handler, { project: input.projectId, session: `job-${input.projectId.slice(0, 24)}` })
    }
  }
  return { assets, scaffold }
}

/** The direct designer's page, written where the agent would have written it. */
export async function writeIndex(sandbox: CardSandbox, html: string): Promise<void> {
  await sandbox.writeFile(`${WORKSPACE}/output/index.html`, html)
}

export async function readIndex(sandbox: CardSandbox): Promise<string> {
  return (await sandbox.readFile(`${WORKSPACE}/output/index.html`)).content
}

export async function writeReview(sandbox: CardSandbox, reviewMarkdown: string): Promise<void> {
  await sandbox.writeFile(`${WORKSPACE}/context/review.md`, reviewMarkdown)
  await sandbox.writeFile(`${WORKSPACE}/context/repair.md`, REPAIR_BRIEF)
}

export interface AgentRun {
  exitCode: number
  seconds: number
}

export async function runAgent(
  sandbox: CardSandbox,
  engine: Engine,
  instruction: string,
  timeoutMs: number,
  /** Every chunk of the agent's output as it streams, for the job's live log. */
  onOutput?: (data: string) => void,
): Promise<AgentRun> {
  const started = Date.now()
  console.log(`build      running ${engine.name}: ${instruction}`)
  const run = await sandbox.exec(engine.command(instruction), {
    cwd: WORKSPACE,
    stream: true,
    onOutput: (_stream, data) => {
      console.log('agent:', data.trim().slice(0, 400))
      onOutput?.(data)
    },
    timeout: timeoutMs,
  })
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`build      ${engine.name} exited ${run.exitCode} after ${seconds}s`)
  return { exitCode: run.exitCode, seconds }
}

/**
 * After an agent run: keep only its design and rebuild the page's content from data (see
 * lockContent in ./scaffold.ts). Returns how much CSS and JS the agent wrote, and whether its page
 * had strayed from the content it was given.
 */
export async function lockAgentContent(
  sandbox: CardSandbox,
  input: { tweet: Tweet; analysis: ContentAnalysis; motion: boolean },
): Promise<{ cssLength: number; jsLength: number; artworkLength: number; fonts: string[]; libraries: string[]; restored: boolean }> {
  const files = await readOutput(sandbox)
  const agentHtml = files.find((f) => f.path === 'index.html')?.content ?? ''
  const assets = files.map((f) => f.path).filter((p) => p.startsWith('assets/'))
  const locked = lockContent(agentHtml, { ...input, assets })
  const restored = locked.content !== contentOf(locked.html)
  await sandbox.writeFile(`${WORKSPACE}/output/index.html`, locked.html)
  return { cssLength: locked.cssLength, jsLength: locked.jsLength, artworkLength: locked.artworkLength, fonts: locked.fonts, libraries: locked.libraries, restored }
}

/** Replaces the agent's design with the house design, around the same data-built content. */
export async function applyHouseDesign(
  sandbox: CardSandbox,
  input: { tweet: Tweet; analysis: ContentAnalysis; motion: boolean; format: CardFormat },
): Promise<void> {
  const files = await readOutput(sandbox)
  const assets = files.map((f) => f.path).filter((p) => p.startsWith('assets/'))
  const { css, js, fonts } = houseDesign(input.format, input.motion)
  await sandbox.writeFile(`${WORKSPACE}/output/index.html`, cardScaffold({ ...input, assets, css, js: js || undefined, fonts }))
}

/** Every file under output/, ready for ./bundle.ts. */
export async function readOutput(sandbox: CardSandbox): Promise<OutputFile[]> {
  const listing = await sandbox.listFiles(`${WORKSPACE}/output`, { recursive: true }).catch(() => null)
  const files: OutputFile[] = []

  for (const info of listing?.files ?? []) {
    if (info.type !== 'file' || info.size > MAX_OUTPUT_BYTES) continue
    const path = info.relativePath.replace(/^\.?\//, '')
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const text = TEXT_TYPES[extension]
    const binary = BINARY_TYPES[extension]
    if (!text && !binary) continue

    const read = await sandbox.readFile(info.absolutePath, binary ? { encoding: 'base64' } : undefined).catch(() => null)
    if (!read?.success) continue
    files.push({
      path,
      content: read.content,
      encoding: read.encoding === 'base64' || binary ? 'base64' : 'utf-8',
      mime: text ?? binary,
    })
  }
  return files
}
