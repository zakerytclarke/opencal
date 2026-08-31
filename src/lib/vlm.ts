import { extractFoods } from './extract'
import type { DebugPath, ExtractedItem } from '../types'
import {
  PHOTO_USER_PROMPT,
  SYSTEM_PROMPT,
  itemsFromModelText,
  parseToolCalls,
  stripSpecialTokens,
  textUserPrompt,
} from './vlmParse'

export type AnalyzeResult = {
  raw: string
  items: ExtractedItem[]
  path: DebugPath
  error?: string
  ms: number
}

export const VLM_ID = 'onnx-community/LFM2.5-VL-450M-ONNX'

export type VlmState = 'idle' | 'downloading' | 'ready' | 'error'

export type VlmStatus = {
  state: VlmState
  message: string
  pct: number
}

type ProgressFn = (message: string, pct?: number) => void

type TensorLike = { dims: number[] }

type Session = {
  processor: {
    apply_chat_template: (
      messages: unknown[],
      opts: { add_generation_prompt: boolean; tokenize?: boolean },
    ) => string
    tokenizer: (
      text: string,
      opts?: { add_special_tokens?: boolean },
    ) => Promise<{ input_ids: TensorLike } & Record<string, unknown>>
    batch_decode: (ids: unknown, opts: { skip_special_tokens: boolean }) => string[]
  }
  model: {
    generate: (opts: Record<string, unknown>) => Promise<unknown>
  }
  runProcessor: (
    image: unknown,
    prompt: string,
  ) => Promise<{ input_ids: TensorLike } & Record<string, unknown>>
  loadImage: (input: Blob | string) => Promise<unknown>
}

let session: Session | null = null
let loadPromise: Promise<Session> | null = null
let status: VlmStatus = { state: 'idle', message: '', pct: 0 }
const listeners = new Set<(s: VlmStatus) => void>()

function setStatus(next: Partial<VlmStatus>) {
  status = { ...status, ...next }
  for (const fn of listeners) fn(status)
}

export function getVlmStatus(): VlmStatus {
  return status
}

export function subscribeVlm(fn: (s: VlmStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => {
    listeners.delete(fn)
  }
}

function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
}

function isNode(): boolean {
  return typeof window === 'undefined'
}

type DType = 'fp16' | 'q4f16' | 'q4' | 'q8'

function pickRuntime(): { device: 'webgpu' | 'wasm' | 'cpu'; dtype: Record<string, DType> } {
  if (hasWebGpu()) {
    return {
      device: 'webgpu',
      dtype: { embed_tokens: 'fp16', decoder_model_merged: 'q4f16', vision_encoder: 'fp16' },
    }
  }
  if (isNode()) {
    return {
      device: 'cpu',
      dtype: { embed_tokens: 'q4', decoder_model_merged: 'q4', vision_encoder: 'q4' },
    }
  }
  return {
    device: 'wasm',
    dtype: { embed_tokens: 'q8', decoder_model_merged: 'q4', vision_encoder: 'q8' },
  }
}

async function loadSession(onProgress?: ProgressFn): Promise<Session> {
  if (session) return session
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    setStatus({ state: 'downloading', message: 'Downloading on-device vision…', pct: 4 })
    onProgress?.('Downloading on-device vision…', 4)
    const tf = await import('@huggingface/transformers')
    const { device, dtype } = pickRuntime()
    const preparing =
      device === 'webgpu' ? 'Preparing WebGPU…' : device === 'cpu' ? 'Preparing on-device runtime…' : 'Preparing on-device runtime…'
    setStatus({ message: preparing, pct: 10 })
    onProgress?.(preparing, 10)

    const processor = await tf.AutoProcessor.from_pretrained(VLM_ID, {
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && info.progress != null) {
          const pct = 10 + Math.round(info.progress * 0.7)
          const msg = `Downloading ${info.file ?? 'model'}…`
          setStatus({ state: 'downloading', message: msg, pct })
          onProgress?.(msg, pct)
        }
      },
    })
    const imageProc = processor.image_processor as { do_image_splitting?: boolean } | undefined
    if (imageProc) imageProc.do_image_splitting = false

    const model = await tf.AutoModelForImageTextToText.from_pretrained(VLM_ID, {
      device,
      dtype,
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && info.progress != null) {
          const pct = 20 + Math.round(info.progress * 0.7)
          const msg = `Downloading ${info.file ?? 'weights'}…`
          setStatus({ state: 'downloading', message: msg, pct })
          onProgress?.(msg, pct)
        }
      },
    })

    const ready: Session = {
      processor: processor as unknown as Session['processor'],
      model: model as Session['model'],
      runProcessor: (image, prompt) =>
        (
          processor as unknown as (
            img: unknown,
            text: string,
            opts: { add_special_tokens: boolean },
          ) => Promise<{ input_ids: TensorLike } & Record<string, unknown>>
        )(image, prompt, { add_special_tokens: false }),
      loadImage: (input) => tf.RawImage.read(input),
    }
    session = ready
    setStatus({ state: 'ready', message: 'Photo logging ready', pct: 100 })
    onProgress?.('Photo logging ready', 100)
    return ready
  })().catch((err: unknown) => {
    loadPromise = null
    const message = err instanceof Error ? err.message : 'Could not load vision model'
    setStatus({ state: 'error', message, pct: 0 })
    throw err
  })
  return loadPromise
}

