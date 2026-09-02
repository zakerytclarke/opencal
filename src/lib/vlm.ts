// Main-thread facade for the on-device VLM. In the browser it dispatches every
// call to a Web Worker (./vlm.worker.ts → ./vlm-engine.ts) so model loading
// and token generation run off the main thread and the UI never freezes.
// In node (the vlm-smoke script, no Worker available) it delegates straight
// to the engine. Exports and signatures are identical to the old inline
// implementation: same callables, same status subscription, same
// `ModelLoadError` identity (re-created here from the serialized worker
// payload so `instanceof` holds in the UI).
import { convertPortion } from './portions'
import {
  ModelLoadError,
  warmupVlm as engineWarmup,
  getVlmStatus as engineGetStatus,
  subscribeVlm as engineSubscribe,
  isVlmReady as engineIsReady,
  extractMealText as engineExtractText,
  extractMealPhoto as engineExtractPhoto,
  estimateTextPortions as engineEstimateTextPortions,
  estimatePhotoPortions as engineEstimatePhotoPortions,
  pickFoodMatch as enginePickFoodMatch,
  analyzeMealText as engineAnalyzeMealText,
  analyzeMealPhoto as engineAnalyzeMealPhoto,
} from './vlm-engine'
import type { AnalyzeResult, VlmState, VlmStatus } from './vlm-engine'

export type { AnalyzeResult, VlmState, VlmStatus }
export { ModelLoadError, HF_VLM_ID, LOCAL_ONNX_ID, VLM_ID } from './vlm-engine'

type ProgressFn = (message: string, pct?: number) => void

const USE_WORKER = typeof Worker !== 'undefined' && typeof window !== 'undefined'

// --- Browser: Web Worker transport ------------------------------------------

let worker: Worker | null = null

type Listener = (s: VlmStatus) => void
let status: VlmStatus = { state: 'idle', message: '', pct: 0 }
const listeners = new Set<Listener>()

function setStatus(next: VlmStatus): void {
  status = next
  for (const fn of listeners) fn(status)
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
  onProgress?: ProgressFn
}

const pending = new Map<number, Pending>()
let seqCounter = 0

interface WorkerMessage {
  type: string
  seq?: number
  data?: unknown
  status?: VlmStatus
  message?: string
  pct?: number
  error?: { __isModelLoadError?: boolean; message?: string; cause?: string }
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./vlm.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent) => {
    const msg = event.data as WorkerMessage
    if (msg.type === 'status' && msg.status) {
      setStatus(msg.status)
      return
    }
    if (msg.type === 'progress' && msg.seq != null) {
      const p = pending.get(msg.seq)
      if (p) p.onProgress?.(msg.message ?? '', msg.pct)
      return
    }
    if (msg.type === 'result' && msg.seq != null) {
      const p = pending.get(msg.seq)
      if (!p) return
      pending.delete(msg.seq)
      if (msg.error) {
        if (msg.error.__isModelLoadError) {
          p.reject(new ModelLoadError(msg.error.message ?? 'Model load failed', msg.error.cause))
        } else {
          p.reject(new Error(msg.error.message ?? 'VLM worker error'))
        }
        return
      }
      p.resolve(msg.data)
    }
  }
  worker = w
  return w
}

function call<T>(type: string, payload: Record<string, unknown>, onProgress?: ProgressFn): Promise<T> {
  const w = getWorker()
  const seq = ++seqCounter
  return new Promise<T>((resolve, reject) => {
    pending.set(seq, { resolve: resolve as (value: unknown) => void, reject, onProgress })
    w.postMessage({ type, seq, payload })
  })
}

// --- Public API (routes by environment) ------------------------------------

export function warmupVlm(): void {
  if (USE_WORKER) {
    if (status.state === 'ready' || status.state === 'downloading') return
    getWorker().postMessage({ type: 'warmup', seq: ++seqCounter, payload: {} })
    return
  }
  engineWarmup()
}

export function getVlmStatus(): VlmStatus {
  if (USE_WORKER) return status
  return engineGetStatus()
}

export function subscribeVlm(fn: (s: VlmStatus) => void): () => void {
  if (USE_WORKER) {
    listeners.add(fn)
    fn(status)
    return () => {
      listeners.delete(fn)
    }
  }
  return engineSubscribe(fn)
}

export function isVlmReady(): boolean {
  if (USE_WORKER) return status.state === 'ready'
  return engineIsReady()
}

export function extractMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('extractMealText', { text }, onProgress)
  return engineExtractText(text, onProgress)
}

export function extractMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('extractMealPhoto', { image }, onProgress)
  return engineExtractPhoto(image, onProgress)
}

export function estimateTextPortions(
  meal: string,
  names: string[],
  lines: string[],
  onProgress?: ProgressFn,
): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('estimateTextPortions', { meal, names, lines }, onProgress)
  return engineEstimateTextPortions(meal, names, lines, onProgress)
}

export function estimatePhotoPortions(
  image: Blob,
  names: string[],
  lines: string[],
  onProgress?: ProgressFn,
): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('estimatePhotoPortions', { image, names, lines }, onProgress)
  return engineEstimatePhotoPortions(image, names, lines, onProgress)
}

export function pickFoodMatch(
  meal: string,
  item: Parameters<typeof enginePickFoodMatch>[1],
  lines: string[],
  onProgress?: ProgressFn,
): Promise<{ decision: import('./vlmParse').PickDecision; raw: string; ms: number; error?: string }> {
  if (USE_WORKER) return call('pickFoodMatch', { meal, item, lines }, onProgress)
  return enginePickFoodMatch(meal, item, lines, onProgress)
}

export function analyzeMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('analyzeMealText', { text }, onProgress)
  return engineAnalyzeMealText(text, onProgress)
}

export function analyzeMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  if (USE_WORKER) return call('analyzeMealPhoto', { image }, onProgress)
  return engineAnalyzeMealPhoto(image, onProgress)
}

// --- Debug toggle + window surface (retained for API compatibility) --------

const dbg =
  (typeof window !== 'undefined' ? (window.__opencalVlmDebug ?? {}) : {}) as {
    enabled?: boolean
    verbose?: boolean
    set?: (o: { enabled?: boolean; verbose?: boolean }) => void
  }
let dbgEnabled = dbg.enabled !== false
let dbgVerbose = dbg.verbose === true
function setDbg(o: { enabled?: boolean; verbose?: boolean }) {
  if (o.enabled !== undefined) dbgEnabled = o.enabled
  if (o.verbose !== undefined) dbgVerbose = o.verbose
}

if (typeof window !== 'undefined') {
  window.__opencalVlmDebug = {
    enabled: dbgEnabled,
    verbose: dbgVerbose,
    set: setDbg,
  } as unknown as typeof window.__opencalVlmDebug
  Object.assign(window, {
    __opencalVlm: {
      getVlmStatus,
      warmupVlm,
      extractMealText,
      extractMealPhoto,
      estimateTextPortions,
      estimatePhotoPortions,
      pickFoodMatch,
      convertPortion,
      analyzeMealText,
      analyzeMealPhoto,
      isVlmReady,
    },
  })
}
