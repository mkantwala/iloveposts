/**
 * The landing page's behaviour. Authored as String.raw so regexes and "\n" reach the browser as
 * written; it must never contain a dollar sign followed by a brace. scripts/check-page.mjs parses it.
 *
 * While a card builds the page polls one endpoint, GET /v1/cards/:id/logs?after=N, which returns
 * the new log lines and the job's stage; the full job is fetched only when the stage changes. The
 * job id is kept in the URL hash, so a reload — or a shared link — picks the build back up.
 */
export const pageScript = String.raw`
(() => {
  const el = (id) => document.getElementById(id)
  const form = el('f'), input = el('url'), go = el('go'), msg = el('msg')
  const STAGES = ['extract', 'build', 'validate', 'export']
  const RATIOS = { x_post: '1600 / 900', x_square: '1 / 1', x_card: '1200 / 628' }
  const POLL_MS = 1500
  const MAX_LINES = 4000

  let run = 0 // bumped per build, so a stale poll loop stops itself
  let follow = true
  let lineCount = 0
  let ticking = null

  // ── Helpers ──────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const count = (n) => (typeof n === 'number' ? n.toLocaleString() : '—')
  function parseLink(value) {
    const raw = value.trim()
    if (!raw) return null
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
      return /^(www\.|mobile\.)?(x|twitter)\.com$/i.test(url.hostname) && /\/status\/\d+/.test(url.pathname) ? url.toString() : null
    } catch { return null }
  }
  function formatDate(iso) {
    const d = iso ? new Date(iso) : null
    return d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  }
  async function getJson(url, init) {
    const response = await fetch(url, Object.assign({ cache: 'no-store' }, init))
    const body = await response.json().catch(() => ({}))
    return { status: response.status, body }
  }

  // ── Stages and the "now" line ────────────────────────────────────────────
  const stageIndex = (stage) => STAGES.indexOf(stage === 'repair' ? 'validate' : stage === 'direct' ? 'build' : stage)
  function paintStages(status, stage) {
    const current = stageIndex(stage)
    STAGES.forEach((name, i) => {
      const node = el('s-' + name)
      const stone = node.querySelector('.stone')
      let state = ''
      if (status === 'completed') state = 'done'
      else if (status === 'failed') state = i < current ? 'done' : i === current ? 'failed' : ''
      else state = i < current ? 'done' : i === current ? 'running' : ''
      node.className = 'stage ' + state
      stone.textContent = state === 'done' ? '✓' : state === 'failed' ? '!' : String(i + 1)
    })
    const labels = { extract: 'Fetching the post…', build: 'The designer is at work…', validate: 'Rendering in Chromium and measuring…', repair: 'Fixing what the check found…', export: 'Framing the card…', direct: 'The designer is at work…' }
    if (status !== 'completed' && status !== 'failed' && !doingFromLog) setDoing(labels[stage] || 'Working…')
  }
  let doingFromLog = false
  function setDoing(text) { el('doing').textContent = text }
  function setLive(live) {
    el('now').classList.toggle('live', live)
    el('terminal').classList.toggle('live', live)
  }
  function startClock(fromIso) {
    stopClock()
    const started = fromIso ? Date.parse(fromIso) : Date.now()
    const paint = () => {
      const total = Math.max(0, Math.round((Date.now() - started) / 1000))
      el('clock').textContent = Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
    }
    paint()
    ticking = setInterval(paint, 1000)
  }
  function stopClock() { if (ticking) clearInterval(ticking); ticking = null }

  // ── The terminal ─────────────────────────────────────────────────────────
  const log = el('log')
  function classify(line) {
    if (line.kind === 'pipeline') return /^model call \d/.test(line.text) ? 'tokens' : 'pipe'
    if (line.kind === 'thought') return 'thought'
    const t = line.text
    if (/^\s*(<!doctype|<\/?[a-z!]|[.#\[@:a-z-]+[^{]*\{|\}|\x60{3})/i.test(t)) return 'code'
    if (t.startsWith('→ ')) return 'read'
    if (t.startsWith('← ')) return 'write'
    if (t.startsWith('$ ')) return 'shell'
    if (t.startsWith('✱ ') || t.startsWith('* ')) return 'search'
    if (t.startsWith('> ')) return 'head'
    if (t.startsWith('✗ ') || /command not found|^Error|error:/i.test(t)) return 'err'
    return 'out'
  }
  function describe(line, kind) {
    const t = line.text
    // opencode names the tool itself: "→ Read context/tweet.md", "← Write output/index.html".
    if (kind === 'read' || kind === 'write' || kind === 'search') return t.slice(2)
    if (kind === 'shell') return 'Running ' + t.slice(2)
    if (kind === 'thought') return 'Thinking — ' + t.replace(/\*\*/g, '').slice(0, 90)
    if (kind === 'code') return 'Writing the card…'
    return null
  }
  function clearLog() {
    log.replaceChildren()
    lineCount = 0
    el('count').textContent = '0 lines'
  }
  function appendLines(lines) {
    if (!lines.length) return
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    const cursor = log.querySelector('.cursor')
    if (cursor) cursor.remove()
    const empty = log.querySelector('.empty')
    if (empty) empty.remove()
    const fragment = document.createDocumentFragment()
    for (const line of lines) {
      const kind = classify(line)
      const row = document.createElement('span')
      row.className = 'l ' + kind
      const time = document.createElement('span')
      time.className = 't'
      time.textContent = new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      row.append(time, line.text)
      fragment.append(row)
      const doing = describe(line, kind)
      if (doing) { setDoing(doing); doingFromLog = true }
      else if (kind === 'pipe') doingFromLog = false
    }
    log.append(fragment)
    lineCount += lines.length
    while (log.childElementCount > MAX_LINES) log.firstElementChild.remove()
    el('count').textContent = lineCount + ' lines'
    if (follow && (atBottom || lineCount === lines.length)) log.scrollTop = log.scrollHeight
  }
  function showCursor() {
    if (log.querySelector('.cursor')) return
    const c = document.createElement('span')
    c.className = 'cursor'
    log.append(c)
  }
  el('follow').addEventListener('click', (e) => {
    follow = !follow
    e.currentTarget.setAttribute('aria-pressed', String(follow))
    if (follow) log.scrollTop = log.scrollHeight
  })
  log.addEventListener('wheel', () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    if (!atBottom && follow) { follow = false; el('follow').setAttribute('aria-pressed', 'false') }
  }, { passive: true })

  // ── The post ─────────────────────────────────────────────────────────────
  function renderMedia(into, items) {
    into.replaceChildren()
    for (const item of Array.isArray(items) ? items : []) {
      const src = item.type === 'image' ? item.url : item.thumbnail
      if (!src) continue
      const img = document.createElement('img')
      img.src = src
      img.alt = item.type
      img.loading = 'lazy'
      into.append(img)
    }
  }
  let postShown = false
  function renderPost(tweet) {
    if (!tweet || !tweet.author) return
    const a = tweet.author
    // Text only, never markup: this is a stranger's post.
    el('name').textContent = a.name || a.handle
    el('handle').textContent = a.handle
    el('avatar').src = a.avatar || ''
    el('badge').hidden = !a.verifiedBadge
    if (a.verifiedBadge) el('badge').src = a.verifiedBadge
    const replying = tweet.replyingTo || []
    el('replying').hidden = !replying.length
    el('replying').replaceChildren('Replying to ', ...replying.map((h, i) => { const b = document.createElement('b'); b.textContent = (i ? ' ' : '') + h; return b }))
    el('text').textContent = tweet.text || ''
    renderMedia(el('media'), tweet.media)
    const q = tweet.quote
    el('quote').hidden = !q
    if (q) {
      el('q-name').textContent = q.author.name || q.author.handle
      el('q-handle').textContent = q.author.handle
      el('q-avatar').src = q.author.avatar || ''
      el('q-badge').hidden = !q.author.verifiedBadge
      if (q.author.verifiedBadge) el('q-badge').src = q.author.verifiedBadge
      el('q-text').textContent = q.text || ''
      renderMedia(el('q-media'), q.media)
    }
    const s = tweet.stats || {}
    el('replies').textContent = count(s.replies)
    el('retweets').textContent = count(s.retweets)
    el('likes').textContent = count(s.likes)
    el('date').textContent = formatDate(tweet.date)
    el('post-skeleton').hidden = true
    el('post-body').hidden = false
    postShown = true
  }

  // ── The result ───────────────────────────────────────────────────────────
  function resetResult(format) {
    el('frame').style.aspectRatio = RATIOS[format] || RATIOS.x_post
    el('painting').hidden = false
    el('painting').textContent = 'Designing…'
    el('png').hidden = true
    el('actions').hidden = true
    el('quality').hidden = true
  }
  function showResult(job) {
    const assets = job.assets
    if (!assets) return
    const img = el('png')
    img.onload = () => { el('painting').hidden = true; img.hidden = false; el('frame').style.aspectRatio = '' }
    img.src = assets.png + '?v=' + Date.now()
    el('open').href = assets.preview
    el('download').href = assets.png + '?download'
    el('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(assets.preview); el('copy').textContent = 'Copied ✓' } catch { el('copy').textContent = 'Copy failed' }
      setTimeout(() => { el('copy').textContent = 'Copy link' }, 1800)
    }
    el('actions').hidden = false
    const q = job.quality
    const box = el('quality')
    box.replaceChildren()
    if (q) {
      const line = document.createElement('div')
      line.textContent = q.passed
        ? '✿ Passed every check' + (q.repairs ? ' after ' + q.repairs + ' repair' : '') + (q.houseDesign ? ' — using the house design' : '') + '.'
        : q.issues.length + ' open issue(s) — the card is still exported:'
      box.append(line)
      if (!q.passed) {
        const list = document.createElement('ul')
        for (const i of q.issues.slice(0, 8)) { const li = document.createElement('li'); li.textContent = i.rule + ' — ' + i.detail; list.append(li) }
        box.append(list)
      }
      if (job.usage && job.usage.totalTokens) {
        const usage = document.createElement('div')
        usage.style.marginTop = '6px'
        usage.textContent = count(job.usage.totalTokens) + ' tokens · ' + Object.values(job.timings || {}).reduce((a, b) => a + b, 0) + 's'
        box.append(usage)
      }
      box.hidden = false
    }
  }

  // ── The build ────────────────────────────────────────────────────────────
  function openWorkshop(format) {
    el('workshop').hidden = false
    clearLog()
    showCursor()
    paintStages('queued', 'extract')
    doingFromLog = false
    setDoing('Waking up…')
    setLive(true)
    resetResult(format)
    postShown = false
    el('post-skeleton').hidden = false
    el('post-body').hidden = true
  }
  function finish(ok, text) {
    setLive(false)
    stopClock()
    go.disabled = false
    go.textContent = 'Design'
    const cursor = log.querySelector('.cursor')
    if (cursor) cursor.remove()
    if (!ok) {
      msg.textContent = text
      setDoing(text)
      el('painting').textContent = 'No card this time'
    } else setDoing('Done — your card is ready.')
  }

  async function watch(id, mine) {
    let next = 0
    let stage = null
    let failures = 0
    for (;;) {
      if (mine !== run) return
      let res
      try { res = await getJson('/v1/cards/' + id + '/logs?after=' + next) } catch { res = null }
      if (mine !== run) return
      if (!res || res.status >= 500) {
        if (++failures > 8) return finish(false, 'Lost contact with the server.')
        await sleep(POLL_MS * 2)
        continue
      }
      failures = 0
      if (res.status === 429) { await sleep(5000); continue }
      if (res.status === 404) return finish(false, 'That card was not found — it may have expired.')
      const data = res.body
      appendLines(data.lines || [])
      showCursor()
      next = data.next || next
      const terminal = data.status === 'completed' || data.status === 'failed'
      if (data.stage !== stage || terminal) {
        stage = data.stage
        paintStages(data.status, data.stage)
        const job = await getJson('/v1/cards/' + id).catch(() => null)
        if (job && job.body && job.body.id) {
          const j = job.body
          if (!postShown && j.tweet) renderPost(j.tweet)
          if (j.engine) el('engine').textContent = j.engine + (j.input && j.input.motion ? ' · motion & 3D' : '')
          if (!ticking && !terminal) startClock(j.createdAt)
          if (j.status === 'completed') {
            showResult(j)
            el('result').scrollIntoView({ behavior: 'smooth', block: 'start' })
            return finish(true)
          }
          if (j.status === 'failed') return finish(false, (j.error && j.error.message) || 'The card could not be built.')
        }
      }
      // Drain quickly when there is a backlog (a reload mid-build), otherwise poll gently.
      await sleep((data.lines || []).length >= 500 ? 100 : POLL_MS)
    }
  }

  async function start(link) {
    const mine = ++run
    const format = (form.querySelector('input[name=format]:checked') || {}).value || 'x_post'
    msg.textContent = ''
    go.disabled = true
    go.textContent = 'Designing…'
    openWorkshop(format)
    startClock()
    el('workshop').scrollIntoView({ behavior: 'smooth', block: 'start' })

    // The post appears at once from /tweet while the job queues; the job's copy is the fallback.
    getJson('/tweet?url=' + encodeURIComponent(link)).then((r) => { if (mine === run && r.body && r.body.ok) renderPost(r.body.tweet) }).catch(() => {})

    let created
    try {
      created = await getJson('/v1/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: link, format, instructions: el('guide').value.trim(), motion: el('motion').checked }),
      })
    } catch { return finish(false, 'Could not reach the server.') }
    if (!created.body.id) return finish(false, (created.body.error && created.body.error.message) || 'Could not start the card.')
    history.replaceState(null, '', '#' + created.body.id)
    watch(created.body.id, mine)
  }

  // ── The size control: one glass drop that stretches to the chosen option ──
  // It reaches across from the old option to the new one, squashing a little as it goes, overshoots
  // the new width, and settles — the way Liquid Glass moves between two places.
  const seg = form.querySelector('.seg')
  const drop = seg.querySelector('.drop')
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let dropAt = null
  function slideDrop(animate) {
    const checked = seg.querySelector('input:checked')
    if (!checked) return
    const box = seg.getBoundingClientRect()
    const r = checked.nextElementSibling.getBoundingClientRect()
    const to = { x: r.left - box.left, w: r.width }
    const from = dropAt
    dropAt = to
    const px = (n) => n.toFixed(1) + 'px'
    drop.style.transform = 'translateX(' + px(to.x) + ')'
    drop.style.width = px(to.w)
    if (!animate || !from || still.matches || !drop.animate) return
    const left = Math.min(from.x, to.x)
    const span = Math.max(from.x + from.w, to.x + to.w) - left
    const ahead = to.x > from.x ? 1 : -1
    drop.animate([
      { transform: 'translateX(' + px(from.x) + ') scaleY(1)', width: px(from.w) },
      { offset: 0.42, transform: 'translateX(' + px(left) + ') scaleY(0.84)', width: px(span) },
      { offset: 0.72, transform: 'translateX(' + px(to.x - ahead * to.w * 0.03) + ') scaleY(1.05)', width: px(to.w * 1.06) },
      { transform: 'translateX(' + px(to.x) + ') scaleY(1)', width: px(to.w) },
    ], { duration: 620, easing: 'cubic-bezier(.3,.7,.2,1)' })
  }
  seg.addEventListener('change', () => slideDrop(true))
  addEventListener('resize', () => slideDrop(false))
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => slideDrop(false))
  slideDrop(false)

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const link = parseLink(input.value)
    if (!link) { msg.textContent = 'That does not look like a post link — try https://x.com/name/status/123…'; input.focus(); return }
    start(link)
  })
  input.addEventListener('input', () => { msg.textContent = '' })
  el('again').addEventListener('click', () => {
    run++
    history.replaceState(null, '', location.pathname)
    el('workshop').hidden = true
    input.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
    input.focus()
  })

  // A reload, a shared link or a changed hash resumes the build it names.
  function resume() {
    const id = location.hash.slice(1)
    if (!/^card_[a-z0-9]{20}$/.test(id)) return
    const mine = ++run
    stopClock()
    go.disabled = true
    go.textContent = 'Designing…'
    openWorkshop('x_post')
    getJson('/v1/cards/' + id).then((r) => {
      if (r.body && r.body.format) resetResult(r.body.format.id)
      if (r.body && r.body.tweet) renderPost(r.body.tweet)
      if (r.body && r.body.input && r.body.input.url) input.value = r.body.input.url
    }).catch(() => {})
    watch(id, mine)
  }
  addEventListener('hashchange', resume)
  resume()
})()
`
