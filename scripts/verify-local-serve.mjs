// Verify the fine-tuned ONNX bundle serves and hooks up IN THE BROWSER (WebGPU),
// exactly like the shipped base model: boot the real app, load the local model,
// and run text + photo extraction through window.__opencalVlm.
//
// Why not scripts/e2e.mjs directly? That uses goto('networkidle'), which never
// settles while the ~1.2GB local bundle streams from the Vite dev server. This
// variant waits on DOMContentLoaded + the app's own VLM-ready polling.
import { chromium } from 'playwright'

const base = process.env.OPENCAL_URL || 'http://127.0.0.1:4174'
const vlmTimeout = Number(process.env.OPENCAL_VLM_TIMEOUT_MS || 15 * 60 * 1000)
const started = Date.now()
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s]`, ...a)

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))

await page.goto(base, { waitUntil: 'domcontentloaded' })
// Drop cached state so we exercise a cold, first-time load against this origin.
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  for (const k of await caches.keys()) await caches.delete(k)
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__opencalVlm?.analyzeMealPhoto === 'function', null, { timeout: 30000 })

// Kick off the model load (local bundle) and watch it go ready.
await page.evaluate(() => window.__opencalVlm.warmupVlm())
const ready = await page.waitForFunction(
  () => {
    const s = window.__opencalVlm?.getVlmStatus()
    return s && (s.state === 'ready' || s.state === 'error')
  },
  null,
  { timeout: vlmTimeout },
)
  .then(() => page.evaluate(() => window.__opencalVlm.getVlmStatus()))
  .catch(async () => page.evaluate(() => window.__opencalVlm.getVlmStatus()))

log('VLM status at ready-check:', JSON.stringify(ready))
if (!ready || ready.state !== 'ready') {
  console.error('FAIL: VLM did not reach ready. errors:', pageErrors.slice(0, 8))
  await browser.close()
  process.exit(1)
}
log('model ready (WebGPU) in', Math.round((Date.now() - started) / 1000), 's')

// --- text extraction (production flat-array prompt) ---
const text = await page.evaluate(async () => window.__opencalVlm.analyzeMealText('2 eggs and a banana'))
log('TEXT  path=' + text.path, 'items=', JSON.stringify(text.items), 'error=', text.error ?? '')
log('TEXT  raw=', (text.raw || '').slice(0, 240))

// --- photo extraction through the real pipeline ---
const photo = await page.evaluate(async () => {
  const blob = await (await fetch('/test-fixtures/banana.jpg')).blob()
  return window.__opencalVlm.analyzeMealPhoto(blob)
})
log('PHOTO path=' + photo.path, 'items=', JSON.stringify(photo.items), 'error=', photo.error ?? '')
log('PHOTO raw=', (photo.raw || '').slice(0, 240))

if (pageErrors.length) console.error('console/page errors:')
for (const e of pageErrors.slice(0, 10)) console.error('  !', e)

const problems = []
if (text.path === 'error-fallback' || !text.items?.length) problems.push('text extraction empty/errored')
if (photo.path === 'error-fallback' || !photo.items?.length) problems.push('photo extraction empty/errored')

if (problems.length) {
  console.error('RESULT: DEGRADED —', problems.join('; '))
  await browser.close()
  process.exit(1)
}
console.log('\nRESULT: OK — fine-tuned local bundle loaded in-browser (WebGPU fp16) and produced items for both text and photo')
await browser.close()
