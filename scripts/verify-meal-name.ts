import { parsePhotoExtraction, PHOTO_EXTRACT_SYSTEM } from '../src/lib/vlmParse.ts'

type Row = {
  id: number
  name: string
  input: string
  expect: string
  run: () => { pass: boolean; got: string }
}

function foodsLine(items: { query: string; quantity?: number; unit?: string | null; brand?: string | null }[]): string {
  return items
    .map((i) => [i.quantity && i.quantity !== 1 ? i.quantity : null, i.unit, i.brand, i.query].filter(Boolean).join(' '))
    .join(' · ')
}

function pass(ok: boolean, got: string): { pass: boolean; got: string } {
  return { pass: ok, got }
}

const rows: Row[] = [
  {
    id: 1,
    name: 'Flat array — 4 ingredients',
    input:
      '[{"grouped_food_name":"hamburger","ingredient_name":"hamburger, cooked","estimated_gram_weight":85,"quantity":1,"emoji":"🍔"},{"grouped_food_name":"cheese","ingredient_name":"cheese, american","estimated_gram_weight":12,"quantity":1,"emoji":"🧀"},{"grouped_food_name":"lettuce","ingredient_name":"lettuce, romaine","estimated_gram_weight":10,"quantity":1,"emoji":"🥬"},{"grouped_food_name":"pickles","ingredient_name":"pickles, dill","estimated_gram_weight":8,"quantity":1,"emoji":"🥒"}]',
    expect: '4 items · no meal name',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 4 && /hamburger/i.test(items[0].query), got }
    },
  },
  {
    id: 2,
    name: 'Flat array — fractional quantity preserved',
    input: '[{"grouped_food_name":"pickles","ingredient_name":"pickles, dill","estimated_gram_weight":8,"quantity":0.5,"emoji":"🥒"}]',
    expect: 'quantity 0.5 · pickles',
    run() {
      const { items } = parsePhotoExtraction(this.input)
      const got = `${items[0]?.quantity} ${items[0]?.query}`
      return { pass: items.length === 1 && items[0].quantity === 0.5 && /pickle/i.test(items[0].query), got }
    },
  },
  {
    id: 3,
    name: 'Flat array — snake_case keys map onto internal fields',
    input: '[{"grouped_food_name":"egg","ingredient_name":"egg, whole","estimated_gram_weight":50,"quantity":2,"emoji":"🥚"}]',
    expect: 'query/usdaName/grams/quantity/emoji all set',
    run() {
      const { items } = parsePhotoExtraction(this.input)
      const it = items[0]
      const got = `q=${it?.query} usda=${it?.usdaName} g=${it?.grams} qty=${it?.quantity} emoji=${it?.emoji}`
      return pass(
        it != null &&
          it.query === 'egg' &&
          it.usdaName === 'egg, whole' &&
          it.grams === 50 &&
          it.quantity === 2 &&
          it.emoji === '🥚',
        got,
      )
    },
  },
  {
    id: 4,
    name: 'Legacy {name, foods} still parses (backward compat)',
    input: '{"name":"Big Mac","foods":[{"name":"hamburger"},{"name":"cheese"},{"name":"lettuce"},{"name":"pickles"}]}',
    expect: 'mealName "Big Mac" · 4 items',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === 'Big Mac' && items.length === 4 && /hamburger/i.test(items[0].query), got }
    },
  },
  {
    id: 5,
    name: 'Legacy {name, foods:[]} — dropped, not emitted',
    input: '{"name":"mystery plate","foods":[]}',
    expect: 'no items → mealName absent',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const present = mealName === null || items.length === 0 ? 'absent' : `present as "${mealName}"`
      return { pass: mealName === null || items.length === 0, got: `${present} · ${items.length} items` }
    },
  },
  {
    id: 6,
    name: 'Non-string meal name is rejected (legacy)',
    input: '{"name":["Big Mac","cheese"],"foods":[{"name":"hamburger"}]}',
    expect: 'array name → ignored · 1 item',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? 'null'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 1 && /hamburger/i.test(items[0].query), got }
    },
  },
  {
    id: 7,
    name: 'Numbered list fallback still yields items',
    input: '1. Pizza\n2. Cheese\n3. Pineapple',
    expect: 'mealName null · 3 items',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? 'null'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 3 && /pizza/i.test(items[0].query), got }
    },
  },
  {
    id: 8,
    name: 'Trailing token noise after JSON array',
    input: '[{"grouped_food_name":"salad","ingredient_name":"salad","estimated_gram_weight":40,"quantity":1,"emoji":"🥗"}] (done)',
    expect: 'salad · 1 item',
    run() {
      const { items } = parsePhotoExtraction(this.input)
      const got = foodsLine(items)
      return { pass: items.length === 1 && /salad/i.test(items[0].query), got }
    },
  },
  {
    id: 9,
    name: 'Photo prompt asks for a flat snake_case array (no meal name)',
    input: PHOTO_EXTRACT_SYSTEM,
    expect: 'grouped_food_name + ingredient_name + estimated_gram_weight + quantity + emoji',
    run() {
      const s = PHOTO_EXTRACT_SYSTEM
      return {
        pass:
          /grouped_food_name/.test(s) &&
          /ingredient_name/.test(s) &&
          /estimated_gram_weight/.test(s) &&
          /\bquantity\b/.test(s) &&
          /\bemoji\b/.test(s) &&
          !/servingCount/i.test(s) &&
          !/"name"\s*:/m.test(s.replace(/^\s*Example:\s*/m, '')),
        got: /grouped_food_name/.test(s) && /estimated_gram_weight/.test(s) ? 'flat snake_case array' : 'prompt missing new keys',
      }
    },
  },
]

const results = rows.map((row) => {
  const { pass: ok, got } = row.run()
  return { ...row, pass: ok, got }
})

const failed = results.filter((r) => !r.pass).length
console.log('| # | Test | Input | Expected | Got | Result |')
console.log('|---|------|-------|----------|-----|--------|')
for (const r of results) {
  const input = r.input.replace(/\n/g, ' ↵ ').replace(/\|/g, '\\|')
  const clip = input.length > 72 ? `${input.slice(0, 69)}…` : input
  console.log(`| ${r.id} | ${r.name} | \`${clip}\` | ${r.expect} | ${r.got.replace(/\|/g, '/')} | ${r.pass ? 'PASS' : 'FAIL'} |`)
}
console.log('')
console.log(`${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
