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

export const HF_VLM_ID = 'opencal/opencal-base'
export const LOCAL_ONNX_ID = '/models/lfm25vl-opencal'
/** Active transformers.js model id. Hugging Face only if no local ONNX is present. */
export let VLM_ID = HF_VLM_ID

export type VlmState = 'idle' | 'downloading' | 'ready' | 'error'

/**
 * Debug logging for the on-device generation loop. On by default so the
 * "identification" step can be inspected; flip to `false` to silence.
 * Exposed on the window as `__opencalVlmDebug`.
 */
const dbg = (typeof window !== 'undefined' ? (window.__opencalVlmDebug ?? {}) : {}) as {
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
function vlog(...args: unknown[]): void {
  if (!dbgEnabled) return
  console.log('%c[vlm]', 'color:#0a8;color:rebeccapurple;font-weight:600', ...args)
}
function vlogv(...args: unknown[]): void {
  if (!dbgEnabled || !dbgVerbose) return
  console.log('%c[vlm:verbose]', 'color:rebeccapurple', ...args)
}
const trunc = (s: string, n = 800) => (s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s)
if (typeof window !== 'undefined') {
  window.__opencalVlmDebug = {
    enabled: dbgEnabled,
    verbose: dbgVerbose,
    set: setDbg,
  } as unknown as typeof window.__opencalVlmDebug
}

/** Raised when the on-device vision model fails to load (download/runtime). Carries
 *  the underlying message so the UI can show the real reason instead of an empty
 *  "no foods found" result. */
export class ModelLoadError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ModelLoadError'
    this.cause = cause
  }
}

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

