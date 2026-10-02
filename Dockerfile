# The sandbox a card is built in: opencode, driving Workers AI.
#
# The tag must match the @cloudflare/sandbox package version — the SDK checks this on startup.
# This image has Node but not python3, which is why the build brief tells the agent not to try to
# serve or open the card: the pipeline renders it in Browser Rendering instead.
FROM docker.io/cloudflare/sandbox:0.12.9

RUN npm install -g opencode-ai@latest && opencode --version

# The libraries a Motion & 3D card may use, vendored into the image so a card never fetches
# anything: the agent references them as lib/*.js and the pipeline inlines them into the card's
# single HTML file. Three.js ships only ES modules, so it is bundled into one script that sets a
# global THREE; GSAP's own browser build sets a global gsap. Versions are pinned — bump them here,
# and keep src/card/libraries.ts in step.
RUN mkdir -p /tmp/card-libs /opt/card-libs \
    && cd /tmp/card-libs \
    && npm init -y >/dev/null \
    && npm install --no-audit --no-fund three@0.186.1 gsap@3.15.0 esbuild@0.28.2 \
    && echo "import * as THREE from 'three'; globalThis.THREE = THREE;" > three-entry.js \
    && npx esbuild three-entry.js --bundle --minify --format=iife --outfile=/opt/card-libs/three.js \
    && cp node_modules/gsap/dist/gsap.min.js /opt/card-libs/gsap.js \
    && cd / && rm -rf /tmp/card-libs \
    && ls -la /opt/card-libs
