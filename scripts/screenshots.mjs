import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.OPENCAL_URL || 'http://127.0.0.1:5174'
const out = '/home/zclarke/Documents/OpenCal/screenshots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})

await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: /get started/i }).waitFor()

async function shot(name) {
  const path = `${out}/${name}.png`
  await page.screenshot({ path, fullPage: false })
  console.log('wrote', path)
}

await shot('01-welcome')
await page.getByRole('button', { name: /get started/i }).click()
await page.locator('h1', { hasText: 'About you' }).waitFor()
await shot('02-about-you')

await page.getByRole('button', { name: 'Continue' }).click()
await page.locator('h1', { hasText: 'Current weight' }).waitFor()
await shot('03-current-weight')

await page.getByRole('button', { name: 'Continue' }).click()
await page.locator('h1', { hasText: 'Goal weight' }).waitFor()
await shot('04-goal-weight')

await page.getByRole('button', { name: 'Continue' }).click()
await page.locator('h1', { hasText: /How quickly/ }).waitFor()
await shot('05-pace')

await page.getByRole('button', { name: 'Continue' }).click()
await page.locator('h1', { hasText: 'Your daily goal' }).waitFor()
await shot('06-daily-goal')

await page.getByRole('button', { name: 'Go to Today' }).click()
await page.locator('.ring-number').waitFor()
await shot('07-home')

await page.getByRole('button', { name: 'Search foods' }).click()
await page.getByPlaceholder(/Search or type/).waitFor()
await page.getByPlaceholder(/Search or type/).fill('banana')
await page.locator('.result', { hasText: 'Banana' }).first().waitFor()
await shot('08-search-banana')

await page.locator('.result').filter({ hasText: '1 medium' }).first().click()
await page.locator('.food-name', { hasText: 'Banana' }).waitFor()
await shot('09-home-logged-banana')

await browser.close()