async function resolveTransformersId(): Promise<string> {
  try {
    const r = await fetch(`${LOCAL_ONNX_ID}/config.json`, { cache: 'no-store' })
    // Vite's dev-server SPA fallback returns 200 with text/html for any
    // unknown path, so check the content-type rather than just r.ok.
    const ct = (r.headers.get('content-type') ?? '').toLowerCase()
    if (r.ok && ct.includes('json')) return LOCAL_ONNX_ID
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
    // fp16 across every submodule. Only the decoder has a q4f16 export, so a
    // "quantized decoder + fp16 inners" mix produces Add nodes with mismatched
    // operand types and WebGPU refuses to build the session (verified live).
    // fp16 is the consistent, highest-quality config that always builds.
    return {
      device: 'webgpu',
      dtype: { embed_tokens: 'fp16', decoder_model_merged: 'fp16', vision_encoder: 'fp16' },
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
    setStatus({ state: 'downloading', message: 'Loading on-device vision…', pct: 4 })
    onProgress?.('Loading on-device vision…', 4)
    const tf = await import('@huggingface/transformers')
    VLM_ID = await resolveTransformersId()
    const local = VLM_ID.startsWith('/')
    const env = (tf as { env?: { allowLocalModels?: boolean } }).env
    if (env) {
      // Only enable local-model loading when we actually resolved a local
      // path. Setting it for a Hub id like 'opencal/opencal-base' makes
      // transformers.js treat the id as a relative local path
      // ('/models/opencal/opencal-base/…'); the Vite/dev-server SPA
      // fallback then returns index.html (200 + HTML) for those URLs and
      // JSON.parse("<!doctype…" throws the "not valid JSON" error.
      if (local) env.allowLocalModels = true
    }
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

    // Consistent single-dtype sets only: mixing q4f16 (decoder-only) with fp16
    // inners makes WebGPU refuse the session. fp16 = highest quality (the
    // decoder follows the extraction prompt correctly) and every submodule
    // ships it; q4 = a smaller fallback if fp16 ever fails to build.
    let model: unknown
    const errors: string[] = []
    const candidates =
      device === 'webgpu'
        ? [
            { embed_tokens: 'fp16', decoder_model_merged: 'fp16', vision_encoder: 'fp16' },
            { embed_tokens: 'q4', decoder_model_merged: 'q4', vision_encoder: 'q4' },
          ]
        : [dtype]
    for (const [i, dtypeTry] of candidates.entries()) {
      try {
        vlog(
          `loadSession: attempting dtype ${JSON.stringify(dtypeTry as Record<string, DType>)} (${
            i + 1
          }/${candidates.length})`,
        )
        model = await tf.AutoModelForImageTextToText.from_pretrained(VLM_ID, {
          device,
          dtype: dtypeTry as Record<string, DType>,
          progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
            if (info.status === 'progress' && info.progress != null) {
              const pct = 20 + Math.round(info.progress * 0.7)
              const msg = local ? `Loading ${info.file ?? 'weights'}…` : `Downloading ${info.file ?? 'weights'}…`
              setStatus({ state: 'downloading', message: msg, pct })
              onProgress?.(msg, pct)
            }
          },
        })
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`dtype=${JSON.stringify(dtypeTry)}: ${message}`)
        vlogv('loadSession: dtype attempt failed', errors.at(-1))
      }
    }
    if (model === undefined) {
      throw new ModelLoadError(
        `Could not build an on-device session for any dtype variant:\n${errors.join('\n')}`,
      )
    }

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
    const message = err instanceof Error ? err.message : 'Could not load the on-device vision model'
    setStatus({ state: 'error', message, pct: 0 })
    throw err instanceof ModelLoadError ? err : new ModelLoadError(message, err)
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
  tag = '?',
): Promise<string> {
  const run = generateLock.then(async () => {
    const prefill = inputs.input_ids.dims.at(-1) ?? 0
    vlogv(`${tag} — generate() start`, {
      model: VLM_ID,
      prefillTokens: prefill,
      maxNewTokens,
      extraInputs: Object.keys(inputs).filter((k) => k !== 'input_ids'),
    })
    const t0 = performance.now()
    const outputs = await sess.model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      repetition_penalty: 1.05,
    })
    const genMs = Math.round(performance.now() - t0)
    const out = outputs as { dims?: number[]; slice: (a: null, range: [number | null, null]) => unknown }
    const total = out.dims?.at(-1) ?? prefill
    const newTokens = Math.max(0, total - prefill)
    const decoded = String(
      sess.processor.batch_decode(out.slice(null, [prefill, null]), { skip_special_tokens: false })[0] ?? '',
    ).trim()
    vlogv(`${tag} — generate() done`, {
      newTokens,
      genMs,
      tokPerSec: genMs ? Math.round((newTokens / genMs) * 1000) : null,
      output: trunc(decoded, 500),
    })
    return decoded
  })
  generateLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function completeText(
  tag: string,
  prompt: string,
  maxNewTokens: number,
  onProgress?: ProgressFn,
): Promise<string> {
  const sess = await loadSession(onProgress)
  vlog(`${tag}: prompt (${prompt.length} chars)`)
  vlogv(`${tag}: prompt body`)
  vlogv(trunc(prompt, 4000))
  const inputs = await sess.processor.tokenizer(prompt, { add_special_tokens: false })
  const inputTokens = inputs.input_ids.dims.at(-1) ?? 0
  vlog(`${tag}: tokenized → ${inputTokens} input tokens, generating ≤${maxNewTokens}`)
  const text = await decodeGeneration(sess, inputs, maxNewTokens, tag)
  vlog(`${tag}: model returned ${text.length} chars`)
  return text
}

export async function extractMealText(text: string, onProgress?: ProgressFn): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
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
    const raw = await completeText('identify', prompt, 220, onProgress)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled, text)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err
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
    const sess = await loadSession(onProgress)
    onProgress?.('Reading the photo…', 16)
    const img = await sess.loadImage(image)
    vlogv('photo identify: image bytes =', (image as Blob).size)
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
    vlog('photo identify: prompt ready (1 image + static extract system); generating ≤220 tokens')
    onProgress?.('Finding foods…', 28)
    const raw = await decodeGeneration(sess, inputs, 220, 'photo-identify')
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err
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
    onProgress?.('Matching catalog servings…', 40)
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: TEXT_PORTION_SYSTEM },
        { role: 'user', content: user },
      ],
      true,
      EXTRACT_PREFIX,
    )
    const raw = await completeText('portion', prompt, 280, onProgress)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled, meal)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err
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
    vlog('photo portion: prompt ready (1 image + catalog); generating ≤280 tokens')
    const raw = await decodeGeneration(sess, inputs, 280, 'photo-portion')
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      path: items.length ? 'vlm' : 'vlm-empty',
      ms: Math.round(performance.now() - started),
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err
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
    const prompt = formatChatPrompt(
      [
        { role: 'system', content: PICK_SYSTEM },
        { role: 'user', content: pickUserPrompt({ meal, item, lines }) },
      ],
      true,
      PICK_PREFIX,
    )
    const raw = await completeText('pick', prompt, 80, onProgress)
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
