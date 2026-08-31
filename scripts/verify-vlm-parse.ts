import { extractFoods, isQuickCalorie, refineExtracted } from '../src/lib/extract.ts'
import { formatChatPrompt, parseExtractedFoods, parsePick } from '../src/lib/vlmParse.ts'

type Row = {
  id: number
  kind: 'text' | 'image'
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
    kind: 'text',
    name: 'Extract 2 eggs and a banana',
    input: '{"foods":[{"name":"eggs","quantity":2,"unit":"large"},{"name":"banana","quantity":1,"unit":"medium"}]}',
    expect: '2 large eggs · 1 medium banana',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: /egg/i.test(got) && /banana/i.test(got) && items[0]?.quantity === 2, got }
    },
  },
  {
    id: 2,
    kind: 'text',
    name: 'Split chicken bowl combo',
    input: '{"foods":[{"name":"chicken bowl with rice and guacamole","quantity":1,"unit":"bowl"}]}',
    expect: 'chicken · rice · guacamole',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: items.length >= 2 && /chicken/i.test(got) && /rice/i.test(got) && /guac/i.test(got),
        got,
      }
    },
  },
  {
    id: 3,
    kind: 'text',
    name: 'Repair cut-off latte JSON',
    input: '{"name":"latte","brand":"Starbucks","quantity":1,"unit":"grande"},{"name":"blueberry muffin","quantity":1}]}',
    expect: 'Starbucks latte · blueberry muffin',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: /latte/i.test(got) && /muffin/i.test(got) && items.some((i) => i.brand === 'Starbucks'), got }
    },
  },
  {
    id: 4,
    kind: 'text',
    name: 'Numbered breakfast list',
    input: '1. 2 large eggs\n2. banana',
    expect: '2 large eggs · banana',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: /egg/i.test(got) && /banana/i.test(got), got }
    },
  },
  {
    id: 5,
    kind: 'text',
    name: 'Oatmeal + peanut butter + berries',
    input:
      '{"foods":[{"name":"oatmeal","quantity":0.5,"unit":"cup"},{"name":"peanut butter","quantity":1,"unit":"tbsp"},{"name":"blueberries","quantity":1,"unit":"handful"}]}',
    expect: '0.5 cup oatmeal · 1 tbsp peanut butter · handful blueberries',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: items.length === 3 && items[0].quantity === 0.5 && /peanut/i.test(got) && /blueberr/i.test(got),
        got,
      }
    },
  },
  {
    id: 6,
    kind: 'text',
    name: 'Chipotle bowl, no rice',
    input:
      '{"foods":[{"name":"chicken burrito bowl","brand":"Chipotle","quantity":1,"unit":"bowl"},{"name":"guacamole","quantity":1,"unit":"serving"},{"name":"black beans","quantity":1,"unit":"cup"}]}',
    expect: 'Chipotle bowl · guacamole · black beans',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: items.some((i) => /chipotle/i.test(i.brand ?? '')) && /guac/i.test(got) && /bean/i.test(got),
        got,
      }
    },
  },
  {
    id: 7,
    kind: 'text',
    name: 'Regex extract spoken sentence',
    input: 'I had 2 eggs and a banana for breakfast',
    expect: '2 eggs · banana',
    run() {
      const items = extractFoods(this.input)
      const got = foodsLine(items)
      return { pass: items.length >= 2 && items[0].quantity === 2 && /banana/i.test(got), got }
    },
  },
  {
    id: 8,
    kind: 'text',
    name: 'Quick add 500 calories',
    input: '500 calories',
    expect: 'quick add 500',
    run() {
      const n = isQuickCalorie(this.input)
      return { pass: n === 500, got: n == null ? 'not quick' : `quick add ${n}` }
    },
  },
  {
    id: 9,
    kind: 'text',
    name: 'Pick scrambled eggs as B, 2 large',
    input: '{"pick":"B","name":"Egg, whole, cooked, scrambled","brand":null,"unit":"large","quantity":2}',
    expect: 'index 1 · 2 large',
    run() {
      const p = parsePick(this.input, 4)
      const got = `index ${p.index} · ${p.quantity} ${p.unit}`
      return { pass: p.index === 1 && p.quantity === 2 && p.unit === 'large', got }
    },
  },
  {
    id: 10,
    kind: 'text',
    name: 'Pick none / no database match',
    input: '{"pick":null,"name":"mystery slop","brand":null,"unit":"bowl","quantity":1}',
    expect: 'no match · mystery slop',
    run() {
      const p = parsePick(this.input, 4)
      return { pass: p.index === null && p.name === 'mystery slop', got: p.index == null ? `no match · ${p.name}` : `index ${p.index}` }
    },
  },
  {
    id: 11,
    kind: 'text',
    name: 'Pick half cup of oatmeal',
    input: '{"pick":"A","name":"Oatmeal, cooked","unit":"cup","quantity":0.5}',
    expect: 'index 0 · 0.5 cup',
    run() {
      const p = parsePick(this.input, 5)
      const got = `index ${p.index} · ${p.quantity} ${p.unit}`
      return { pass: p.index === 0 && p.quantity === 0.5 && p.unit === 'cup', got }
    },
  },
  {
    id: 12,
    kind: 'text',
    name: 'ChatML extract prefix',
    input: 'hi',
    expect: 'prompt ends with {"foods":[',
    run() {
      const prompt = formatChatPrompt([{ role: 'user', content: this.input }], true, '{"foods":[')
      return { pass: prompt.endsWith('{"foods":['), got: prompt.slice(-20) }
    },
  },
  {
    id: 13,
    kind: 'image',
    name: 'Banana photo JSON',
    input: '{"foods":[{"name":"banana","brand":null,"quantity":1,"unit":"medium"}]}',
    expect: '1 medium banana',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: items.length === 1 && /banana/i.test(got) && items[0].unit === 'medium', got }
    },
  },
  {
    id: 14,
    kind: 'image',
    name: 'Banana photo numbered (5 bananas)',
    input: '1. 5 bananas',
    expect: '5 bananas',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: /banana/i.test(got) && items[0]?.quantity === 5, got }
    },
  },
  {
    id: 15,
    kind: 'image',
    name: 'Eggs plate numbered list',
    input: '1. Eggs\n2. Avocado\n3. Spinach\n4. Toast\n5. Cookies',
    expect: 'Eggs · Avocado · Spinach · Toast · Cookies',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: items.length === 5 && /egg/i.test(got) && /avocado/i.test(got) && /toast/i.test(got), got }
    },
  },
  {
    id: 16,
    kind: 'image',
    name: 'Pizza photo numbered list',
    input: '1. Pizza\n2. Onions\n3. Cheese\n4. Cilantro\n5. Pineapple',
    expect: 'Pizza · Onions · Cheese · Cilantro · Pineapple',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: items.length === 5 && /pizza/i.test(got) && /pineapple/i.test(got), got }
    },
  },
  {
    id: 17,
    kind: 'image',
    name: 'Salad bowl photo list',
    input: '1. 2 hard-boiled eggs\n2. 1 cup sliced tomatoes\n3. 1 cup cooked chicken breast\n4. corn\n5. purple cabbage',
    expect: 'eggs · tomatoes · chicken · corn · cabbage',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: /egg/i.test(got) && /tomato/i.test(got) && /chicken/i.test(got) && items.length >= 4,
        got,
      }
    },
  },
  {
    id: 18,
    kind: 'image',
    name: 'Skip plate and background',
    input: '1. Banana\n2. Yellow background\n3. Wooden cutting board\n4. Toast',
    expect: 'Banana · Toast (drop background/board)',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: /banana/i.test(got) && /toast/i.test(got) && !/background/i.test(got) && !/board/i.test(got),
        got,
      }
    },
  },
  {
    id: 19,
    kind: 'image',
    name: 'Packaged bar with brand',
    input: '{"foods":[{"name":"protein bar","brand":"KIND","quantity":1,"unit":"bar"}]}',
    expect: 'KIND protein bar',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return { pass: items[0]?.brand === 'KIND' && /bar/i.test(got), got }
    },
  },
  {
    id: 20,
    kind: 'image',
    name: 'Pick pizza row from photo hits',
    input: '{"pick":"A","name":"Pizza, cheese, regular crust","brand":null,"unit":"slice","quantity":2}',
    expect: 'index 0 · 2 slice · Pizza, cheese',
    run() {
      const p = parsePick(this.input, 6)
      const got = `index ${p.index} · ${p.quantity} ${p.unit} · ${p.name}`
      return { pass: p.index === 0 && p.quantity === 2 && /pizza/i.test(p.name ?? ''), got }
    },
  },
  {
    id: 21,
    kind: 'text',
    name: 'Turkey bacon stays one food',
    input: '{"foods":[{"name":"turkey bacon","quantity":2,"unit":"slice"}]}',
    expect: '2 slice turkey bacon',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass: items.length === 1 && items[0].quantity === 2 && /turkey bacon/i.test(items[0].query),
        got,
      }
    },
  },
  {
    id: 22,
    kind: 'text',
    name: 'Branded Chipotle + KIND + Chobani extract',
    input:
      '{"foods":[{"name":"chicken bowl","brand":"Chipotle","quantity":1,"unit":"bowl"},{"name":"bar","brand":"KIND","quantity":1,"unit":"bar"},{"name":"greek yogurt","brand":"Chobani","quantity":1,"unit":"cup"}]}',
    expect: 'Chipotle chicken bowl · KIND bar · Chobani greek yogurt',
    run() {
      const items = parseExtractedFoods(this.input)
      const got = foodsLine(items)
      return {
        pass:
          items.length === 3 &&
          items[0].brand === 'Chipotle' &&
          items[1].brand === 'KIND' &&
          items[2].brand === 'Chobani',
        got,
      }
    },
  },
  {
    id: 23,
    kind: 'text',
    name: 'Drop pizza/coke leak from a turkey-bacon meal',
    input: '3 slices of turkey bacon',
    expect: '3 slices turkey bacon',
    run() {
      const items = refineExtracted(
        [
          { raw: this.input, query: 'turkey bacon', quantity: 1, unit: 'slice' },
          { raw: this.input, query: 'pepperoni pizza', quantity: 1, unit: 'slice' },
          { raw: this.input, query: 'coke', quantity: 1, unit: 'can' },
        ],
        this.input,
      )
      const got = foodsLine(items)
      return {
        pass: items.length === 1 && items[0].quantity === 3 && /turkey bacon/i.test(items[0].query),
        got,
      }
    },
  },
  {
    id: 24,
    kind: 'text',
    name: 'Banana pepper stays a pepper, egg whites stay whites',
    input: 'a banana pepper',
    expect: 'banana pepper · egg whites',
    run() {
      const pepper = refineExtracted(
        [{ raw: 'a banana pepper', query: 'banana', quantity: 1, unit: 'medium' }],
        'a banana pepper',
      )
      const whites = refineExtracted(
        [{ raw: '2 egg whites', query: 'eggs', quantity: 2, unit: 'large' }],
        '2 egg whites',
      )
      const got = `${foodsLine(pepper)} · ${foodsLine(whites)}`
      return {
        pass: /banana pepper/i.test(pepper[0]?.query ?? '') && /egg white/i.test(whites[0]?.query ?? ''),
        got,
      }
    },
  },
  {
    id: 26,
    kind: 'text',
    name: 'Regex fills in turkey bacon the VLM dropped',
    input: '2 slices turkey bacon and 2 eggs',
    expect: 'eggs · turkey bacon',
    run() {
      const items = refineExtracted([{ raw: this.input, query: 'eggs', quantity: 2, unit: 'large' }], this.input)
      const got = foodsLine(items)
      return {
        pass: items.length === 2 && items.some((i) => /turkey bacon/i.test(i.query)) && items.some((i) => /^eggs?$/i.test(i.query)),
        got,
      }
    },
  },
  {
    id: 27,
    kind: 'text',
    name: 'Chipotle brand stays on the bowl, not guacamole',
    input: 'Chipotle chicken bowl with guacamole and black beans',
    expect: 'Chipotle bowl · guacamole · black beans',
    run() {
      const items = refineExtracted(
        [
          { raw: this.input, query: 'chicken bowl', quantity: 1, unit: 'bowl', brand: 'Chipotle' },
          { raw: this.input, query: 'guacamole', quantity: 1, unit: 'serving', brand: 'Chipotle' },
          { raw: this.input, query: 'black beans', quantity: 1, unit: 'cup', brand: 'Chipotle' },
        ],
        this.input,
      )
      const bowl = items.find((i) => /chicken|bowl/i.test(i.query))
      const guac = items.find((i) => /guac/i.test(i.query))
      const beans = items.find((i) => /bean/i.test(i.query))
      return {
        pass: bowl?.brand === 'Chipotle' && !guac?.brand && !beans?.brand,
        got: items.map((i) => `${i.brand ?? '—'} ${i.query}`).join(' · '),
      }
    },
  },
  {
    id: 28,
    kind: 'text',
    name: 'Guessed small KIND bar becomes one bar',
    input: 'a KIND protein bar',
    expect: '1 KIND protein bar',
    run() {
      const items = refineExtracted(
        [{ raw: this.input, query: 'protein bar', quantity: 1, unit: 'small' }],
        this.input,
      )
      return {
        pass: items[0]?.brand === 'KIND' && items[0]?.unit == null && items[0]?.quantity === 1,
        got: foodsLine(items),
      }
    },
  },
]

const results = rows.map((row) => {
  const { pass, got } = row.run()
  return { ...row, pass, got }
})

const failed = results.filter((r) => !r.pass).length
console.log('| # | Kind | Test | Input | Expected | Got | Result |')
console.log('|---|------|------|-------|----------|-----|--------|')
for (const r of results) {
  const input = r.input.replace(/\n/g, ' ↵ ').replace(/\|/g, '\\|')
  const clip = input.length > 72 ? `${input.slice(0, 69)}…` : input
  console.log(
    `| ${r.id} | ${r.kind} | ${r.name} | \`${clip}\` | ${r.expect} | ${r.got.replace(/\|/g, '/')} | ${r.pass ? 'PASS' : 'FAIL'} |`,
  )
}
console.log('')
console.log(`${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
