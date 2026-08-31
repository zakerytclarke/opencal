import { extractFoods } from './extract'
import { convertPortion } from './portions'
import type { DebugPath, ExtractedItem } from '../types'
import {
  EXTRACT_FEWSHOT,
  EXTRACT_PREFIX,
  EXTRACT_SYSTEM,
  PHOTO_EXTRACT_SYSTEM,
  PHOTO_EXTRACT_USER,
  PHOTO_PORTION_SYSTEM,
  PICK_PREFIX,
  PICK_SYSTEM,
  TEXT_PORTION_SYSTEM,
  extractUserPrompt,
  formatChatPrompt,
  parseExtractedFoods,
  parsePick,
  photoPortionUser,
  pickUserPrompt,
  stripSpecialTokens,
  textPortionUser,
  type PickDecision,
} from './vlmParse'

export type AnalyzeResult = {
  raw: string
  items: ExtractedItem[]
  path: DebugPath
  error?: string
  ms: number
}

export const HF_VLM_ID = 'onnx-community/LFM2.5-VL-450M-ONNX'
export const LOCAL_ONNX_ID = '/models/lfm25vl-opencal'
/** Active transformers.js model id. Hugging Face only if no local ONNX is present. */
export let VLM_ID = HF_VLM_ID

type VlmBackend = 'http' | 'transformers'
let backend: VlmBackend | null = null

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
let generateLock: Promise<void> = Promise.resolve()
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

async function detectBackend(): Promise<VlmBackend> {
  if (backend) return backend
  try {
    const r = await fetch('/vlm/health', { cache: 'no-store' })
    if (r.ok) {
      backend = 'http'
      return backend
    }
  } catch {
    // Dev proxy is optional; fall through to on-device ONNX.
  }
  backend = 'transformers'
  return backend
}

async function resolveTransformersId(): Promise<string> {
  try {
    const r = await fetch(`${LOCAL_ONNX_ID}/config.json`, { cache: 'no-store' })
    if (r.ok) return LOCAL_ONNX_ID
  } catch {
    // No local ONNX bundle in public/models.
  }
  return HF_VLM_ID
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
    const kind = await detectBackend()
    if (kind === 'http') {
      setStatus({ state: 'ready', message: 'Local OpenCal vision ready', pct: 100 })
      onProgress?.('Local OpenCal vision ready', 100)
      // Dummy session; extract/pick go through /vlm.
      const dummy = {
        processor: {
          tokenizer: async () => ({ input_ids: { dims: [0] } }),
          batch_decode: () => [''],
        },
        model: { generate: async () => ({ slice: () => [] }) },
        runProcessor: async () => ({ input_ids: { dims: [0] } }),
        loadImage: async () => null,
      } as unknown as Session
      session = dummy
      return dummy
    }

    setStatus({ state: 'downloading', message: 'Loading on-device vision…', pct: 4 })
    onProgress?.('Loading on-device vision…', 4)
    const tf = await import('@huggingface/transformers')
    const env = (tf as { env?: { allowLocalModels?: boolean } }).env
    if (env) env.allowLocalModels = true
    VLM_ID = await resolveTransformersId()
    const local = VLM_ID.startsWith('/')
    const { device, dtype } = pickRuntime()
    const preparing = local
      ? 'Loading local OpenCal weights…'
      : device === 'webgpu'
        ? 'Preparing WebGPU…'
        : 'Preparing on-device runtime…'
    setStatus({ message: preparing, pct: 10 })
    onProgress?.(preparing, 10)

    const processor = await tf.AutoProcessor.from_pretrained(VLM_ID, {
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && info.progress != null) {
          const pct = 10 + Math.round(info.progress * 0.7)
          const msg = local ? `Loading ${info.file ?? 'model'}…` : `Downloading ${info.file ?? 'model'}…`
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
          const msg = local ? `Loading ${info.file ?? 'weights'}…` : `Downloading ${info.file ?? 'weights'}…`
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
  maxNewTokens: number,
): Promise<string> {
  const run = generateLock.then(async () => {
    const outputs = await sess.model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      repetition_penalty: 1.05,
    })
    const start = inputs.input_ids.dims.at(-1) ?? 0
    const decoded = sess.processor.batch_decode(
      (outputs as { slice: (a: null, range: [number | null, null]) => unknown }).slice(null, [start, null]),
      { skip_special_tokens: false },
    )[0]
    return String(decoded ?? '').trim()
  })
  generateLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function completeText(prompt: string, maxNewTokens: number, onProgress?: ProgressFn): Promise<string> {
  const sess = await loadSession(onProgress)
  const inputs = await sess.processor.tokenizer(prompt, { add_special_tokens: false })
  return decodeGeneration(sess, inputs, maxNewTokens)
}

export async function extractMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
    if ((await detectBackend()) === 'http') {
      onProgress?.('Finding foods…', 18)
      const r = await fetch('/vlm/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = (await r.json()) as { raw?: string }
      const raw = data.raw ?? ''
      const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
      const items = parseExtractedFoods(labeled, text)
      setStatus({ state: 'ready', message: 'Local OpenCal vision ready', pct: 100 })
      return {
        raw: stripSpecialTokens(labeled) || labeled,
        items,
        path: items.length ? 'vlm' : 'vlm-empty',
        ms: Math.round(performance.now() - started),
      }
    }
    onProgress?.('Finding foods…', 18)
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: EXTRACT_SYSTEM },
        ...EXTRACT_FEWSHOT,
        { role: 'user', content: extractUserPrompt(text) },
      ],
      true,
      EXTRACT_PREFIX,
    )
    const raw = await completeText(prompt, 220, onProgress)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled, text)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      raw: '',
      items: extractFoods(text),
      path: 'error-fallback',
      error: message,
      ms: Math.round(performance.now() - started),
    }
  }
}

