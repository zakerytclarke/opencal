import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTRACT_SYSTEM, EXTRACT_PREFIX, EXTRACT_USER_TAIL } from '../src/lib/vlmParse.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const IMG_DIR = join(root, 'evals/data/user-photos')
const OUT = join(root, 'evals/results/user-photos-gpt55-labels.jsonl')
const KEY = readFileSync('/tmp/opencode/.openai_key', 'utf8').trim()
const MODEL = process.argv.includes('--gpt4') ? 'gpt-4o' : 'gpt-5.5'

export type Row = {
  grouped_food_name: string
  ingredient_name: string
  estimated_gram_weight: number
  emoji: string
}

function b64(p: string): string {
  return readFileSync(p).toString('base64')
}
function mime(p: string): string {
  return p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
}

export function parseJsonLoose(text: string): unknown {
  let t = (text ?? '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const arr = t.match(/\[[\s\S]*\]/)
  const obj = arr ? null : t.match(/\{[\s\S]*\}/)
  const blob = arr ? arr[0] : obj ? obj[0] : t
  const attempt = (s: string) => JSON.parse(s)
  try {
    return attempt(blob)
  } catch {
    return attempt(blob.replace(/,(\s*[}\]])/g, '$1'))
  }
}

export function normalizeRows(raw: unknown): Row[] {
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object') list = (raw as { foods?: unknown[] }).foods ?? []
  else throw new Error('not a JSON array/object')
  const out: Row[] = []
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const g = firstStr(o.grouped_food_name ?? o.dish ?? o.name)
    const n = firstStr(o.ingredient_name ?? o.name ?? o.food)
    let w = Number(o.estimated_gram_weight ?? o.grams)
    const e = typeof o.emoji === 'string' ? o.emoji.trim() : ''
    if (!g || !n || !Number.isFinite(w) || w <= 0) continue
    out.push({
      grouped_food_name: g,
      ingredient_name: n,
      estimated_gram_weight: Math.round(w),
      emoji: e,
    })
  }
  if (!out.length) throw new Error('no valid rows in response')
  return out
}
function firstStr(v: unknown): string | null {
  if (Array.isArray(v)) v = v[0]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

async function labelOne(file: string): Promise<Row[]> {
  const path = join(IMG_DIR, file)
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: 4096,
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM },
            {
              role: 'user',
              content: [
                { type: 'text', text: EXTRACT_USER_TAIL + ' The first token of your reply must be `' + EXTRACT_PREFIX + '`.' },
                { type: 'image_url', image_url: { url: `data:${mime(file)};base64,${b64(path)}` } },
              ],
            },
          ],
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      const text = data.choices[0].message.content ?? ''
      return normalizeRows(parseJsonLoose(text))
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)))
  }
  throw new Error(`label failed for ${file}: ${lastErr}`)
}

const files = readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
console.log(`labeling ${files.length} photos with ${MODEL} (schema: ${EXTRACT_SYSTEM.slice(0, 60).replace(/\n/g, ' ')}...)`)
const CONC = 5
const queue = [...files]
const rows: object[] = []
async function worker() {
  while (queue.length) {
    const f = queue.shift()!
    try {
      const foods = await labelOne(f)
      rows.push({ file: f, model: MODEL, ok: true, foods })
      console.log(`ok   ${f}  ${foods.length} rows`)
    } catch (err) {
      rows.push({ file: f, model: MODEL, ok: false, error: String(err) })
      console.error(`FAIL ${f}  ${err instanceof Error ? err.message : err}`)
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))
rows.sort((a, b) => String((a as { file: string }).file).localeCompare(String((b as { file: string }).file)))
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
const bad = rows.filter((r) => !(r as { ok?: boolean }).ok).length
console.log(`\nwrote ${OUT}  (${rows.length - bad}/${rows.length} ok)`)
if (bad) process.exit(1)
