/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { AnalyzeResult, VlmStatus } from './lib/vlm'
import type { PortionResult } from './lib/portions'
import type { ExtractedItem, Food } from './types'
import type { PickDecision } from './lib/vlmParse'

declare global {
  interface ImportMetaEnv {
    /** Build tag (git sha + timestamp) — set in vite.config.ts. */
    VITE_OPC_BUILD?: string
    /** Incrementing version (1.0.<commit count>) — set in vite.config.ts. */
    VITE_OPC_VERSION?: string
  }
  interface Window {
    __opencalVlm?: {
      getVlmStatus: () => VlmStatus
      warmupVlm: () => void
      extractMealText: (text: string) => Promise<AnalyzeResult>
      extractMealPhoto: (image: Blob) => Promise<AnalyzeResult>
      estimateTextPortions: (
        meal: string,
        names: string[],
        lines: string[],
      ) => Promise<AnalyzeResult>
      estimatePhotoPortions: (
        image: Blob,
        names: string[],
        lines: string[],
      ) => Promise<AnalyzeResult>
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
    /** Toggle for on-device generation debug logging. */
    __opencalVlmDebug?: {
      enabled: boolean
      verbose: boolean
      set: (o: { enabled?: boolean; verbose?: boolean }) => void
    }
  }
}

export {}
