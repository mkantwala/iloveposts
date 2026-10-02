# Self-hosting guide

This walks through running your own copy of iloveposts (`iloveposts`) on your Cloudflare account —
locally first, then deployed. Everything runs on Cloudflare; there is no other service to set up.

Allow about 20 minutes. For what the project does, see the [README](../README.md).

---

## 1. Requirements

| | Why |
| --- | --- |
| **A Cloudflare account on the Workers Paid plan** ($5/month) | Containers require it. On the Free plan, deploys fail with `401 … You do not have access to Cloudflare Containers`. |
| **Node.js 22 or newer** | to run Wrangler |
| **Docker Desktop, running** | Wrangler builds the sandbox image locally, both for `wrangler dev` and on every deploy |
| **Git** | to get the code |

Upgrade at **Dashboard → Workers & Pages → Plans**.

---

## 2. Get the code

```bash
git clone <your-repo-url> iloveposts
cd iloveposts
npm install
npx wrangler login
```

`wrangler login` opens a browser to authorise Wrangler on your account. Check it worked:

```bash
npx wrangler whoami
```

Always use the project's Wrangler (`npx wrangler …` or the `npm run` scripts). An older global
`wrangler` may fail at start-up with `does not provide an export named 'tracing'`.

---

## 3. Resources

There is nothing to create by hand. On the first deploy Cloudflare provisions the Durable Objects
(`CardJob`, `Quota`, `Sandbox`), the container and the rate limiters, and Wrangler creates the KV
namespace — the `CARD_CACHE` binding in `wrangler.jsonc` deliberately has no `id` — and writes its id
back into `wrangler.jsonc`. Commit that change.

If you copied this repository from someone else's deployment and `CARD_CACHE` already has an `id`,
remove it: that namespace is in their account. The preflight (step 6) catches this.

The two rate limiters' `namespace_id` values (`1001`, `1002`) only need to be integers unique within
your account; keep them unless you already use those numbers.

## 4. Create an API token

*Optional.* The direct designer calls Workers AI through the Worker's `AI` binding and needs no
token. The token is for the opencode agent — the fallback when a design request fails, or the engine
with `DESIGN_ENGINE=agent` — which runs inside a container and reaches Workers AI over HTTP.
The token never enters the container: the container holds a placeholder, and the Worker attaches the
real token to each outgoing Workers AI request.

1. Go to **Dashboard → My Profile → API Tokens → Create Token**.
2. Use the **Workers AI** template, or a custom token with **Account → Workers AI → Read** and
   **Workers AI → Edit**.
3. Limit it to your account and create it. Copy the token — it is shown once.

You also need your **Account ID**: Dashboard → Workers & Pages → the right-hand sidebar, or
`npx wrangler whoami`.

---

## 5. Run it locally

Create `.dev.vars` in the project root (it is git-ignored — never commit it):

```bash
# The model, overriding AGENT_MODEL in wrangler.jsonc — any Workers AI text-generation id.
AGENT_MODEL=@cf/zai-org/glm-4.7-flash
# "direct" (one request per design) or "agent" (the opencode loop — far more tokens).
DESIGN_ENGINE=direct
# Optional — only for the opencode agent (step 4):
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-api-token
```

The token, when set, is attached at egress by the Worker — the build sandbox only ever sees a
placeholder.

Start Docker Desktop, then:

```bash
npm run dev
```

The first start builds the sandbox image (a minute or two); later starts reuse it. When you see
`Ready on http://localhost:8787`, open that address, paste a tweet link and press Enter.

Or use the API directly:

```bash
curl -s -X POST http://localhost:8787/v1/cards \
  -H 'content-type: application/json' \
  -d '{"url":"https://x.com/karpathy/status/2039805659525644595"}'

# then, with the id it returns:
curl -s http://localhost:8787/v1/cards/card_xxxxxxxxxxxxxxxxxxxx
```

Browser Rendering and the model have no local simulation: under `wrangler dev` they call the real
services on your account, so local cards cost the same as deployed ones.

---

## 6. Deploy

Check everything first:

```bash
npm run preflight
```

It verifies the machine (Node, Docker, image tag), the configuration, the code, and the account —
login scopes, Workers Paid, that the models exist and the agent model supports tool calling, the KV
namespace, the deployed secrets and your `.dev.vars` token — and prints the estimated model cost per
card. Each failure says how to fix it.

Then deploy:

```bash
npm run deploy
```

