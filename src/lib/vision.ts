import { extractFoods } from './extract'
import { analyzeMealPhoto } from './vlm'
import type { ExtractedItem } from '../types'

type ProgressFn = (message: string, pct?: number) => void

export async function foodsFromImage(image: Blob, onProgress?: ProgressFn): Promise<{ caption: string; items: ExtractedItem[] }> {
  try {
    const { raw, items } = await analyzeMealPhoto(image, onProgress)
    return { caption: raw, items: items.length ? items : extractFoods(raw) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vision failed'
    throw new Error(message)
  }
}
