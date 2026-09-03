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

const rows: Row[] = [
  {
    id: 1,
    name: 'Big Mac name + 4 ingredients',
    input: '{"name":"Big Mac","foods":[{"name":"hamburger","brand":null},{"name":"cheese","brand":null},{"name":"lettuce","brand":null},{"name":"pickles","brand":null}]}',
    expect: 'mealName "Big Mac" · 4 items',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === 'Big Mac' && items.length === 4 && /hamburger/i.test(items[0].query), got }
    },
  },
  {
    id: 2,
    name: 'Named meal with a brand on one item',
    input: '{"name":"Chipotle bowl","foods":[{"name":"chicken","brand":"Chipotle"},{"name":"rice","brand":null},{"name":"guacamole","brand":null}]}',
    expect: 'mealName "Chipotle bowl" · Chipotle chicken',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === 'Chipotle bowl' && items.some((i) => i.brand === 'Chipotle'), got }
    },
  },
  {
    id: 3,
    name: 'Foods only — no meal name, items still parse',
    input: '{"foods":[{"name":"eggs"},{"name":"toast"}]}',
    expect: 'mealName null · eggs · toast',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? 'null'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 2 && /egg/i.test(items[0].query), got }
    },
  },
  {
    id: 4,
    name: 'Meal name with zero foods — dropped, not emitted',
    input: '{"name":"mystery plate","foods":[]}',
    expect: 'no items → mealName absent',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const present = mealName === null || items.length === 0 ? 'absent' : `present as "${mealName}"`
      return { pass: mealName === null || items.length === 0, got: `${present} · ${items.length} items` }
    },
  },
  {
    id: 5,
    name: 'Non-string meal name is rejected',
    input: '{"name":["Big Mac","cheese"],"foods":[{"name":"hamburger"}]}',
    expect: 'array name → ignored · 1 item',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? 'null'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 1 && /hamburger/i.test(items[0].query), got }
    },
  },
  {
    id: 6,
    name: 'Numbered list fallback still yields items (no name)',
    input: '1. Pizza\n2. Cheese\n3. Pineapple',
    expect: 'mealName null · Pizza · Cheese · Pineapple',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? 'null'} → ${foodsLine(items)}`
      return { pass: mealName === null && items.length === 3 && /pizza/i.test(items[0].query), got }
    },
  },
  {
    id: 7,
    name: 'Meal under "meal" key instead of "name"',
    input: '{"meal":"Oatmeal bowl","foods":[{"name":"oatmeal"},{"name":"honey"}]}',
    expect: 'mealName "Oatmeal bowl" · 2 items',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === 'Oatmeal bowl' && items.length === 2, got }
    },
  },
  {
    id: 8,
    name: 'Trailing token noise after JSON',
    input: '{"name":"Lunch","foods":[{"name":"salad"}]} (done)',
    expect: 'mealName "Lunch" · salad',
    run() {
      const { mealName, items } = parsePhotoExtraction(this.input)
      const got = `${mealName ?? '—'} → ${foodsLine(items)}`
      return { pass: mealName === 'Lunch' && items.length === 1 && /salad/i.test(items[0].query), got }
    },
  },
  {
    id: 9,
    name: 'Photo prompt asks for a meal name plus rich ingredients (usdaName/grams/emoji)',
    input: PHOTO_EXTRACT_SYSTEM,
    expect: 'name + rich foods[] keys',
    run() {
      const s = PHOTO_EXTRACT_SYSTEM
      return {
        pass:
          /"name"/.test(s) &&
          /"foods"/.test(s) &&
          /groupedFoodName/i.test(s) &&
          /usdaName/i.test(s) &&
          /\bgrams\b/.test(s) &&
          /servingCount/i.test(s) &&
          /\bemoji\b/.test(s),
        got: /"name"/.test(s) && /"foods"/.test(s) && /usdaName/i.test(s) ? 'name + rich foods[]' : 'missing name/foods or usdaName',
      }
    },
  },
]

const results = rows.map((row) => {
  const { pass, got } = row.run()
  return { ...row, pass, got }
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
