// Label the training photo pool (n5k-eval + finetune/images) with GPT-5.5 in
// the PRODUCTION schema (EXTRACT_SYSTEM / EXTRACT_USER_TAIL), same prompt the
// app uses at runtime. Resumable: skips photos already labeled ok.
// Held-out eval: evals/data/user-photos (already labeled) — NOT part of this pool.
import { readdirSync, readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTRACT_SYSTEM, EXTRACT_USER_TAIL } from '../src/lib/vlmParse.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIRS = [
  join(root, 'evals/data/n5k-eval'),
  join(root, 'evals/data/finetune/images'),
]
const OUT = join(root, 'evals/results/pool-gpt55-labels.jsonl')
const KEY = readFileSync('/tmp/opencode/.openai_key', 'utf8').trim()
const MODEL = 'gpt-5.5'
const CONC = Number(process.env.CONC ?? '6')
const RETRY = Number(process.env.CONC_RETRY ?? '3')

function b64(p: string) { return readFileSync(p).toString('base64') }
function mime(p: string) { return p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }

function parseJsonLoose(text: string): unknown {
  let t = (text ?? '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const arr = t.match(/\[[\s\S]*\]/)
  const obj = arr ? null : t.match(/\{[\s\S]*\}/)
  const blob = arr ? arr[0] : obj ? obj[0] : t
  try { return JSON.parse(blob) } catch { return JSON.parse(blob.replace(/,(\s*[}\]])/g, '$1')) }
}
function firstStr(v: unknown): string | null { if (Array.isArray(v)) v = v[0]; return typeof v === 'string' && v.trim() ? v.trim() : null }
function normalizeRows(raw: unknown) {
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object') list = (raw as { foods?: unknown[] }).foods ?? []
  else throw new Error('not a JSON array/object')
  const out: object[] = []
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const g = firstStr(o.grouped_food_name ?? o.dish ?? o.name)
    const n = firstStr(o.ingredient_name ?? o.name ?? o.food)
    let w = Number(o.estimated_gram_weight ?? o.grams)
    const e = typeof o.emoji === 'string' ? o.emoji.trim() : ''
    if (!g || !n || !Number.isFinite(w) || w <= 0) continue
    out.push({ grouped_food_name: g, ingredient_name: n, estimated_gram_weight: Math.round(w), emoji: e })
  }
  if (!out.length) throw new Error('no valid rows in response')
  return out
}

async function labelOne(path: string) {
  let lastErr = ''
  for (let a = 0; a < RETRY; a++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: 4096,
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM },
            { role: 'user', content: [
              { type: 'text', text: EXTRACT_USER_TAIL },
              { type: 'image_url', image_url: { url: `data:${mime(path)};base64,${b64(path)}` } },
            ] },
          ],
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      return normalizeRows(parseJsonLoose(data.choices[0].message.content ?? ''))
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      await new Promise((r) => setTimeout(r, 2500 * (a + 1)))
    }
  }
  throw new Error(`label failed for ${path}: ${lastErr}`)
}

function manifest(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of DIRS) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(f)) continue
      const id = f.replace(/\.\w+$/, '').replace(/^(n5k-)?/, '')
      if (seen.has(id)) continue
      seen.add(id)
      out.push(join(dir, f))
    }
  }
  return out
}

async function main() {
  mkdirSync(join(root, 'evals/results'), { recursive: true })
  const existing = new Map<string, { ok?: boolean }>()
  if (existsSync(OUT)) {
    for (const l of readFileSync(OUT, 'utf8').split('\n')) {
      if (!l.trim()) continue
      try { const r = JSON.parse(l); if (r.ok) existing.set(r.path, r) } catch { /* skip */ }
    }
  }
  // Rewrite the output to contain only the successful rows we actually have,
  // so any prior failures (e.g. empty-credit 429s) don't linger as dupes and
  // won't mask a later successful label of the same photo.
  writeFileSync(OUT, Array.from(existing.values()).map((r) => JSON.stringify(r)).join('\n') + (existing.size ? '\n' : ''))
  const LIMIT = Number(process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0)
  const all = manifest()
  const capped = LIMIT ? all.slice(0, LIMIT) : all
  const todo = capped.filter((p) => !existing.has(p))
  const done = capped.length - todo.length
  console.log(`pool ${all.length} photos · capped ${capped.length} · done ${done} · todo ${todo.length} · conc ${CONC}`)
  const queue = [...todo]
  let k = 0
  async function worker() {
    while (queue.length) {
      const p = queue.shift()!
      try {
        const foods = await labelOne(p)
        appendFileSync(OUT, JSON.stringify({ path: p, ok: true, model: MODEL, foods }) + '\n')
        if (++k % 25 === 0) console.log(`  ${k}/${todo.length} ok ${p.split('/').pop()}`)
      } catch (err) {
        appendFileSync(OUT, JSON.stringify({ path: p, ok: false, model: MODEL, error: String(err) }) + '\n')
        console.error(`FAIL ${p.split('/').pop()}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))
  console.log(`\ndone — appended ${todo.length} new rows to ${OUT}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
