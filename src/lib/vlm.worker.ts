// Web Worker entry. Runs the VLM engine on a worker thread so the main
// thread stays unblocked during inference. Vite bundles this as a separate
// module worker — @huggingface/transformers ships here, not in the main
// bundle — and imports the shared engine implementation from ./vlm-engine.
import {
  ModelLoadError,
  analyzeMealPhoto,
  analyzeMealText,
  estimatePhotoPortions,
  estimateTextPortions,
  extractMealPhoto,
  extractMealText,
  pickFoodMatch,
  subscribeVlm,
  warmupVlm,
} from './vlm-engine'
import type { ExtractedItem } from '../types'

type WindowPost = {
  postMessage: (message: unknown) => void
}

const post = ((self as unknown) as WindowPost).postMessage.bind(self as unknown)

// Re-broadcast the engine's load status to the main thread so the proxy's
// getVlmStatus / subscribeVlm stay in sync with what the worker is doing.
subscribeVlm((status) => {
  post({ type: 'status', status })
})

async function dispatch(type: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (type) {
    case 'warmup':
      try {
        warmupVlm()
      } catch (err) {
        if (err instanceof ModelLoadError) {
          return { __isModelLoadError: true, message: err.message, cause: err.cause instanceof Error ? err.cause.message : undefined }
        }
        return { message: err instanceof Error ? err.message : String(err) }
      }
      return null
    case 'extractMealText':
      return extractMealText((payload as { text: string }).text, (m, p) => post({ type: 'progress', message: m, pct: p }))
    case 'extractMealPhoto':
      return extractMealPhoto((payload as { image: Blob }).image, (m, p) => post({ type: 'progress', message: m, pct: p }))
    case 'estimateTextPortions':
      return estimateTextPortions(
        (payload as { meal: string }).meal,
        (payload as { names: string[] }).names,
        (payload as { lines: string[] }).lines,
        (m, p) => post({ type: 'progress', message: m, pct: p }),
      )
    case 'estimatePhotoPortions':
      return estimatePhotoPortions(
        (payload as { image: Blob }).image,
        (payload as { names: string[] }).names,
        (payload as { lines: string[] }).lines,
        (m, p) => post({ type: 'progress', message: m, pct: p }),
      )
    case 'pickFoodMatch':
      return pickFoodMatch(
        (payload as { meal: string }).meal,
        (payload as { item: ExtractedItem }).item,
        (payload as { lines: string[] }).lines,
        (m, p) => post({ type: 'progress', message: m, pct: p }),
      )
    case 'analyzeMealText':
      return analyzeMealText((payload as { text: string }).text, (m, p) => post({ type: 'progress', message: m, pct: p }))
    case 'analyzeMealPhoto':
      return analyzeMealPhoto((payload as { image: Blob }).image, (m, p) => post({ type: 'progress', message: m, pct: p }))
    default:
      throw new Error(`Unknown worker message type: ${type}`)
  }
}

interface WorkerMessage {
  type: string
  seq?: number
  payload?: Record<string, unknown>
}

const selfScope = self as unknown as {
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void
}
selfScope.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as WorkerMessage
  dispatch(msg.type, msg.payload ?? {})
    .then((data) => {
      post({ type: 'result', seq: msg.seq, data: data ?? null })
    })
    .catch((err: unknown) => {
      if (err instanceof ModelLoadError) {
        post({
          type: 'result',
          seq: msg.seq,
          data: null,
          error: { __isModelLoadError: true, message: err.message, cause: err.cause instanceof Error ? err.cause.message : undefined },
        })
        return
      }
      post({ type: 'result', seq: msg.seq, data: null, error: { message: err instanceof Error ? err.message : String(err) } })
    })
})

post({ type: 'ready' })