`npm run deploy` runs the preflight again and stops if any check fails. (`npx wrangler deploy` skips
it — prefer the npm script.) Docker must be running: the deploy builds the sandbox image and pushes it
to Cloudflare.

If you use the opencode agent, set its secrets on the deployed Worker (the same values as `.dev.vars`):

```bash
# optional — only for the opencode agent:
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
```

With the direct designer (the default) no secret is required: the model is reached through the `AI`
binding.

Secrets take effect immediately; no redeploy is needed. On a first deploy the preflight warns that it
cannot check secrets yet — this is the step that sets them.

The Worker is now live at `https://iloveposts.<your-subdomain>.workers.dev`.

### Verify

```bash
curl -s https://iloveposts.<your-subdomain>.workers.dev/health
```

`200 {"ok":true,"problems":[]}` means the deployment has everything it needs. A `503` lists what is
missing — a secret, a binding or an invalid model — by name, and card creation is refused with
`service_misconfigured` until it is fixed. Point an uptime monitor at `/health` to catch this.

Then create a card as in step 5 and watch it:

```bash
npx wrangler tail
```

Each job logs one line per stage, prefixed with its id:

```
[card_…] extracted @karpathy/2039805659525644595 — 610 words, long
[card_…] design kept: 6120 bytes of CSS in fraunces + inter
[card_…] validated — score 0, issues: none
[card_…] completed after 0 repair(s) — quality passed
[card_…] final usage {"requests":21,"promptTokens":…,"totalTokens":…}
```

### Custom domain (optional)

Dashboard → Workers & Pages → `iloveposts` → **Settings → Domains & Routes → Add → Custom domain**.

---

## 7. Configure

All of these live in `wrangler.jsonc` under `"vars"`. Change them and run `npm run deploy`. To try a
value locally without editing the file, add it to `.dev.vars` or pass
`npx wrangler dev --var NAME:value`.

### Models

| Variable | Default | Role |
| --- | --- | --- |
| `AGENT_MODEL` | `@cf/zai-org/glm-4.7-flash` | the Workers AI model that designs and repairs the card (and drives the opencode fallback, which needs tool calling) |
| `DESIGN_ENGINE` | `direct` | `direct`: one model request per design and per repair, the opencode agent as fallback if its secrets are set. `agent`: always the opencode tool loop (~250–600k tokens) |

Any Workers AI text-generation id works (`npx wrangler ai models list`); `.dev.vars` overrides it
locally. What matters for a choice:

- **Speed.** One Workers AI request is cut off after about five minutes, and the designer writes the
  whole card in one — a slow reasoning model can run out of time before it answers. In testing,
  `@cf/qwen/qwen3.8-27b` (~17–37 tokens/s) did; `@cf/google/gemma-4-26b-a4b-it` (~52 tokens/s) did not.
- **Plan.** Some models need Workers Paid — `@cf/zai-org/glm-5.3-flash` does; on the Free plan it
  fails with `5035`, and the card fails at once with `model_unavailable`.
- **Vision.** A model with vision is shown the tweet's pictures; others get their sizes only.

| Model | Plan | Vision | Notes |
| --- | --- | --- | --- |
| `@cf/zai-org/glm-4.7-flash` (default) | Free | — | GLM flash |
| `@cf/google/gemma-4-26b-a4b-it` | Free | ✓ | fast, ~27 neurons per 1k tokens |
| `@cf/zai-org/glm-5.3-flash` | Paid | ✓ | strong; 1M context |

The preflight checks that the model exists, whether it needs Workers Paid, and whether it has vision
and tool calling.

### Limits

| Variable | Default | |
| --- | --- | --- |
| `CARDS_PER_HOUR_PER_CALLER` | `5` | per hashed client IP |
| `CARDS_PER_DAY_PER_CALLER` | `20` | per hashed client IP |
| `CARDS_PER_DAY_GLOBAL` | `200` | the whole deployment — **your daily cost ceiling** |

The burst limits (60 API requests and 10 `/tweet` requests per minute per caller) are in the
`"ratelimits"` block; their `period` can only be `10` or `60` seconds.

### Concurrency

`max_instances` under `"containers"` is how many cards can build at once (default `2`). A job that
finds no free container retries its build stage. Raise it if jobs queue; each running container is
billed while it runs.

### Formats and the look