/** Start the LFM download without blocking the UI. Safe to call many times. */
export function warmupVlm(): void {
  if (status.state === 'ready' || status.state === 'downloading') return
  void loadSession().catch(() => {})
}

export function isVlmReady(): boolean {
  return status.state === 'ready'
}

async function decodeGeneration(
  sess: Session,
  inputs: { input_ids: TensorLike } & Record<string, unknown>,
): Promise<string> {
  const outputs = await sess.model.generate({
    ...inputs,
    max_new_tokens: 320,
    do_sample: false,
    repetition_penalty: 1.05,
  })
  const start = inputs.input_ids.dims.at(-1) ?? 0
  const decoded = sess.processor.batch_decode(
    (outputs as { slice: (a: null, range: [number | null, null]) => unknown }).slice(null, [start, null]),
    { skip_special_tokens: false },
  )[0]
  return String(decoded ?? '').trim()
}

function finish(raw: string, items: ExtractedItem[], started: number, fallback?: string): AnalyzeResult {
  const usedModel = parseToolCalls(raw).length > 0
  const resolved = items.length ? items : fallback ? extractFoods(fallback) : []
  return {
    raw: stripSpecialTokens(raw) || raw,
    items: resolved,
    path: usedModel ? 'vlm' : 'vlm-empty',
    ms: Math.round(performance.now() - started),
  }
}

function fail(err: unknown, started: number, fallbackItems: ExtractedItem[]): AnalyzeResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    raw: '',
    items: fallbackItems,
    path: 'error-fallback',
    error: message,
    ms: Math.round(performance.now() - started),
  }
}

export async function analyzeMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
    const sess = await loadSession(onProgress)
    onProgress?.('Reading the photo…', 82)
    const img = await sess.loadImage(image)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: PHOTO_USER_PROMPT },
        ],
      },
    ]
    const prompt = sess.processor.apply_chat_template(messages, { add_generation_prompt: true })
    const inputs = await sess.runProcessor(img, prompt)
    onProgress?.('Finding foods…', 88)
    const raw = await decodeGeneration(sess, inputs)
    onProgress?.('Matching the local database…', 94)
    return finish(raw, itemsFromModelText(raw), started)
  } catch (err) {
    return fail(err, started, [])
  }
}

export async function analyzeMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
    const sess = await loadSession(onProgress)
    onProgress?.('Running LFM2.5-VL…', 82)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: textUserPrompt(text) },
    ]
    const prompt = sess.processor.apply_chat_template(messages, { add_generation_prompt: true, tokenize: false })
    const inputs = await sess.processor.tokenizer(prompt, { add_special_tokens: false })
    onProgress?.('Finding foods…', 88)
    const raw = await decodeGeneration(sess, inputs)
    onProgress?.('Matching the local database…', 94)
    return finish(raw, itemsFromModelText(raw, text), started, text)
  } catch (err) {
    return fail(err, started, extractFoods(text))
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    __opencalVlm: {
      getVlmStatus,
      warmupVlm,
      analyzeMealText,
      analyzeMealPhoto,
      isVlmReady,
    },
  })
}
