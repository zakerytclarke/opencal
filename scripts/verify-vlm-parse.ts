import { formatChatPrompt, itemsFromModelText, parseToolCalls } from '../src/lib/vlmParse.ts'

const cases: { name: string; raw: string; expect: { query: string; quantity?: number; unit?: string | null }[] }[] = [
  {
    name: 'native LFM tool tokens',
    raw: '<|tool_call_start|>[search_foods(query="scrambled eggs", quantity=2, unit="large"), search_foods(query="banana", quantity=1, unit="medium")]<|tool_call_end|>',
    expect: [
      { query: 'scrambled eggs', quantity: 2, unit: 'large' },
      { query: 'banana', quantity: 1, unit: 'medium' },
    ],
  },
  {
    name: 'bare python calls after special tokens stripped',
    raw: 'search_foods(query="grilled chicken", quantity=1, unit="bowl")\nsearch_foods(query="brown rice", quantity=1, unit="cup")',
    expect: [
      { query: 'grilled chicken', quantity: 1, unit: 'bowl' },
      { query: 'brown rice', quantity: 1, unit: 'cup' },
    ],
  },
  {
    name: 'combo query split',
    raw: '<|tool_call_start|>[search_foods(query="chicken bowl with rice and guacamole", quantity=1, unit="bowl")]<|tool_call_end|>',
    expect: [
      { query: 'chicken bowl', quantity: 1 },
      { query: 'rice', quantity: 1 },
      { query: 'guacamole', quantity: 1 },
    ],
  },
  {
    name: 'JSON tools envelope',
    raw: '{"tools":[{"name":"search_foods","arguments":{"query":"latte","quantity":1,"unit":"grande"}},{"name":"search_foods","arguments":{"query":"blueberry muffin","quantity":1}}]}',
    expect: [
      { query: 'latte', quantity: 1, unit: 'grande' },
      { query: 'blueberry muffin', quantity: 1 },
    ],
  },
  {
    name: 'numbered photo list',
    raw: "Here's a list of foods:\n1. 5 bananas<|im_end|>\n2. Yellow background\n3. Toast",
    expect: [{ query: 'bananas', quantity: 5 }, { query: 'Toast' }],
  },
  {
    name: 'foods array',
    raw: '```json\n{"foods":[{"name":"oatmeal","quantity":0.5,"unit":"cup"},{"query":"peanut butter","quantity":1,"unit":"tbsp"}]}\n```',
    expect: [
      { query: 'oatmeal', quantity: 0.5, unit: 'cup' },
      { query: 'peanut butter', quantity: 1, unit: 'tbsp' },
    ],
  },
]

let failed = 0
for (const c of cases) {
  const got = parseToolCalls(c.raw)
  const ok =
    got.length === c.expect.length &&
    c.expect.every((e, i) => {
      const g = got[i]
      return g && g.query === e.query && (e.quantity == null || g.quantity === e.quantity) && (e.unit === undefined || g.unit === e.unit)
    })
  if (!ok) {
    failed++
    console.error('FAIL', c.name, got)
  } else {
    console.log('OK', c.name)
  }
}

const items = itemsFromModelText(
  '<|tool_call_start|>[search_foods(query="banana", quantity=1)]<|tool_call_end|>',
)
if (items[0]?.query !== 'banana') {
  failed++
  console.error('FAIL itemsFromModelText', items)
} else {
  console.log('OK itemsFromModelText')
}

const prompt = formatChatPrompt([
  { role: 'system', content: 'sys' },
  { role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'look' }] },
])
if (!prompt.includes('<|startoftext|>') || !prompt.includes('<image>look') || !prompt.endsWith('<|im_start|>assistant\n')) {
  failed++
  console.error('FAIL formatChatPrompt', prompt)
} else {
  console.log('OK formatChatPrompt')
}

if (failed) {
  console.error(`${failed} parse cases failed`)
  process.exit(1)
}
console.log('parse tests ok')