- Formats, their sizes, excerpt lengths and type floors: `src/card/formats.ts`
- The design contract the agent works to: `src/markdown/agents.ts`
- The typefaces on the shelf: `src/card/fonts.ts`
- The technical floor every card gets (canvas size, See more, pictures): `src/card/base.ts`
- The fallback design: `src/card/house.ts`

After changing any of these, run `npm run typecheck`.

---

## 8. Costs

Per card, with the direct designer: one request of roughly 20–30k tokens (a few thousand in; the rest
is the model's reasoning and the file), and one more when a repair runs. With `DESIGN_ENGINE=agent`
the opencode loop uses ~250–600k tokens. Workers AI bills in neurons at each model's published price —
`npm run preflight` prints the estimate for your `AGENT_MODEL`. The Free plan includes 10,000 neurons a
day; Workers Paid ($5/month) is needed for Containers anyway and bills Workers AI beyond the free
allowance. Plus a few minutes of container time and under a minute of Browser Rendering.

Every model call's tokens are a line in the card's live log, and each job's `usage` field totals them.

Your worst case per day is roughly `CARDS_PER_DAY_GLOBAL ×` the per-card model cost — with the direct designer, a few cents a card. Watch actual usage in:

- **Workers AI** → usage, in neurons
- **Workers & Pages → Containers** → instance time
- **Browser Rendering** → browser hours
- each job's `usage` field, which reports its exact tokens by model

---

## 9. Updating

```bash
git pull
npm install
npm run deploy        # runs the preflight first
```

Durable Object migrations in `wrangler.jsonc` are applied automatically on deploy. Never edit or
delete an existing migration entry; add a new tag instead.

The sandbox image installs the latest `opencode-ai` when it is built. The base image tag in the
`Dockerfile` must match the `@cloudflare/sandbox` version in `package.json` — update both together.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails: `401 … You do not have access to Cloudflare Containers` | The account is on the Free plan. Upgrade to Workers Paid and deploy again. |
| `The Docker CLI is needed to build the configured image` | Docker Desktop isn't running. Start it and retry. |
| `does not provide an export named 'tracing'` on `wrangler dev` | An old global Wrangler. Use `npm run dev`. |
| `503 service_misconfigured`, or `/health` returns 503 | Its `problems` list names what is missing — usually an invalid `AGENT_MODEL`, a missing `AI` binding, or — with `DESIGN_ENGINE=agent` — the `CF_ACCOUNT_ID` / `CF_API_TOKEN` secrets. |
| Job fails with `model_unavailable` / `5035 … not available on the Workers Free plan` | The model needs Workers Paid. Pick a Free-plan model (see step 7) or upgrade. |
| Log shows `ended the stream … before answering` | The request was cut off (about five minutes) before the model answered — usually a slow reasoning model. Choose a faster `AGENT_MODEL`. |
| Preflight: `KV namespace … is not in this account` | The config carries someone else's namespace id. Delete the `"id"` under `CARD_CACHE`; the next deploy creates yours. |
| Job fails at `extract` / `/tweet` returns 502 | The FxTwitter API (`api.fxtwitter.com`) did not answer. It is retried three times; check it is up and try again. |
| Job fails with `tweet_not_found` | The tweet is deleted, private or from a suspended account. |
| Log shows `the model is rate-limited — the build will be retried` | Workers AI is at capacity (3040 / 429) or the daily allowance is spent (4006). The designer retries after 10s and 30s, then the stage retries; the agent is not used, since it would hit the same limit. Raise the quota or wait. |
| Cards come back with `quality.passed: false` | The designer left measured issues after its one repair. The card is still exported; the issues are listed. A stronger `AGENT_MODEL` helps. |
| `429 rate_limited` / `capacity_reached` | A limit from step 7 was hit; `Retry-After` says when to retry. |
| Local: `Your worker restarted mid-request` | You edited a file while a request was running; `wrangler dev` reloaded. Send it again. |

For anything else, `npx wrangler tail` (deployed) or the `wrangler dev` output (local) shows each
stage, the agent's output and every model call's token usage.

---

## Security checklist

- Keep `CF_API_TOKEN` scoped to Workers AI on your account only. It is used solely at egress; the
  container never sees it.
- Never commit `.dev.vars`; it is in `.gitignore`.
- The API has **no authentication**. The quotas bound its cost, but anyone who can reach it can use
  up your daily ceiling. For a private deployment, put it behind
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) or add an
  API key check in `src/api/cards.ts`.
