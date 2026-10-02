/**
 * The landing page's look: clean "liquid glass" — translucent, blurred panels with a soft specular
 * edge, floating over a quiet colour wallpaper, in the system type. Light by default, dark with the
 * system setting. On wide screens the live log and the post sit side by side at the same height.
 */
export const pageStyle = /* css */ `
:root {
  --bg: #f2f3f7;
  --blob-1: #9fc2ff; --blob-2: #f3b2dc; --blob-3: #a9e8cc;
  --glass: rgb(255 255 255 / .34);
  --glass-strong: rgb(255 255 255 / .78);
  --glass-edge: rgb(255 255 255 / .75);
  --glass-line: rgb(15 23 42 / .08);
  --glass-shadow: 0 1px 1px rgb(15 23 42 / .04), 0 12px 40px -12px rgb(15 23 42 / .18);
  --sheen: linear-gradient(180deg, rgb(255 255 255 / .55), rgb(255 255 255 / 0) 42%);
  --ink: #111318; --ink-2: #4b5160; --ink-3: #8a90a0;
  --field: rgb(255 255 255 / .45);
  /* Liquid glass for controls: nearly clear, with a bright refracting rim. */
  --lens: rgb(255 255 255 / .12);
  --lens-focus: rgb(255 255 255 / .28);
  --lens-tint: linear-gradient(135deg, rgb(255 255 255 / .42), rgb(255 255 255 / .06) 42%, rgb(255 255 255 / .02) 60%, rgb(255 255 255 / .22));
  --rim: inset 0 1px 1px rgb(255 255 255 / .95), inset 0 -1px 1px rgb(255 255 255 / .4), inset 1px 0 1px rgb(255 255 255 / .3), inset -1px 0 1px rgb(255 255 255 / .3), 0 6px 18px -8px rgb(15 23 42 / .22);
  --rim-edge: rgb(255 255 255 / .55);
  --accent: #0a84ff; --ok: #30d158; --bad: #ff453a;
  --term: rgb(18 20 26 / .86); --term-line: rgb(255 255 255 / .08); --term-ink: #e7e9ee; --term-dim: #8b92a3;
  --radius: 26px;
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
  --display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0c10;
    --blob-1: #1d3b7a; --blob-2: #4a1f4f; --blob-3: #10443a;
    --glass: rgb(30 32 40 / .38);
    --glass-strong: rgb(36 38 48 / .78);
    --glass-edge: rgb(255 255 255 / .14);
    --glass-line: rgb(255 255 255 / .08);
    --glass-shadow: 0 1px 1px rgb(0 0 0 / .3), 0 18px 50px -14px rgb(0 0 0 / .7);
    --sheen: linear-gradient(180deg, rgb(255 255 255 / .09), rgb(255 255 255 / 0) 40%);
    --ink: #f3f4f7; --ink-2: #b4b9c6; --ink-3: #7c8293;
    --field: rgb(255 255 255 / .06);
    --lens: rgb(255 255 255 / .05);
    --lens-focus: rgb(255 255 255 / .1);
    --lens-tint: linear-gradient(135deg, rgb(255 255 255 / .16), rgb(255 255 255 / .02) 42%, rgb(255 255 255 / 0) 60%, rgb(255 255 255 / .08));
    --rim: inset 0 1px 1px rgb(255 255 255 / .28), inset 0 -1px 1px rgb(255 255 255 / .1), inset 1px 0 1px rgb(255 255 255 / .08), inset -1px 0 1px rgb(255 255 255 / .08), 0 8px 22px -10px rgb(0 0 0 / .6);
    --rim-edge: rgb(255 255 255 / .16);
    --term: rgb(8 9 12 / .72);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; min-height: 100vh; color: var(--ink); font-family: var(--font); font-size: 15px; -webkit-font-smoothing: antialiased; background: var(--bg); }
a { color: inherit; }
[hidden] { display: none !important; }

/* ── Wallpaper ───────────────────────────────────────────────────────────── */
.wallpaper { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.wallpaper i { position: absolute; border-radius: 50%; filter: blur(90px); opacity: .85; animation: float 28s ease-in-out infinite alternate; }
.wallpaper .b1 { width: 55vw; height: 55vw; left: -12vw; top: -18vw; background: var(--blob-1); }
.wallpaper .b2 { width: 45vw; height: 45vw; right: -10vw; top: 8vh; background: var(--blob-2); animation-delay: -9s; }
.wallpaper .b3 { width: 50vw; height: 50vw; left: 20vw; bottom: -28vw; background: var(--blob-3); animation-delay: -17s; }
@keyframes float { to { translate: 4vw 3vh; scale: 1.08; } }

/* ── Glass ───────────────────────────────────────────────────────────────── */
.glass { position: relative; background: var(--glass); border: 1px solid var(--glass-edge); border-radius: var(--radius); box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(30px) saturate(200%); backdrop-filter: blur(30px) saturate(200%); }
.glass::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--sheen); pointer-events: none; }
.glass > * { position: relative; }

/* ── Layout ──────────────────────────────────────────────────────────────── */
main { position: relative; z-index: 1; width: 100%; max-width: 1140px; margin: 0 auto; padding: 64px 16px 96px; }
header.hero { text-align: center; margin-bottom: 30px; }
.hero h1 { margin: 0; font-family: var(--display); font-weight: 700; font-size: clamp(40px, 6.5vw, 60px); letter-spacing: -0.035em; line-height: 1.05; color: var(--ink); }
.hero p { margin: 10px 0 0; font-size: 17px; color: var(--ink-2); letter-spacing: -0.01em; }
h2 { margin: 0 0 16px; font-family: var(--display); font-size: 17px; font-weight: 600; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
h2 .sub { margin-left: auto; font-family: var(--mono); font-weight: 400; font-size: 12px; color: var(--ink-3); letter-spacing: 0; }

/* ── The form ────────────────────────────────────────────────────────────── */
form.glass { max-width: 720px; margin: 0 auto; padding: 14px; }
.urlrow { display: flex; gap: 10px; }
.field { flex: 1; min-width: 0; }
.field input, .guide { width: 100%; border: 1px solid var(--rim-edge); background: var(--lens-tint), var(--lens); box-shadow: var(--rim); color: var(--ink);
  -webkit-backdrop-filter: blur(16px) saturate(190%) brightness(1.06); backdrop-filter: blur(16px) saturate(190%) brightness(1.06);
  border-radius: 18px; font: inherit; font-size: 16px; padding: 14px 16px; outline: none; transition: border-color .2s, box-shadow .2s, background .2s; }
.field input::placeholder, .guide::placeholder { color: var(--ink-3); }
.field input:focus, .guide:focus { border-color: color-mix(in srgb, var(--accent) 55%, var(--rim-edge)); background: var(--lens-tint), var(--lens-focus);
  box-shadow: var(--rim), 0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent); }
.guide { margin-top: 10px; font-size: 15px; padding: 12px 16px; }
.go { position: relative; overflow: hidden; border: 0; border-radius: 16px; padding: 0 26px; cursor: pointer; font: inherit; font-weight: 600; font-size: 16px; color: #fff; white-space: nowrap;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff), var(--accent)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 0 8px 20px -8px color-mix(in srgb, var(--accent) 70%, transparent);
  transition: transform .15s, filter .2s; }
.go:hover { filter: brightness(1.06); }
.go:active { transform: scale(.98); }
.go:disabled { cursor: default; filter: saturate(.7); }
.go:disabled::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 25%, rgb(255 255 255 / .35) 50%, transparent 75%); background-size: 220% 100%; animation: shimmer 1.4s linear infinite; }
.go:focus-visible, .seg input:focus-visible + span, .switch input:focus-visible + .track, .btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.options { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; justify-content: space-between; padding: 0 2px; }
.seg { position: relative; display: inline-flex; padding: 4px; gap: 2px; border-radius: 999px; border: 1px solid var(--rim-edge); background: var(--lens-tint), var(--lens); box-shadow: var(--rim);
  -webkit-backdrop-filter: blur(16px) saturate(190%); backdrop-filter: blur(16px) saturate(190%); }
.seg label { position: relative; z-index: 1; cursor: pointer; }
.seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.seg span { display: inline-flex; align-items: baseline; gap: 6px; padding: 7px 14px; border-radius: 999px; font-size: 14px; color: var(--ink-2); transition: color .3s; }
.seg span small { font-size: 11px; color: var(--ink-3); transition: color .3s; }
.seg input:checked + span { color: var(--ink); }
.seg input:checked + span small { color: var(--ink-2); }
.seg label:hover input:not(:checked) + span { color: var(--ink); }
/* The selection: one drop of clear glass shared by every option. It is moved — stretched across to
   the new option and settled — by the page script; see slideDrop(). */
.seg .drop { position: absolute; z-index: 0; top: 4px; bottom: 4px; left: 0; width: 0; border-radius: 999px; pointer-events: none;
  transform-origin: center; will-change: transform, width;
  background:
    radial-gradient(110% 80% at 30% 0%, rgb(255 255 255 / .6), rgb(255 255 255 / 0) 50%),
    linear-gradient(180deg, rgb(255 255 255 / .26), rgb(255 255 255 / .04) 70%, rgb(255 255 255 / .14));
  border: 1px solid rgb(255 255 255 / .85);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 1), inset 0 -2px 4px rgb(255 255 255 / .35), inset 0 0 8px rgb(255 255 255 / .25),
    0 1px 2px rgb(15 23 42 / .08), 0 6px 16px -6px rgb(15 23 42 / .28);
  -webkit-backdrop-filter: blur(6px) saturate(220%) brightness(1.08); backdrop-filter: blur(6px) saturate(220%) brightness(1.08); }
@media (prefers-color-scheme: dark) {
  .seg .drop { background: radial-gradient(120% 90% at 30% 0%, rgb(255 255 255 / .28), rgb(255 255 255 / 0) 55%), linear-gradient(180deg, rgb(255 255 255 / .16), rgb(255 255 255 / .04));
    border-color: rgb(255 255 255 / .3); box-shadow: inset 0 1px 1px rgb(255 255 255 / .45), inset 0 -2px 4px rgb(255 255 255 / .08), 0 6px 16px -6px rgb(0 0 0 / .7); }
}
.switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; font-size: 15px; }
.switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.switch .track { width: 46px; height: 28px; border-radius: 999px; background: color-mix(in srgb, var(--ink-3) 35%, transparent); position: relative; transition: background .25s; flex: none; }
.switch .thumb { position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 999px; background: #fff;
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 1), 0 2px 6px rgb(0 0 0 / .2); transition: translate .35s cubic-bezier(.3,1.4,.4,1), width .25s cubic-bezier(.3,1.4,.4,1); }
.switch input:checked + .track { background: var(--ok); }
.switch input:checked + .track .thumb { translate: 18px 0; }
/* Pressed, the thumb stretches like a drop about to move — as the system switch does. */
.switch:active .thumb { width: 31px; }
.switch:active input:checked + .track .thumb { translate: 11px 0; }
.switch .hint { color: var(--ink-3); font-size: 13px; }
.msg { max-width: 720px; margin: 14px auto 0; text-align: center; font-size: 14px; color: var(--bad); min-height: 20px; }

/* ── The studio: stages and live log beside the post, at one height ──────── */
.workshop { margin-top: 30px; }
.workshop .grid { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 980px) {
  .workshop .grid { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); height: clamp(560px, 74vh, 720px); }
  .workshop .grid > * { min-height: 0; height: 100%; }
  .workshop .grid > div > .post { height: 100%; }
}
/* Stacked, the log has no neighbour to match: it gets a height of its own and scrolls. */
@media (max-width: 979px) { .workshop .terminal { flex: none; height: 420px; min-height: 0; } }
.panel { padding: 20px; display: flex; flex-direction: column; min-height: 0; }

.stages { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.stage { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 14px; background: var(--field); border: 1px solid var(--glass-line); font-size: 13px; color: var(--ink-3); min-width: 0; }
.stone { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--ink-3) 18%, transparent); color: var(--ink-2); transition: background .3s, color .3s; }
.stage .label { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stage.done { color: var(--ink-2); }
.stage.done .stone { background: var(--accent); color: #fff; }
.stage.running { color: var(--ink); background: var(--glass-strong); border-color: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.stage.running .stone { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); color: var(--accent); animation: ring 1.6s ease-in-out infinite; }
.stage.running .label { font-weight: 600; background: linear-gradient(90deg, var(--ink) 0%, var(--ink) 35%, var(--accent) 50%, var(--ink) 65%, var(--ink) 100%);
  background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 1.8s linear infinite; }
.stage.failed { color: var(--bad); }
.stage.failed .stone { background: var(--bad); color: #fff; }
@keyframes shimmer { from { background-position: 125% 0; } to { background-position: -125% 0; } }
@keyframes ring { 50% { box-shadow: inset 0 0 0 2px var(--accent), 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent); } }

.now { margin-top: 12px; display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 14px; background: var(--field); border: 1px solid var(--glass-line); }
.now .clock { font-family: var(--mono); font-size: 13px; font-variant-numeric: tabular-nums; color: var(--ink-3); }
.now .doing { flex: 1; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink-2); }
.now.live .doing { background: linear-gradient(90deg, var(--ink-2) 0%, var(--ink-2) 40%, var(--accent) 50%, var(--ink-2) 60%, var(--ink-2) 100%); background-size: 250% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 2.2s linear infinite; }
.pulse { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--ink-3); }
.now.live .pulse { background: var(--accent); animation: pulse 1.4s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }

.terminal { margin-top: 12px; flex: 1; min-height: 340px; display: flex; flex-direction: column; border-radius: 18px; overflow: hidden; background: var(--term);
  border: 1px solid var(--term-line); box-shadow: inset 0 1px 0 rgb(255 255 255 / .06); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
.terminal .bar { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--term-line); color: var(--term-dim); font-size: 12px; font-family: var(--mono); }
.terminal .bar .title { color: var(--term-ink); font-family: var(--font); font-weight: 600; }
.terminal .bar .led { width: 8px; height: 8px; border-radius: 50%; background: rgb(255 255 255 / .2); }
.terminal.live .bar .led { background: var(--ok); box-shadow: 0 0 8px var(--ok); animation: blink 1.4s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .35; } }
.terminal .bar button { margin-left: auto; background: rgb(255 255 255 / .06); border: 1px solid var(--term-line); color: var(--term-dim); border-radius: 8px; font: inherit; padding: 3px 9px; cursor: pointer; }
.terminal .bar button[aria-pressed="true"] { color: var(--term-ink); background: rgb(255 255 255 / .12); }
.log { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 16px; margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.6; color: var(--term-dim);
  overscroll-behavior: contain; scrollbar-color: rgb(255 255 255 / .15) transparent; }
.log .l { display: block; white-space: pre-wrap; overflow-wrap: anywhere; animation: appear .25s ease-out; }
@keyframes appear { from { opacity: 0; translate: 0 3px; } }
.log .t { color: #5d6474; margin-right: 10px; user-select: none; }
.log .pipe { color: #ffd60a; margin-top: 6px; }
.log .pipe::before { content: "● "; color: var(--accent); }
.log .tokens { color: #64d2ff; }
.log .tokens::before { content: "◷ "; }
.log .thought { color: #bf9df5; font-style: italic; }
.log .code { color: #d1d5dd; }
.log .read { color: #86e3a1; }
.log .write { color: #ffb36b; font-weight: 600; }
.log .shell { color: #6fc3ff; }
.log .search { color: #c9a2ff; }
.log .head { color: var(--term-ink); font-weight: 600; }
.log .out { color: var(--term-dim); }
.log .err { color: #ff7b72; }
.log .empty { color: #5d6474; font-style: italic; }
.log .cursor { display: inline-block; width: 7px; height: 14px; background: var(--term-ink); vertical-align: -2px; animation: blink 1s steps(1) infinite; }

/* ── The post ────────────────────────────────────────────────────────────── */
.post #post-body { flex: 1; min-height: 0; overflow-y: auto; margin: 0 -6px; padding: 0 6px; scrollbar-width: thin; }
.post .who { display: flex; align-items: center; gap: 12px; }
.post .avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; background: var(--field); flex: none; box-shadow: 0 0 0 1px var(--glass-line); }
.post .name { display: flex; align-items: center; gap: 5px; font-weight: 600; font-size: 15px; }
.post .badge { width: 16px; height: 16px; }
.post .handle, .post .date { color: var(--ink-3); font-size: 13px; }
.post .replying { margin: 12px 0 0; font-size: 13px; color: var(--ink-3); }
.post .replying b { color: var(--accent); font-weight: 500; }
.post .body { margin: 10px 0 0; font-size: 15px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.post .body:empty { display: none; }
.post .media { margin-top: 12px; display: grid; gap: 8px; }
.post .media img { width: 100%; max-height: 260px; object-fit: cover; border-radius: 14px; display: block; }
.post .quote { margin-top: 12px; border: 1px solid var(--glass-line); border-radius: 16px; padding: 12px; background: var(--field); }
.post .quote .avatar { width: 22px; height: 22px; }
.post .quote .name { font-size: 13px; }
.post .quote .body { font-size: 13px; }
.post .meta { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--glass-line); display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--ink-3); }
.post .meta b { color: var(--ink); font-weight: 600; }
.skeleton { border-radius: 10px; background: linear-gradient(100deg, var(--field) 30%, var(--glass-strong) 50%, var(--field) 70%); background-size: 250% 100%; animation: shimmer 1.5s linear infinite; }

/* ── The result ──────────────────────────────────────────────────────────── */
.result { max-width: 980px; margin: 22px auto 0; padding: 20px; scroll-margin-top: 20px; }
.frame { position: relative; border-radius: 18px; overflow: hidden; background: var(--field); box-shadow: 0 0 0 1px var(--glass-line), 0 20px 50px -24px rgb(15 23 42 / .45); }
.frame img { display: block; width: 100%; height: auto; }
.frame .skeleton { position: absolute; inset: 0; border-radius: 0; display: grid; place-items: center; color: var(--ink-3); font-size: 15px; }
.actions { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; }
.btn { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; border-radius: 999px; padding: 10px 18px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer;
  border: 1px solid var(--glass-line); background: var(--glass-strong); color: var(--ink); transition: transform .15s, background .2s; }
.btn:hover { background: var(--field); }
.btn:active { transform: scale(.98); }
.btn.primary { border: 0; color: #fff; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff), var(--accent)); box-shadow: inset 0 1px 0 rgb(255 255 255 / .35); }
.quality { margin-top: 14px; font-size: 14px; color: var(--ink-2); }
.quality ul { margin: 8px 0 0; padding-left: 18px; }
.quality li { margin: 3px 0; }

footer { position: relative; z-index: 1; text-align: center; font-size: 13px; color: var(--ink-3); padding: 0 16px 28px; }

@media (max-width: 640px) {
  main { padding-top: 40px; }
  .urlrow { flex-direction: column; }
  .go { padding: 14px; }
  .options { justify-content: flex-start; }
  .seg span small { display: none; }
  .stages { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .terminal { min-height: 320px; }
  .log { font-size: 11.5px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001s !important; animation-iteration-count: 1 !important; transition: none !important; }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--glass-strong); }
}
`
