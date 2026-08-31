import { chromium } from 'playwright'

const base = process.env.OPENCAL_URL || 'http://127.0.0.1:4174'
const vlmTimeout = Number(process.env.OPENCAL_VLM_TIMEOUT_MS || 12 * 60 * 1000)

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  const keys = await caches.keys()
  await Promise.all(keys.map((k) => caches.delete(k)))
  localStorage.clear()
})
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Get started' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Go to Today' }).click()
await page.waitForSelector('text=Remaining')

await page.getByRole('button', { name: 'Search foods' }).click()
await page.getByPlaceholder(/2 eggs/).fill('500 calories')
await page.getByRole('button', { name: 'Log', exact: true }).click()
await page.waitForSelector('text=Quick add')
await page.waitForSelector('.log-overlay', { state: 'detached' })

const kcal = await page.locator('.stat b').first().innerText()
if (Number(kcal.replace(/,/g, '')) !== 500) throw new Error(`expected 500 eaten, got ${kcal}`)
console.log('e2e quick-add ok — eaten', kcal)

const ready = await page.waitForFunction(
  () => {
    const s = window.__opencalVlm?.getVlmStatus()
    return s?.state === 'ready' || s?.state === 'error'
  },
  null,
  { timeout: vlmTimeout },
).then(() => page.evaluate(() => window.__opencalVlm?.getVlmStatus()))

if (!ready || ready.state === 'error') {
  throw new Error(`VLM did not become ready: ${JSON.stringify(ready)}`)
}
console.log('e2e model ready', ready)

const text = await page.evaluate(async () => {
  const result = await window.__opencalVlm.analyzeMealText('2 eggs and a banana')
  return result
})
console.log('e2e text', text.path, text.items, text.raw.slice(0, 200), text.error ?? '')
if (text.path === 'error-fallback') throw new Error(`text inference failed: ${text.error}`)
if (!text.items.some((i) => /egg|banana/i.test(`${i.query} ${text.raw}`))) {
  throw new Error(`text case missed eggs/banana: ${JSON.stringify(text)}`)
}

const photo = await page.evaluate(async () => {
  const res = await fetch('/test-fixtures/banana.jpg')
  const blob = await res.blob()
  return window.__opencalVlm.analyzeMealPhoto(blob)
})
console.log('e2e photo', photo.path, photo.items, photo.raw.slice(0, 200), photo.error ?? '')
if (photo.path === 'error-fallback') throw new Error(`photo inference failed: ${photo.error}`)
if (!photo.items.some((i) => /banana|fruit/i.test(`${i.query} ${photo.raw}`))) {
  throw new Error(`photo case missed banana: ${JSON.stringify(photo)}`)
}

if (errors.length) throw new Error(errors.join('\n'))
console.log('e2e ok — text and photo')
await browser.close()
