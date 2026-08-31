import { chromium } from 'playwright'

const base = process.env.OPENCAL_URL || 'http://127.0.0.1:4173'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Get started' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Continue' }).click()
await page.getByRole('button', { name: 'Go to Today' }).click()
await page.waitForSelector('text=Remaining')

const remaining = await page.locator('.ring-number').innerText()
if (!remaining) throw new Error('calorie ring missing')

await page.getByRole('button', { name: 'Search foods' }).click()
await page.getByPlaceholder(/Search or type/).fill('2 eggs and a banana')
await page.getByRole('button', { name: /Extract foods/ }).click()
await page.getByRole('button', { name: /Log 2 items/ }).click()
await page.waitForSelector('text=Banana')

const kcal = await page.locator('.stat b').first().innerText()
if (Number(kcal.replace(/,/g, '')) < 50) throw new Error(`expected logged calories, got ${kcal}`)

if (errors.length) throw new Error(errors.join('\n'))
console.log('e2e ok — remaining start', remaining, 'eaten', kcal)
await browser.close()
