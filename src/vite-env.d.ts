/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { AnalyzeResult, VlmStatus } from './lib/vlm'

declare global {
  interface Window {
    __opencalVlm?: {
      getVlmStatus: () => VlmStatus
      warmupVlm: () => void
      analyzeMealText: (text: string) => Promise<AnalyzeResult>
      analyzeMealPhoto: (image: Blob) => Promise<AnalyzeResult>
      isVlmReady: () => boolean
    }
  }
}

export {}
