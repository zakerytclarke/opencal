import { chromium } from 'playwright'

const base = process.env.OPENCAL_URL || 'http://127.0.0.1:4174'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
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

const kcal = await page.locator('.stat b').first().innerText()
if (Number(kcal.replace(/,/g, '')) !== 500) throw new Error(`expected 500 eaten, got ${kcal}`)

if (errors.length) throw new Error(errors.join('\n'))
console.log('e2e ok — eaten', kcal)
await browser.close()
