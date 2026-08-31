/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { AnalyzeResult, VlmStatus } from './lib/vlm'
import type { PortionResult } from './lib/portions'
import type { ExtractedItem, Food } from './types'
import type { PickDecision } from './lib/vlmParse'

declare global {
  interface Window {
    __opencalVlm?: {
      getVlmStatus: () => VlmStatus
      warmupVlm: () => void
      extractMealText: (text: string) => Promise<AnalyzeResult>
      extractMealPhoto: (image: Blob) => Promise<AnalyzeResult>
      pickFoodMatch: (
        meal: string,
        item: ExtractedItem,
        lines: string[],
      ) => Promise<{ decision: PickDecision; raw: string; ms: number; error?: string }>
      convertPortion: (
        food: Food,
        item: Pick<ExtractedItem, 'quantity' | 'unit'>,
        opts?: { wholeProduceGrams?: number },
      ) => PortionResult
      analyzeMealText: (text: string) => Promise<AnalyzeResult>
      analyzeMealPhoto: (image: Blob) => Promise<AnalyzeResult>
      isVlmReady: () => boolean
    }
  }
}

export {}
