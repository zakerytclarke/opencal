import { formatChatPrompt, parseExtractedFoods, parsePick } from '../src/lib/vlmParse.ts'

let failed = 0

function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) console.log('OK', name)
  else {
    failed++
    console.error('FAIL', name, extra)
  }
}

const extracted = parseExtractedFoods(
  '{"foods":[{"name":"eggs","brand":null,"quantity":2,"unit":"large"},{"name":"banana","brand":null,"quantity":1,"unit":"medium"}]}',
)
check(
  'extract JSON',
  extracted.length === 2 && extracted[0].query === 'eggs' && extracted[0].quantity === 2 && extracted[1].query === 'banana',
  extracted,
)

const combo = parseExtractedFoods(
  '{"foods":[{"name":"chicken bowl with rice and guacamole","quantity":1,"unit":"bowl"}]}',
)
check(
  'extract combo split',
  combo.length >= 2 && combo.some((i) => /chicken/i.test(i.query)) && combo.some((i) => /rice/i.test(i.query)),
  combo,
)

const prefixed = parseExtractedFoods(
  '{"name":"latte","brand":"Starbucks","quantity":1,"unit":"grande"},{"name":"blueberry muffin","quantity":1}]}',
)
check(
  'extract prefix-repaired JSON',
  prefixed.some((i) => /latte/i.test(i.query)) && prefixed.some((i) => /muffin/i.test(i.query)),
  prefixed,
)

const numbered = parseExtractedFoods('1. 2 large eggs\n2. banana')
check(
  'extract numbered list',
  numbered.some((i) => /egg/i.test(i.query)) && numbered.some((i) => /banana/i.test(i.query)),
  numbered,
)

const pickA = parsePick('{"pick":"B","name":"Egg, whole, cooked, scrambled","brand":null,"unit":"large","quantity":2}', 4)
check('pick letter B', pickA.index === 1 && pickA.quantity === 2 && pickA.unit === 'large', pickA)

const pickNone = parsePick('{"pick":null,"name":"mystery slop","brand":null,"unit":"bowl","quantity":1}', 4)
check('pick none', pickNone.index === null && pickNone.name === 'mystery slop', pickNone)

const prompt = formatChatPrompt([{ role: 'user', content: 'hi' }], true, '{"foods":[')
check('chat prefix', prompt.endsWith('{"foods":['), prompt)

if (failed) {
  console.error(`${failed} parse cases failed`)
  process.exit(1)
}
console.log('parse tests ok')