export async function extractMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
    if ((await detectBackend()) === 'http') {
      onProgress?.('Reading the photo…', 16)
      const body = new FormData()
      body.append('image', image, 'plate.jpg')
      const r = await fetch('/vlm/extract-photo', { method: 'POST', body })
      const data = (await r.json()) as { raw?: string }
      const raw = data.raw ?? ''
      const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
      const items = parseExtractedFoods(labeled)
      return {
        raw: stripSpecialTokens(labeled) || labeled,
        items,
        path: items.length ? 'vlm' : 'vlm-empty',
        ms: Math.round(performance.now() - started),
      }
    }
    const sess = await loadSession(onProgress)
    onProgress?.('Reading the photo…', 16)
    const img = await sess.loadImage(image)
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: PHOTO_EXTRACT_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image' },
            { type: 'text', text: PHOTO_EXTRACT_USER },
          ],
        },
      ],
      true,
      EXTRACT_PREFIX,
    )
    const inputs = await sess.runProcessor(img, prompt)
    onProgress?.('Finding foods…', 28)
    const raw = await decodeGeneration(sess, inputs, 220)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      raw: '',
      items: [],
      path: 'error-fallback',
      error: message,
      ms: Math.round(performance.now() - started),
    }
  }
}

export async function estimateTextPortions(
  meal: string,
  names: string[],
  lines: string[],
  onProgress?: ProgressFn,
): Promise<AnalyzeResult> {
  const started = performance.now()
  const user = textPortionUser(meal, names, lines)
  try {
    if ((await detectBackend()) === 'http') {
      onProgress?.('Matching catalog servings…', 40)
      const r = await fetch('/vlm/portion-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: meal, catalog: user }),
      })
      const data = (await r.json()) as { raw?: string }
      const raw = data.raw ?? ''
      const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
      const items = parseExtractedFoods(labeled, meal)
      return {
        raw: stripSpecialTokens(labeled) || labeled,
        items,
        path: items.length ? 'vlm' : 'vlm-empty',
        ms: Math.round(performance.now() - started),
      }
    }
    onProgress?.('Matching catalog servings…', 40)
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: TEXT_PORTION_SYSTEM },
        { role: 'user', content: user },
      ],
      true,
      EXTRACT_PREFIX,
    )
    const raw = await completeText(prompt, 280, onProgress)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled, meal)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      raw: '',
      items: [],
      path: 'error-fallback',
      error: message,
      ms: Math.round(performance.now() - started),
    }
  }
}

export async function estimatePhotoPortions(
  image: Blob,
  names: string[],
  lines: string[],
  onProgress?: ProgressFn,
): Promise<AnalyzeResult> {
  const started = performance.now()
  const user = photoPortionUser(names, lines)
  try {
    if ((await detectBackend()) === 'http') {
      onProgress?.('Estimating portions…', 40)
      const body = new FormData()
      body.append('image', image, 'plate.jpg')
      body.append('catalog', user)
      const r = await fetch('/vlm/portion-photo', { method: 'POST', body })
      const data = (await r.json()) as { raw?: string }
      const raw = data.raw ?? ''
      const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
      const items = parseExtractedFoods(labeled)
      return {
        raw: stripSpecialTokens(labeled) || labeled,
        items,
        path: items.length ? 'vlm' : 'vlm-empty',
        ms: Math.round(performance.now() - started),
      }
    }
    const sess = await loadSession(onProgress)
    onProgress?.('Estimating portions…', 40)
    const img = await sess.loadImage(image)
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: PHOTO_PORTION_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'image' },
            { type: 'text', text: user },
          ],
        },
      ],
      true,
      EXTRACT_PREFIX,
    )
    const inputs = await sess.runProcessor(img, prompt)
    const raw = await decodeGeneration(sess, inputs, 280)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      raw: '',
      items: [],
      path: 'error-fallback',
      error: message,
      ms: Math.round(performance.now() - started),
    }
  }
}

export async function pickFoodMatch(
  meal: string,
  item: ExtractedItem,
  lines: string[],
  onProgress?: ProgressFn,
): Promise<{ decision: PickDecision; raw: string; ms: number; error?: string }> {
  const started = performance.now()
  try {
    if ((await detectBackend()) === 'http') {
      const r = await fetch('/vlm/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal, item, lines }),
      })
      const data = (await r.json()) as { raw?: string }
      const raw = data.raw ?? ''
      const labeled = raw.trim().startsWith('{') ? raw : `${PICK_PREFIX}${raw}`
      return {
        decision: parsePick(labeled, lines.length),
        raw: stripSpecialTokens(labeled) || labeled,
        ms: Math.round(performance.now() - started),
      }
    }
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: PICK_SYSTEM },
        { role: 'user', content: pickUserPrompt({ meal, item, lines }) },
      ],
      true,
      PICK_PREFIX,
    )
    const raw = await completeText(prompt, 80, onProgress)
    const labeled = raw.trim().startsWith('{') ? raw : `${PICK_PREFIX}${raw}`
    return {
      decision: parsePick(labeled, lines.length),
      raw: stripSpecialTokens(labeled) || labeled,
      ms: Math.round(performance.now() - started),
    }
    } catch (err) {
    return {
      decision: {
        index: null,
        name: item.query,
        brand: item.brand ?? null,
        unit: item.unit,
        quantity: item.quantity,
      },
      raw: '',
      ms: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Extract-only wrappers used by tests. USDA mapping happens in the pipeline. */
export async function analyzeMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  return extractMealText(text, onProgress)
}

export async function analyzeMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  return extractMealPhoto(image, onProgress)
}

if (typeof window !== 'undefined') {
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
