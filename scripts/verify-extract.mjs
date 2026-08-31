import { readFileSync } from 'node:fs'
import MiniSearch from 'minisearch'

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5,
}
const UNITS = ['slices','slice','pieces','piece','cups','cup','tbsp','tsp','oz','g','large','medium','small','bowl','bowls']
const LEADING = /^(i\s+)?(just\s+)?(had|ate|eaten|logged|log|drank|have)\s+/i

function extractFoods(text) {
  const cleaned = text.replace(LEADING, '').replace(/\s+(for\s+)?(breakfast|lunch|dinner)\s*$/i, '')
  return cleaned.split(/\s*(?:,|;|\band\b|\bthen\b|\bplus\b|\bwith\b)\s+/i).map((raw) => {
    const tokens = raw.replace(/\b(like|about|of|the|a lot of|with)\b/gi, ' ').replace(/\s+/g, ' ').trim().split(' ')
    let quantity = 1
    let unit = null
    const n = NUMBER_WORDS[tokens[0]?.toLowerCase()] ?? (/^\d+(\.\d+)?$/.test(tokens[0]) ? Number(tokens[0]) : null)
    if (n != null) {
      quantity = n
      tokens.shift()
      if (UNITS.includes(tokens[0]?.toLowerCase())) unit = tokens.shift().toLowerCase()
    }
    return { raw, query: tokens.join(' ').trim(), quantity, unit }
  }).filter((i) => i.query.length >= 2)
}

const foods = JSON.parse(readFileSync(new URL('../public/foods.json', import.meta.url))).foods
const search = new MiniSearch({
  fields: ['name', 'aliasesText'],
  storeFields: ['id', 'name', 'kcal'],
  extractField: (doc, field) => field === 'aliasesText' ? (doc.aliases ?? []).join(' ') : doc[field] ?? '',
})
search.addAll(foods)

function best(q) {
  const hits = search.search(q, { prefix: true, fuzzy: 0.15, combineWith: 'AND' })
  return hits[0]
}

const cases = [
  'I had 2 eggs and a banana',
  'chicken breast and brown rice',
  'a slice of pepperoni pizza',
  '500 calories',
  'oatmeal with blueberries',
]

let failed = 0
for (const c of cases) {
  if (/^\d+/.test(c) && /cal/.test(c)) {
    console.log('OK quick', c)
    continue
  }
  const items = extractFoods(c)
  const mapped = items.map((i) => ({ q: i.query, hit: best(i.query)?.name }))
  const ok = mapped.every((m) => m.hit)
  console.log(ok ? 'OK' : 'FAIL', c, mapped)
  if (!ok) failed++
}

const egg = best('egg')
if (egg && /eggplant/i.test(egg.name) && !/egg/i.test(egg.name.split(',')[0])) {
  console.log('WARN egg matched', egg.name)
}
console.log(foods.length, 'foods indexed')
if (failed) process.exit(1)
