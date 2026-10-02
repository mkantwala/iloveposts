# iloveposts 🖤

**Beautify your x.com posts with LLM.** Paste a tweet link, optionally say how it should look, and get
back a typeset image of the tweet sized for X — plus an interactive version with "See more".

This repository is `iloveposts`: a single Cloudflare Worker that serves the landing page and the API,
and runs the whole pipeline on Cloudflare — Durable Objects, a Sandbox container and Browser
Rendering, with the designer on Workers AI.

To run your own copy, see **[docs/self-hosting.md](docs/self-hosting.md)**.

---

## What it produces

For one tweet URL, a finished card is:

- **a PNG** at the exact size of the chosen X format, ready to post
- **a self-contained HTML file** — fonts, avatar and media inlined, no network access — with a working
  **See more / See less** for long tweets
- **a preview page** that scales the card to fit any window

The card shows the tweet as a post — the author, "Replying to @…" for a reply, the text, its media, a
**quoted tweet** with its own author, text and picture, then the date and counts — inside a visual
world designed for that tweet: a concept, artwork, palette and typography derived from what it says
and shows. Every word, name, number and date comes from the tweet itself. The model decides how it
looks, never what it says.

### Static or Motion & 3D

Every card is one self-contained HTML document. Tick **Motion & 3D** on the page (or send
`"motion": true`) and the designer also decides what moves and how —
an entrance, depth and tilt, an ambient background, counts that count up — within one rule: motion
reinforces the hierarchy, and nothing moves for its own sake.

Static cards can use a script too, drawn once on load — Canvas 2D artwork, generated SVG. Native
HTML, CSS, Canvas 2D, SVG and JavaScript come first. Two vendored libraries are there when a
design genuinely needs them — **Three.js** for WebGL 3D scenes and **GSAP** for timelines — built into
the sandbox image and inlined into the card, so nothing is ever fetched. Motion settles within 2.5 seconds; the PNG is the settled frame, and the interactive version is the HTML and
the preview. Viewers who prefer reduced motion get the card still.

### Formats

| `format` | Size | Ratio | For |
| --- | --- | --- | --- |
| `x_post` *(default)* | 1600 × 900 | 16:9 | an image attached to a post |
| `x_square` | 1200 × 1200 | 1:1 | a square post image |
| `x_card` | 1200 × 628 | 1.91:1 | a link-preview card (`summary_large_image`) |

X shows post images at roughly a third of their size in the timeline, so type is set large: the tweet
body is at least 40px on `x_post`, which reads at about the size of a normal tweet on a phone.

---

## How it works

```
POST /v1/cards ─► CardJob (one Durable Object per card, one alarm per stage)

  extract   one GET to the FxTwitter API: the tweet as structured JSON — author, verification,
            text, date, media, counts, reply and quote — then measured: length, title line, excerpt
  build     the pipeline writes the tweet as semantic HTML from data — every word, count, image
            and attribute — and the designer (a Workers AI model, AGENT_MODEL) designs it in ONE
            request: brief, tweet, page and the tweet's pictures in; the complete index.html out —
            its <style>, its [data-artwork] layer and its <script>. Content lock then keeps only
            that design and rebuilds the tweet's content from data again
  validate  the card is rendered in Chromium and measured: canvas size, clipping, type sizes,
            exact text, avatar/badge/media present, See more working, …
  repair    at most one more request, carrying only the current page and the measured
            violations, with "fix only these";
            if it makes things worse, the previous version is kept. If the best version still
            has high-severity problems, the built-in house design is tried in its place
  export    HTML and PNG stored in KV, the container destroyed
```

Each stage persists its result before the next begins, so a crash, deploy or eviction resumes where it
left off, and a stage is the unit of retry.

That is the whole pipeline: tweet → metadata → one design request → one self-contained HTML file →
Chromium → PNG. There is no separate art-direction step and no menu of themes or layouts to choose
from; the designer reads the tweet, looks at its pictures, and decides the look itself.

