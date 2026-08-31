import { readFileSync } from 'node:fs'
import { loadFoods } from '../../src/lib/foods.ts'

export async function setupLocalFoods(): Promise<void> {
  const foodsJson = readFileSync(new URL('../../public/foods.json', import.meta.url))
  const realFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('foods.json')) {
      return new Response(foodsJson, { headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  }) as typeof fetch
  await loadFoods()
}
