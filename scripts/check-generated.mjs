/**
 * Checks that the JavaScript the Worker generates parses: output/toggle.js, the viewer page's
 * script, the QA measurement script and the house design's motion script.
 *
 * Same trap as scripts/check-page.mjs. Each is authored inside a TypeScript template literal, so a
 * `\n` or `\s` meant for the generated code can be consumed by TypeScript first — a regex or string
 * breaks, `tsc` sees only a string, and the failure shows up as a card whose button does nothing or
 * a QA stage that throws in the browser.
 */
import { toggleScript } from '../src/api/toggle.ts'
import { viewerHtml } from '../src/card/viewer.ts'
import { FINISH_ANIMATIONS, MEASURE_SCRIPT } from '../src/card/measure.ts'
import { CARD_FORMATS } from '../src/card/formats.ts'
import { houseDesign } from '../src/card/house.ts'

const failures = []
const check = (name, code) => {
  try {
    new Function(code)
  } catch (err) {
    failures.push(`${name} does not parse — ${err.message}`)
  }
}

check('toggle.js', toggleScript('Title\n\nLead in:\nBody with "quotes", `ticks` and \\ slashes.', true))

for (const [id, format] of Object.entries(CARD_FORMATS)) {
  const viewer = viewerHtml({ id, ...format }, '/v1/cards/card_x/html', 'A "title" <here>')
  check(`viewer script (${id})`, viewer.slice(viewer.indexOf('<script>') + '<script>'.length, viewer.lastIndexOf('</script>')))
}

check('measure script', `return (${MEASURE_SCRIPT})`)
check('finish-animations script', FINISH_ANIMATIONS)

for (const [id, format] of Object.entries(CARD_FORMATS)) {
  check(`house design script (${id})`, houseDesign({ id, ...format }, true).js)
}

if (failures.length) {
  for (const failure of failures) console.error(`check-generated: ${failure}`)
  process.exit(1)
}
console.log('check-generated: ok')
