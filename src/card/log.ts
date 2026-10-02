/**
 * A job's live log: what the page's terminal shows while a card is built.
 *
 * Three sources, in the order they happened: the designer's output — the direct designer's
 * streamed file, or the opencode agent's shell (→ Read, ← Write, $ command, and what those commands
 * print) exactly as streamed from the container — the model's thinking, when it shares it, and the
 * pipeline's stage and token lines. Stored in the job's Durable Object as numbered lines,
 * so a reader asks for everything after the last line it has, and a reload picks up where it was.
 *
 * Writes are batched: output arrives a few bytes at a time, and one storage write per chunk would
 * cost more than the build.
 */
export interface LogLine {
  n: number
  at: number
  kind: 'agent' | 'thought' | 'pipeline'
  text: string
}

const MAX_LINES = 5000
const MAX_CHARS = 1000
const READ_PAGE = 500
const FLUSH_MS = 500
/** Durable Object storage takes at most 128 keys in one put. */
const PUT_BATCH = 100
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

const key = (n: number) => `log:${String(n).padStart(8, '0')}`

export class JobLog {
  private seq: number | null = null
  private loading: Promise<number> | null = null
  private pending: Array<Omit<LogLine, 'n'>> = []
  private partial: Record<'agent' | 'thought', string> = { agent: '', thought: '' }
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly storage: DurableObjectStorage) {}

  /** A chunk of the designer's output (or the agent's stdout and stderr): split into lines,
   *  terminal colours removed. */
  agentOutput(data: string): void {
    this.stream('agent', data)
  }

  /** A chunk of the model's thinking. */
  thought(data: string): void {
    this.stream('thought', data)
  }

  private stream(kind: 'agent' | 'thought', data: string): void {
    const lines = (this.partial[kind] + data.replace(ANSI, '').replace(/\r\n?/g, '\n')).split('\n')
    this.partial[kind] = lines.pop() ?? ''
    for (const line of lines) this.push(kind, line)
  }

  pipeline(text: string): void {
    this.push('pipeline', text)
  }

  /** Writes whatever is buffered, including an unfinished last line — for the end of a stream. */
  async flush(): Promise<void> {
    for (const kind of ['thought', 'agent'] as const) {
      if (!this.partial[kind]) continue
      this.push(kind, this.partial[kind])
      this.partial[kind] = ''
    }
    await this.write()
  }

  /** Writes the complete lines buffered so far. */
  private async write(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const batch = this.pending.splice(0)
    if (!batch.length) return
    this.loading ??= this.storage.get<number>('logSeq').then((n) => n ?? 0)
    const loaded = await this.loading
    this.seq ??= loaded

    const entries: Record<string, LogLine | number> = {}
    for (const line of batch) {
      if (this.seq >= MAX_LINES) break
      this.seq++
      entries[key(this.seq)] = { n: this.seq, ...line }
    }
    entries.logSeq = this.seq
    const keys = Object.keys(entries)
    for (let i = 0; i < keys.length; i += PUT_BATCH) {
      await this.storage.put(Object.fromEntries(keys.slice(i, i + PUT_BATCH).map((k) => [k, entries[k]])))
    }
  }

  /** Every line after `after`, a page at a time. */
  async read(after: number): Promise<{ lines: LogLine[]; next: number }> {
    const map = await this.storage.list<LogLine>({ start: key(Math.max(0, after) + 1), end: 'log;', limit: READ_PAGE })
    const lines = [...map.values()]
    return { lines, next: lines.at(-1)?.n ?? after }
  }

  private push(kind: LogLine['kind'], text: string): void {
    const trimmed = text.replace(/\s+$/, '')
    // Blank lines only separate opencode's blocks; the terminal spaces those itself.
    if (!trimmed.trim()) return
    this.pending.push({ at: Date.now(), kind, text: trimmed.length > MAX_CHARS ? `${trimmed.slice(0, MAX_CHARS)}…` : trimmed })
    if (this.pending.length >= PUT_BATCH) void this.write()
    else this.timer ??= setTimeout(() => void this.write(), FLUSH_MS)
  }
}
