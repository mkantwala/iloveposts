/**
 * Preflight: everything a deploy needs, checked before it happens.
 *
 *   npm run preflight            all checks
 *   npm run preflight -- --local only what needs no Cloudflare login (machine, config, code)
 *
 * Runs automatically before `npm run deploy` (npm's predeploy hook). A failed check exits 1 and
 * says how to fix it; warnings are printed but do not block. Nothing here prints a secret value.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const LOCAL_ONLY = process.argv.includes('--local')
const WRANGLER = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname
const root = new URL('..', import.meta.url).pathname

/** Token usage of a typical card with the direct designer, measured: a clean first pass (most of the
 *  output is the model's thinking), and one with the repair request. The agent loop is 10–20× this. */
const TYPICAL = { clean: { input: 4_500, output: 20_000 }, repaired: { input: 14_000, output: 38_000 } }

let failures = 0
let warnings = 0
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
const warn = (msg, fix) => {
  warnings++
  console.log(`  \x1b[33m!\x1b[0m ${msg}${fix ? `\n      → ${fix}` : ''}`)
}
const fail = (msg, fix) => {
  failures++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}${fix ? `\n      → ${fix}` : ''}`)
}
const section = (title) => console.log(`\n${title}`)

/** Runs the project's Wrangler and returns stdout (or null), with its output kept quiet. */
function wrangler(args) {
  const run = spawnSync(WRANGLER, args, { cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
  return { ok: run.status === 0, stdout: run.stdout ?? '', stderr: run.stderr ?? '', all: `${run.stdout ?? ''}${run.stderr ?? ''}` }
}

function json(text) {
  const start = text.search(/[[{]/)
  try {
    return start < 0 ? null : JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

/** wrangler.jsonc, with comments and trailing commas removed — string-aware, so URLs survive. */
function readJsonc(path) {
  const src = readFileSync(path, 'utf8')
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1
    } else out += ch
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function devVars() {
  const path = `${root}.dev.vars`
  if (!existsSync(path)) return null
  const vars = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return vars
}

const WORKERS_AI_ID = /^@(cf|hf)\/[\w.-]+\/[\w.:-]+$/
const isModel = (v) => WORKERS_AI_ID.test(v ?? '')
const positive = (v) => Number.isInteger(Number(v)) && Number(v) > 0

// ─── Machine ───────────────────────────────────────────────────────────────────────────────
section('Machine')

const nodeMajor = Number(process.versions.node.split('.')[0])
nodeMajor >= 22 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} — 22 or newer is required`, 'Install Node 22+ (e.g. nvm install 22).')

existsSync(WRANGLER) ? ok('Wrangler installed in the project') : fail('The project has no node_modules/.bin/wrangler', 'Run npm install.')

const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' })
docker.status === 0
  ? ok(`Docker ${docker.stdout.trim()} running`)
  : fail('Docker is not running — Wrangler builds the sandbox image locally on dev and deploy', 'Start Docker Desktop.')

const dockerfile = readFileSync(`${root}Dockerfile`, 'utf8')
const baseTag = dockerfile.match(/FROM\s+\S*cloudflare\/sandbox:([\w.-]+)/)?.[1]
const sdkVersion = existsSync(`${root}node_modules/@cloudflare/sandbox/package.json`)
  ? JSON.parse(readFileSync(`${root}node_modules/@cloudflare/sandbox/package.json`, 'utf8')).version
  : null
if (!baseTag) fail('Dockerfile does not start FROM cloudflare/sandbox:<version>')
else if (sdkVersion && baseTag !== sdkVersion) fail(`Dockerfile uses sandbox:${baseTag} but @cloudflare/sandbox is ${sdkVersion}`, 'Make the Dockerfile tag match the installed SDK version — the SDK checks this at start-up.')
else ok(`Sandbox image tag ${baseTag} matches the SDK`)

// ─── Configuration ─────────────────────────────────────────────────────────────────────────
section('Configuration (wrangler.jsonc)')

