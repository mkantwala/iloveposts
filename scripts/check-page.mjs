/**
 * Checks the landing page's script (src/site/script.ts) is valid JavaScript.
 *
 * Worth a script of its own because the failure is silent. The script is a string inside a
 * TypeScript file, so `tsc` cannot see a syntax error in it — the page still serves and still looks
 * right, and the only symptom is that nothing is wired up: the form falls back to a native submit and
 * reloads the page.
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/site/script.ts', import.meta.url), 'utf8')
const marker = 'export const pageScript = '
const start = source.indexOf(marker)
if (start < 0) {
  console.error('check-page: src/site/script.ts does not export pageScript')
  process.exit(1)
}
const script = eval(source.slice(start + marker.length))

if (/\$\{/.test(source.slice(start))) {
  console.error('check-page: the page script contains "${" — String.raw interpolates it')
  process.exit(1)
}

try {
  new Function(script)
} catch (err) {
  console.error(`check-page: the page's script does not parse — ${err.message}`)
  process.exit(1)
}

// The handler that stops the native form submit; without it the page reloads instead of building.
if (!script.includes('preventDefault')) {
  console.error('check-page: the submit handler never calls preventDefault')
  process.exit(1)
}

const page = readFileSync(new URL('../src/site/page.ts', import.meta.url), 'utf8')
if (!page.includes('<script>${pageScript}</script>')) {
  console.error('check-page: src/site/page.ts does not include pageScript')
  process.exit(1)
}

console.log('check-page: ok')