**One request, not an agent loop.** A card is a 10–20 KB file. The opencode coding agent got there in
a dozen or more tool turns, each resending the whole growing conversation — about 500k tokens a card.
The direct designer is handed everything at once, through the Worker's `AI` binding, and answers with
the file: one request of roughly 20–30k tokens a card (most of it the model's reasoning), and one more
for a repair. opencode remains as the fallback when a design request fails, if its token is set (and
as the engine with `DESIGN_ENGINE=agent`), on a hard budget of 12 model calls per build and 6 per
repair, enforced at egress. Every model call's tokens
appear in the live log and in `usage`.

**The designer only designs.** The page has two ownership zones: `[data-artwork]`, which is the
designer's — any SVG, shapes, canvas or decorative markup — and `[data-card]`, the tweet, which is
locked. Only the artwork, the `<style>` and the `<script>` survive; the tweet is rebuilt from data, so
the model cannot misquote it, drop a label, invent a count or break the markup the checks rely on.

**A broken card is never shipped.** When a model cannot lay a card out — text off the canvas, clipped
or invisible — the pipeline tries its house design: a restrained, known-good design for the same
markup that passes every check in every format, static and Motion & 3D. The better of the two is
exported, and `quality.houseDesign` says which it was.

### Design approach

The goal is a card that looks designed for *this* tweet. The brief (`src/markdown/agents.ts`)
constrains quality, not visual language:

| Fixed | Free |
| --- | --- |
| the tweet's content and structure, its hierarchy (author → tweet → media/quote → date → engagement), minimum type sizes and contrast, the safe area, the canvas size, artwork never covering the text | the concept, palette, background treatment, the card's material (or no visible card), composition, illustration, patterns, texture, light and depth, typographic decoration, diagrams, Canvas and SVG artwork, motion |

- **Concept first.** Before writing, the designer decides privately what the tweet is about, what
  visual metaphor belongs to it, what should be noticed first, and what makes it unlike a generic card.
- **No defaults.** Black backgrounds with dark cards, generic or purple/blue "AI" gradients, neon,
  glassmorphism and a centred floating rectangle as the whole idea are named and ruled out — dark is
  fine when the concept calls for it, not as the default.
- **Signals.** The tweet's facts — the figures it quotes, technical vocabulary, a question, a list, a
  quote — are counted (`src/card/analysis.ts`) and handed over as raw material for a concept.
- **No repeats.** After each export the measured design is described in words ("near-white orange
  background; white card, shadowed; Space Grotesk; canvas artwork") and kept in KV
  (`src/card/recent.ts`). The next designer sees the last six and must not repeat their palette,
  background treatment, composition or motif.

Typefaces come from an embedded shelf of eight open-licence families (sans, serif and mono); the
designer links the ones it chooses and only those are inlined.

### Quality checks

The validate stage is deterministic — no model looks at the result. It renders the card in Browser
Rendering and checks, with measured values:

| Area | Checks |
| --- | --- |
| Canvas | exact export size, page never scrolls, card inside the canvas with clear margins, card width within the format's range, vertical balance |
| Text | excerpt word-for-word, title line set as its own heading, body and minimum text sizes, line length and leading, at most two font families |
| Restraint | no randomly emphasised words in the tweet text, no stacked colour + highlight + underline, at most two body colours |
| Artwork | never on top of the tweet's text (hit-tested at each text element); its own text and images kept out of the content checks; no script or style of its own |
| Content | display name, handle, badge, "Replying to" and the quoted tweet fully visible, every media item, all four counts with their exact labels, metadata quieter than the tweet |
| Behaviour | See more expands to the full text and back, no JavaScript errors, no scripts beyond the pipeline's own (and, in motion mode, one of the card's), no remote or missing resources |
| Motion | measured after the card settles (3s, then every finite animation is finished); every piece of text fully visible; a `prefers-reduced-motion` fallback present |

Every issue carries its measurement ("the card is 18px from the canvas edge"), and the repair pass gets
a specific fix for each rule.

---

## API

All responses are JSON. Errors are `{ "error": { "code": "…", "message": "…" } }`.

### Create a card

```http
POST /v1/cards
Content-Type: application/json
Idempotency-Key: 3f2a9c1e-optional-key

{
  "url": "https://x.com/karpathy/status/2039805659525644595",
  "format": "x_post",
  "instructions": "calm and editorial",
  "motion": false
}
```

| Field | Required | Values |
| --- | --- | --- |
| `url` | yes | an `https://x.com/{handle}/status/{id}` (or `twitter.com`) link |
| `format` | no | `x_post` (default), `x_square`, `x_card` |
| `instructions` | no | free text, up to 500 characters, e.g. "dark, minimal" — the agent follows it |
| `motion` | no | `true` for a Motion & 3D card; `false` (default) for a static one |

Returns **`202 Accepted`** with the job and a `Location: /v1/cards/{id}` header. Sending the same
`Idempotency-Key` again within 24 hours returns the existing job instead of starting another.

### Check a card

```http
GET /v1/cards/{id}
```

Poll until `status` is `completed` or `failed`. A card takes roughly 2–6 minutes.

```jsonc
{
  "id": "card_mdpacshmdl49uvsvnhqf",
  "status": "completed",            // queued | processing | completed | failed
  "stage": "export",                // extract | build | validate | repair | export
  "format": { "id": "x_post", "label": "X post image", "width": 1600, "height": 900, "ratio": "16:9" },
  "input": { "url": "…", "format": "x_post", "instructions": "calm and editorial", "motion": false },
  "tweet": { "url": "…", "author": { "name": "Andrej Karpathy", "handle": "@karpathy", … }, "text": "…", "stats": { … }, "replyingTo": [], "quote": null },
  "motion": false,
  "quality": { "passed": true, "repairs": 0, "houseDesign": false, "issues": [], "metrics": { … } },
  "timings": { "extract": 2, "build": 173, "validate": 13, "export": 0 },
  "usage": { "requests": 21, "promptTokens": 330847, "completionTokens": 3844, "totalTokens": 334691, "byModel": { … } },
  "assets": {
    "preview": "https://…/v1/cards/card_…/preview",
    "png": "https://…/v1/cards/card_…/png",
    "html": "https://…/v1/cards/card_…/html"
  },
  "error": null,
  "retentionSeconds": 2592000
}
```

`assets` is `null` until the card has been rendered. `quality.passed` is `false` when measured issues
remained after the repair pass; the card is still exported, and the issues are listed.

### Download a card

| Endpoint | Returns |
| --- | --- |
| `GET /v1/cards/{id}/logs?after=N` | the live build log after line `N` — `{ status, stage, lines: [{ n, at, kind, text }], next }`, where `kind` is `agent` (the designer's streamed file, or opencode's raw shell output: tool calls, commands and what they print), `thought` (the model's thinking, as it streams) or `pipeline` (stage lines, and one line per model call with its tokens). Poll it with the last `next` |
| `GET /v1/cards/{id}/preview` | an HTML page showing the card scaled to the window, in a sandboxed frame |
| `GET /v1/cards/{id}/html` | the card as one self-contained HTML file (strict CSP: no network, scripts sandboxed) |
| `GET /v1/cards/{id}/png` | the PNG; add `?download` to get it as an attachment |

Cards and their records are kept for 30 days.

### Other endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /` | the landing page |
| `GET /health` | `200 { "ok": true, "problems": [] }`, or `503` listing what the deployment is missing (names only, never values) |
| `GET /tweet?url=…` | the tweet on its own, from FxTwitter: author, text, date, media, counts (including bookmarks and quotes), reply and quote info |

### Errors

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_body`, `invalid_url`, `invalid_format`, `invalid_instructions`, `invalid_motion`, `invalid_idempotency_key` | the request was malformed |
| 404 | `not_found` | no card with that id |
| 404 | `not_ready` | the card exists but has not been rendered yet |
| 429 | `rate_limited` | a per-caller limit was hit — see `Retry-After` |
| 429 | `capacity_reached` | the deployment's daily card limit was hit |
| 503 | `service_misconfigured` | the deployment is missing a secret, binding or valid model — see `/health` |

A job that fails reports it in `error`, with one of: `tweet_not_found`, `engine_unavailable` (missing configuration), `workspace_lost`, or
`{stage}_failed` after that stage's retries.

---

## Limits

| Limit | Default | Enforced by |
| --- | --- | --- |
| Cards per caller per hour | 5 | `Quota` Durable Object (exact) |
| Cards per caller per day | 20 | `Quota` Durable Object (exact) |
| Cards per day, whole deployment | 200 | `Quota` Durable Object (exact) — the cost ceiling |
| `/v1/cards` requests per caller | 60 / minute | Rate Limiting binding |
| `/tweet` requests per caller | 10 / minute | Rate Limiting binding |
| Cards building at once | 2 | container `max_instances` |

A caller is a hashed client IP. The API has no authentication; these limits are what bound its cost.

---

## Cost

At Cloudflare's published prices:

| | Per card |
| --- | --- |
| Model — the direct designer, one request of ~20–30k tokens (and one more for a repair) | billed in Workers AI neurons at `AGENT_MODEL`'s price; `npm run preflight` prints the estimate (≈$0.01–0.02 on `glm-5.3-flash`) |
| — the opencode agent loop instead (`DESIGN_ENGINE=agent`, ~250–600k tokens) | roughly 10–20× that |
| Container (`standard-1`, a few minutes) | ~$0.005 |
| Browser Rendering (~30–60s) | ~$0.001 |
| Durable Objects, KV, requests | < $0.001 |

Plus the $5/month Workers Paid plan, which Containers require; it includes 10 browser-hours a month and
some container time. The Free plan's 10,000 neurons a day cover a handful of cards on a cheap model.
Every job reports its exact token usage in `usage`, and every model call is a line in its live log.

---

## Security

- **No model credential enters the container.** The direct designer uses the Worker's `AI` binding — no
  token at all. The opencode agent is given a placeholder API key; the real Workers AI token is
  attached at egress by the Sandbox's outbound handler, which runs in the Workers runtime.
- **Card HTML is treated as untrusted.** It is served with a CSP that blocks all network access and
  sandboxes scripts, and the preview frames it with `sandbox="allow-scripts"`, so model-written HTML
  cannot act on this origin.
- **The tweet is rendered as data.** Text is inserted with `textContent`, never as markup, and the full
  text for See more is written by the pipeline, not retyped by a model.
- **Inputs are validated** at the API boundary: URL shape, enums, lengths, idempotency-key format.

---

## Project layout

```
src/
  index.ts            routes: page, /health, /tweet, /v1/cards; exports the Durable Objects
  health.ts           runtime configuration checks for /health and card creation
  site/
    page.ts           the landing page: form, live studio, result
    style.ts          its look
    script.ts         its behaviour: polling, the live terminal, resume on reload
  scope.ts            hashed caller id for limits and idempotency
  api/
    cards.ts          the /v1/cards API
    quota.ts          Quota Durable Object: per-caller and global creation limits
    sandbox.ts        Sandbox subclass: egress credential injection and token-usage recording
    assets.ts         downloads the real avatar, badge and media for the card
    toggle.ts         generates the See more / See less script
  card/
    job.ts            CardJob Durable Object: the stage machine
    log.ts            the job's live log: the designer's stream, its thinking, the stage and token lines
    designer.ts       the direct designer: one streamed model request in, the whole index.html out
    recent.ts         recent designs, described from the render, so the next card avoids them
    review.ts         scoring a version, and the review a repair is given
    formats.ts        the X formats — the only place card dimensions live
    analysis.ts       deterministic content analysis
    engines.ts        model configuration, and the opencode agent (the fallback engine)
    base.ts           base.css: the technical floor — canvas size, See more, picture defaults
    fonts.ts          the embedded type shelf, cached in KV
    workspace.ts      lays out the sandbox, runs the agent, applies content lock, reads the output
    scaffold.ts       writes the card's HTML from data, and rebuilds it around the agent's design
    house.ts          the fallback design, used when the agent's best version is still broken
    libraries.ts      the libraries a Motion & 3D card may use (Three.js, GSAP) and their versions
    bundle.ts         folds the output into one self-contained HTML file
    measure.ts        the in-browser measurement script
    qa.ts             renders, measures and screenshots in Browser Rendering
    viewer.ts         the preview page
  markdown/
    agents.ts         the design contract (fixed vs free, concept, defaults to avoid) and both engines' output rules
    tweet.ts          the tweet as Markdown, and the excerpt cut
  twitter/
    fxtwitter.ts      fetches a tweet from the FxTwitter API and maps it onto a Tweet
    tweet.ts          the Tweet record, tweet-URL parsing, the verification badge
scripts/
  preflight.mjs       deploy checks: machine, config, code, account, models, KV, secrets
  check-page.mjs      checks the landing page's script parses
  check-generated.mjs checks the generated scripts (toggle, viewer, measurement) parse
Dockerfile            the build sandbox image: opencode, plus Three.js and GSAP builds in /opt/card-libs
wrangler.jsonc        bindings, models, limits, migrations
```

## Development

```bash
npm install
npm run dev          # wrangler dev on http://localhost:8787 (needs Docker running)
npm run typecheck    # TypeScript + generated-script checks
npm run preflight    # everything a deploy needs — see below
npm run deploy       # runs preflight first, then wrangler deploy
```

### Preflight

`npm run preflight` (and automatically, `npm run deploy`) checks, and refuses to deploy on failure:

| Area | Checks |
| --- | --- |
| Machine | Node 22+, project Wrangler installed, Docker running, sandbox image tag matches the SDK |
| Configuration | `wrangler.jsonc` parses; model ids, quotas and rate limiters valid; every Durable Object bound and migrated; container and KV configured |
| Code | typecheck and generated-script checks |
| Account | logged in with the scopes a deploy needs; Containers available (Workers Paid); `AGENT_MODEL` exists in the Workers AI catalog (and whether it needs Workers Paid, has vision and tool calling); KV namespace exists or will be created; the deployed Worker has its secrets; the `.dev.vars` token can use Workers AI |

It also prints the estimated model cost per card from the catalog's current prices. Use
`npm run preflight -- --local` to skip the account checks.

At runtime the same configuration is checked on every request that needs it: `/health` returns 503
with the problems, and `POST /v1/cards` refuses with `service_misconfigured` rather than starting a
job that would fail.

Several scripts are generated inside TypeScript template literals (the page, the toggle, the viewer,
the measurement script), where a `\n` meant for the output is easy to break. `npm run typecheck`
parses each of them; run it before every deploy.

## Known limitations

- **Tweets come from the FxTwitter API** (`api.fxtwitter.com`), a public third-party service. If it is
  down, extraction retries and then fails with `extract_failed`.
- **Card quality depends on `AGENT_MODEL`.** Models differ a lot in design quality, speed and plan:
  one Workers AI request is cut off after about five minutes, so a slow reasoning model may never
  answer, and some models need Workers Paid. It is a one-line change in `wrangler.jsonc` or
  `.dev.vars` — see docs/self-hosting.md, step 7.
- **Non-Latin scripts** fall back to the browser's own fonts; only Latin subsets are embedded.
- **Video and GIF media** appear as their poster frame.