let config
try {
  config = readJsonc(`${root}wrangler.jsonc`)
  ok('wrangler.jsonc parses')
} catch (err) {
  fail(`wrangler.jsonc does not parse: ${err.message}`)
  config = {}
}
const vars = config.vars ?? {}

for (const key of ['AGENT_MODEL']) {
  isModel(vars[key]) ? ok(`${key} = ${vars[key]}`) : fail(`${key} is missing or not a Workers AI model id`, 'Set it in wrangler.jsonc "vars", e.g. "@cf/zai-org/glm-5.3-flash" — any id from npx wrangler ai models list.')
}

;['direct', 'agent'].includes(vars.DESIGN_ENGINE)
  ? ok(`DESIGN_ENGINE = ${vars.DESIGN_ENGINE}${vars.DESIGN_ENGINE === 'direct' ? ' (one request per design, the agent as fallback)' : ' (the opencode agent loop)'}`)
  : fail('DESIGN_ENGINE must be "direct" or "agent"', 'Set it in wrangler.jsonc "vars" — "direct" is far cheaper.')

const quotaKeys = ['CARDS_PER_HOUR_PER_CALLER', 'CARDS_PER_DAY_PER_CALLER', 'CARDS_PER_DAY_GLOBAL']
const badQuota = quotaKeys.filter((k) => !positive(vars[k]))
if (badQuota.length) fail(`${badQuota.join(', ')} must be positive whole numbers`)
else {
  ok(`Quotas: ${vars.CARDS_PER_HOUR_PER_CALLER}/hour and ${vars.CARDS_PER_DAY_PER_CALLER}/day per caller, ${vars.CARDS_PER_DAY_GLOBAL}/day in total`)
  if (Number(vars.CARDS_PER_DAY_PER_CALLER) < Number(vars.CARDS_PER_HOUR_PER_CALLER)) warn('The per-day caller quota is lower than the per-hour one')
  if (Number(vars.CARDS_PER_DAY_GLOBAL) < Number(vars.CARDS_PER_DAY_PER_CALLER)) warn('The global daily quota is lower than one caller’s daily quota')
}

const limiters = config.ratelimits ?? []
const limiterNames = limiters.map((l) => l.name)
const missingLimiters = ['API_RATE_LIMITER', 'TWEET_RATE_LIMITER'].filter((n) => !limiterNames.includes(n))
const badLimiters = limiters.filter((l) => ![10, 60].includes(l.simple?.period) || !/^\d+$/.test(String(l.namespace_id)) || !positive(l.simple?.limit))
const dupNamespaces = limiters.map((l) => String(l.namespace_id)).filter((id, i, all) => all.indexOf(id) !== i)
if (missingLimiters.length) fail(`Missing rate limiters: ${missingLimiters.join(', ')}`)
else if (badLimiters.length) fail(`Rate limiters ${badLimiters.map((l) => l.name).join(', ')} need an integer namespace_id, a positive limit and a period of 10 or 60`)
else if (dupNamespaces.length) fail(`Rate limiters share namespace_id ${dupNamespaces.join(', ')}`)
else ok(`Rate limiters: ${limiters.map((l) => `${l.name} ${l.simple.limit}/${l.simple.period}s`).join(', ')}`)

const doClasses = (config.durable_objects?.bindings ?? []).map((b) => b.class_name)
const migrated = new Set()
for (const m of config.migrations ?? []) {
  for (const c of [...(m.new_sqlite_classes ?? []), ...(m.new_classes ?? [])]) migrated.add(c)
  for (const r of m.renamed_classes ?? []) {
    migrated.delete(r.from)
    migrated.add(r.to)
  }
  for (const c of m.deleted_classes ?? []) migrated.delete(c)
}
const tags = (config.migrations ?? []).map((m) => m.tag)
const unmigrated = ['Sandbox', 'CardJob', 'Quota'].filter((c) => !doClasses.includes(c) || !migrated.has(c))
if (unmigrated.length) fail(`Durable Object classes without a binding or migration: ${unmigrated.join(', ')}`)
else if (new Set(tags).size !== tags.length) fail('Migration tags are not unique')
else ok(`Durable Objects ${doClasses.join(', ')} bound and migrated (${tags.join(' → ')})`)

