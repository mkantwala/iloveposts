import { pageScript } from './script'
import { pageStyle } from './style'

/**
 * The landing page: paste a post, watch the designer work, take the card away.
 *
 * Three parts: the form; the studio — the stages, what the designer is doing right now, a live log
 * of its streamed output (GET /v1/cards/:id/logs) beside the post itself, at the same height; and
 * the result. Styles are in ./style.ts and behaviour in ./script.ts.
 */
export const page = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>iloveposts</title>
<meta name="description" content="Paste an x.com post and watch an AI designer turn it into a card." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" />
<style>${pageStyle}</style>
</head>
<body>
<div class="wallpaper" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>

<main>
  <header class="hero">
    <h1>iloveposts</h1>
    <p>Paste an x.com post. An AI designer turns it into a card.</p>
  </header>

  <form class="glass" id="f" autocomplete="off">
    <div class="urlrow">
      <div class="field">
        <input id="url" type="url" name="url" placeholder="https://x.com/someone/status/…" spellcheck="false" autofocus aria-label="Post link" />
      </div>
      <button class="go" id="go" type="submit">Design</button>
    </div>
    <input id="guide" type="text" name="guide" class="guide" maxlength="500" aria-label="How should it feel?"
           placeholder="How should it feel? Optional — e.g. calm and editorial, a warm dusk, playful" />
    <div class="options">
      <div class="seg" role="radiogroup" aria-label="Format">
        <span class="drop" aria-hidden="true"></span>
        <label><input type="radio" name="format" value="x_post" checked /><span>Post <small>16:9</small></span></label>
        <label><input type="radio" name="format" value="x_square" /><span>Square <small>1:1</small></span></label>
        <label><input type="radio" name="format" value="x_card" /><span>Link card <small>1.91:1</small></span></label>
      </div>
      <label class="switch">
        <input id="motion" type="checkbox" role="switch" />
        <span class="track" aria-hidden="true"><span class="thumb"></span></span>
        <span>Motion &amp; 3D</span>
        <span class="hint">animated, interactive</span>
      </label>
    </div>
  </form>
  <p class="msg" id="msg" role="alert"></p>

  <section class="workshop" id="workshop" hidden>
   <div class="grid">
    <div class="glass panel">
      <h2>Studio <span class="sub" id="engine"></span></h2>
      <ol class="stages">
        <li class="stage" id="s-extract"><span class="stone">1</span><span class="label">Fetching</span></li>
        <li class="stage" id="s-build"><span class="stone">2</span><span class="label">Designing</span></li>
        <li class="stage" id="s-validate"><span class="stone">3</span><span class="label">Checking</span></li>
        <li class="stage" id="s-export"><span class="stone">4</span><span class="label">Exporting</span></li>
      </ol>
      <div class="now" id="now"><span class="pulse" aria-hidden="true"></span><span class="doing" id="doing">Waking up…</span><span class="clock" id="clock">0:00</span></div>
      <div class="terminal" id="terminal">
        <div class="bar"><span class="led"></span><span class="title">Live log</span><span id="count">0 lines</span>
          <button type="button" id="follow" aria-pressed="true">follow</button></div>
        <pre class="log" id="log" aria-live="off"><span class="l empty">The designer's work will stream here.</span></pre>
      </div>
    </div>

    <div>
      <article class="glass panel post" id="post">
        <h2>The post</h2>
        <div id="post-skeleton"><div class="skeleton" style="height:46px;width:60%"></div><div class="skeleton" style="height:14px;margin-top:14px"></div><div class="skeleton" style="height:14px;margin-top:8px;width:80%"></div></div>
        <div id="post-body" hidden>
          <div class="who"><img class="avatar" id="avatar" alt="" /><div><div class="name"><span id="name"></span><img class="badge" id="badge" alt="Verified" hidden /></div><div class="handle" id="handle"></div></div></div>
          <p class="replying" id="replying" hidden></p>
          <p class="body" id="text"></p>
          <div class="media" id="media"></div>
          <div class="quote" id="quote" hidden>
            <div class="who"><img class="avatar" id="q-avatar" alt="" /><div class="name"><span id="q-name"></span><img class="badge" id="q-badge" alt="Verified" hidden /></div><span class="handle" id="q-handle"></span></div>
            <p class="body" id="q-text"></p>
            <div class="media" id="q-media"></div>
          </div>
          <div class="meta"><span><b id="replies"></b> replies</span><span><b id="retweets"></b> reposts</span><span><b id="likes"></b> likes</span><span class="date" id="date"></span></div>
        </div>
      </article>
    </div>
   </div>
    <section class="glass result" id="result">
      <h2>Your card</h2>
      <div class="frame" id="frame"><div class="skeleton" id="painting">Designing…</div><img id="png" alt="The finished card" hidden /></div>
      <div class="actions" id="actions" hidden>
        <a class="btn primary" id="open" target="_blank" rel="noopener noreferrer">Open interactive</a>
        <a class="btn" id="download">Download PNG</a>
        <button class="btn" type="button" id="copy">Copy link</button>
        <button class="btn" type="button" id="again">New card</button>
      </div>
      <div class="quality" id="quality" hidden></div>
    </section>
  </section>
</main>
<footer>Designed by Workers AI, checked in a headless browser · <a href="/health">Status</a></footer>
<script>${pageScript}</script>
</body>
</html>
`