const container = (config.containers ?? [])[0]
if (!container || container.class_name !== 'Sandbox') fail('No container configured for the Sandbox class')
else ok(`Container ${container.instance_type}, up to ${container.max_instances} building at once`)

const kv = (config.kv_namespaces ?? []).find((k) => k.binding === 'CARD_CACHE')
if (!kv) fail('No CARD_CACHE KV binding')

// ─── Code ──────────────────────────────────────────────────────────────────────────────────
section('Code')

try {
  execFileSync('npm', ['run', '-s', 'typecheck'], { cwd: root, stdio: 'pipe' })
  ok('Typecheck and generated-script checks pass')
} catch (err) {
  fail('npm run typecheck failed', `${String(err.stdout ?? '').trim().split('\n').slice(0, 5).join('\n        ')}`)
}

// ─── Cloudflare account ────────────────────────────────────────────────────────────────────
if (LOCAL_ONLY) {
  console.log('\n(--local: Cloudflare account checks skipped)')
} else {
  section('Cloudflare account')

  const who = json(wrangler(['whoami', '--json']).stdout)
  const account = who?.accounts?.length === 1 ? who.accounts[0] : null
  if (!who?.loggedIn) fail('Not logged in to Cloudflare', 'Run npx wrangler login.')
  else if (!account) fail(`Logged in with access to ${who.accounts?.length ?? 0} accounts — Wrangler needs to know which`, 'Set "account_id" in wrangler.jsonc or CLOUDFLARE_ACCOUNT_ID.')
  else {
    ok(`Logged in as ${who.email ?? 'API token'} — ${account.name}`)
    const needed = ['workers_scripts:write', 'workers_kv:write', 'containers:write', 'ai:write', 'browser:write']
    const perms = who.tokenPermissions ?? []
    const missing = perms.length ? needed.filter((p) => !perms.includes(p)) : []
    missing.length ? fail(`The Wrangler login lacks ${missing.join(', ')}`, 'Run npx wrangler login again and grant all scopes.') : ok('Login has the scopes a deploy needs')

    const containers = wrangler(['containers', 'list'])
    if (/Workers Paid plan|do not have access to Cloudflare Containers/i.test(containers.all)) {
      fail('This account cannot use Containers — it is not on the Workers Paid plan', 'Upgrade at Dashboard → Workers & Pages → Plans.')
    } else if (containers.ok) ok('Containers available (Workers Paid)')
    else warn(`Could not confirm Containers access: ${containers.all.trim().split('\n').pop()}`)

    const catalog = json(wrangler(['ai', 'models', 'list', '--json']).stdout)
    if (!Array.isArray(catalog)) warn('Could not read the Workers AI model catalog')
    else {
      const prop = (m, id) => m.properties?.find((p) => p.property_id === id)?.value
      const cost = {}
      for (const key of ['AGENT_MODEL']) {
        const model = catalog.find((m) => m.name === vars[key])
        if (!model) {
          fail(`${key} ${vars[key]} is not in the Workers AI catalog`, 'Pick a model from npx wrangler ai models list.')
          continue
        }
        const task = typeof model.task === 'object' ? model.task?.name : model.task
        if (task !== 'Text Generation') fail(`${key} ${vars[key]} is a ${task} model, not Text Generation`)
        else {
          ok(`${key} ${vars[key]} found${String(prop(model, 'require_workers_paid')) === 'true' ? ' (requires Workers Paid)' : ''}${String(prop(model, 'vision')) === 'true' ? ' — with vision, so it sees the tweet\'s pictures' : ''}`)
          // Only the opencode agent calls tools; the direct designer does not.
          if (String(prop(model, 'function_calling')) !== 'true') {
            const message = `AGENT_MODEL ${vars[key]} does not support function calling, so the opencode agent cannot use it`
            vars.DESIGN_ENGINE === 'agent' ? fail(message) : warn(`${message} — the direct designer can, but there is no agent fallback`)
          }
        }
        const price = prop(model, 'price') ?? []
        cost[key] = {
          input: price.find((p) => p.unit === 'per M input tokens')?.price,
          output: price.find((p) => p.unit === 'per M output tokens')?.price,
        }
      }
      const agent = cost.AGENT_MODEL
      if (agent?.input !== undefined && agent?.output !== undefined) {
        const estimate = (t) => (t.input / 1e6) * agent.input + (t.output / 1e6) * agent.output
        ok(`Estimated model cost per card: $${estimate(TYPICAL.clean).toFixed(3)} (clean) – $${estimate(TYPICAL.repaired).toFixed(3)} (with repair), before the daily free allocation`)
      }
    }

    if (kv?.id) {
      const namespaces = json(wrangler(['kv', 'namespace', 'list']).stdout)
      if (!Array.isArray(namespaces)) warn('Could not list KV namespaces')
      else if (namespaces.some((n) => n.id === kv.id)) ok(`KV namespace ${kv.id.slice(0, 8)}… exists in this account`)
      else fail(`KV namespace ${kv.id} is not in this account`, 'Remove its "id" from wrangler.jsonc — Wrangler creates one on the next deploy — or replace it with one of yours.')
    } else ok('KV namespace will be created automatically on first deploy')

    // Only the opencode agent needs secrets; the direct designer uses the AI binding.
    const agentRequired = vars.DESIGN_ENGINE === 'agent'
    const neededSecrets = ['CF_ACCOUNT_ID', 'CF_API_TOKEN']

    const secrets = wrangler(['secret', 'list', '--format', 'json'])
    const names = (json(secrets.stdout) ?? []).map?.((s) => s.name) ?? []
    if (/not found|does not exist|10007/i.test(secrets.all) && !names.length) {
      warn('The Worker has not been deployed yet, so its secrets cannot be checked', `After the first deploy, run npx wrangler secret put for: ${neededSecrets.join(', ')}.`)
    } else {
      const missingSecrets = neededSecrets.filter((n) => !names.includes(n))
      if (!missingSecrets.length) ok(`Deployed Worker has ${neededSecrets.join(', ')} — the opencode agent is available`)
      else if (agentRequired) fail(`Deployed Worker is missing secrets: ${missingSecrets.join(', ')}`, `Run npx wrangler secret put ${missingSecrets[0]}.`)
      else warn(`Deployed Worker has no ${missingSecrets.join(', ')} — fine for the direct designer, but there is no agent fallback`)
    }

    const local = devVars()
    if (!local || !local.CF_ACCOUNT_ID || !local.CF_API_TOKEN) warn('.dev.vars has no CF_ACCOUNT_ID / CF_API_TOKEN — local cards use the direct designer only, with no agent fallback')
    else {
      if (local.CF_ACCOUNT_ID !== account.id) warn('.dev.vars CF_ACCOUNT_ID is not the account you are logged in to')
      // The token is checked where it is used: can it read the Workers AI catalog on this account?
      const probe = await fetch(`https://api.cloudflare.com/client/v4/accounts/${local.CF_ACCOUNT_ID}/ai/models/search?per_page=1`, {
        headers: { authorization: `Bearer ${local.CF_API_TOKEN}` },
      }).catch(() => null)
      if (!probe) warn('Could not reach the Cloudflare API to check the .dev.vars token')
      else if (probe.ok) ok('.dev.vars CF_API_TOKEN can use Workers AI on the account')
      else fail(`.dev.vars CF_API_TOKEN was refused by Workers AI (HTTP ${probe.status})`, 'Create a token with Workers AI Read and Edit (docs/self-hosting.md, step 4).')
    }
  }
}

console.log(
  failures
    ? `\n\x1b[31m${failures} check(s) failed\x1b[0m${warnings ? `, ${warnings} warning(s)` : ''} — fix these before deploying.\n`
    : `\n\x1b[32mReady.\x1b[0m${warnings ? ` ${warnings} warning(s) above.` : ''}\n`,
)
process.exit(failures ? 1 : 0)
