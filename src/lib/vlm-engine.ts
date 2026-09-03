// On-device VLM engine. Runs wherever it is imported: inside the Web Worker
// (browser) or directly in node (the vlm-smoke script). Owns model loading,
// generation, and load-status. No DOM, no Worker — pure compute plus the
// @huggingface/transformers inference stack (dynamically imported).
import { extractFoods } from './extract'
import type { DebugPath, ExtractedItem } from '../types'
import {
  EXTRACT_FEWSHOT,
  EXTRACT_PREFIX,
  EXTRACT_SYSTEM,
  PHOTO_EXTRACT_PREFIX,
  PHOTO_EXTRACT_SYSTEM,
  PHOTO_EXTRACT_USER,
  PHOTO_PORTION_SYSTEM,
  PICK_PREFIX,
  PICK_SYSTEM,
  TEXT_PORTION_SYSTEM,
  extractUserPrompt,
  formatChatPrompt,
  parseExtractedFoods,
  parsePhotoExtraction,
  parsePick,
  photoPortionUser,
  pickUserPrompt,
  stripSpecialTokens,
  textPortionUser,
  type PickDecision,
} from './vlmParse'

function formatOne(item: ExtractedItem): string {
  return `${item.query}${item.brand ? ` (${item.brand})` : ''} ×${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
}

function formatItems(items: ExtractedItem[]): string {
  if (!items.length) return 'no foods named'
  return items.map((i) => i.query).join(' · ')
}

/** Console block showing the parsed structure each model output resolves into. */
function logParsed(tag: string, items: ExtractedItem[], mealName?: string): void {
  const line = '─'.repeat(56)
  const shown = mealName ? `${mealName}: ${formatItems(items)}` : formatItems(items)
  console.log(`%c[vlm:${tag}] OUTPUT → ${items.length} item(s) · ${shown}`, 'color:#08f;font-weight:600')
  if (items.length) {
    console.log(`%c[vlm:${tag}] items\n${line}\n%s\n${line}`, 'color:#08f', items.map(formatOne).join('\n'))
  }
}

export type AnalyzeResult = {
  raw: string
  items: ExtractedItem[]
  mealName?: string
  path: DebugPath
  error?: string
  ms: number
}

export const HF_VLM_ID = 'onnx-community/LFM2.5-VL-450M-ONNX'
export const LOCAL_ONNX_ID = '/models/lfm25vl-opencal'
/** Active transformers.js model id. Hugging Face only if no local ONNX is present. */
export let VLM_ID = HF_VLM_ID

export type VlmState = 'idle' | 'downloading' | 'ready' | 'error'

export type VlmStatus = {
  state: VlmState
  message: string
  pct: number
}

type TensorLike = { dims: number[] }

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

type OnProgress = (message: string, pct?: number) => void

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

export function warmupVlm(): void {
  if (status.state === 'ready' || status.state === 'downloading') return
  void loadSession().catch(() => {})
}

export function isVlmReady(): boolean {
  return status.state === 'ready'
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

async function loadSession(onProgress?: OnProgress): Promise<Session> {
  if (session) return session
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    setStatus({ state: 'downloading', message: 'Loading on-device vision…', pct: 4 })
    onProgress?.('Loading on-device vision…', 4)
    const tf = await import('@huggingface/transformers')
    // Let tests/scripts force a specific Hub model without touching public/models
    // (e.g. the base LFM used to validate prompts before shipping a fine-tune).
    const forced = (globalThis as { OPENCAL_VLM_ID?: string }).OPENCAL_VLM_ID
    VLM_ID = forced || (await resolveTransformersId())
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
    for (const dtypeTry of candidates) {
      try {
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

async function decodeGeneration(
  sess: Session,
  inputs: { input_ids: TensorLike } & Record<string, unknown>,
  maxNewTokens: number,
): Promise<string> {
  const run = generateLock.then(async () => {
    const prefill = inputs.input_ids.dims.at(-1) ?? 0
    const outputs = await sess.model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      repetition_penalty: 1.05,
    })
    const out = outputs as { slice: (a: null, range: [number | null, null]) => unknown }
    const decoded = String(
      sess.processor.batch_decode(out.slice(null, [prefill, null]), { skip_special_tokens: false })[0] ?? '',
    ).trim()
    const shown = decoded.length > 800 ? `${decoded.slice(0, 800)}…(+${decoded.length - 800})` : decoded
    console.log('%c[vlm:out] raw model completion →', 'color:#08f;font-weight:600')
    console.log('%c[vlm:out]', 'color:#08f', shown || '(empty)')
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
  onProgress?: OnProgress,
): Promise<string> {
  const sess = await loadSession(onProgress)
  console.log(`%c[vlm] %s: prompt (%d chars)`, 'color:#0a8;color:rebeccapurple;font-weight:600', tag, prompt.length)
  console.log('%c[vlm:verbose]', 'color:rebeccapurple', tag, ': prompt body')
  console.log('%c[vlm:verbose]', 'color:rebeccapurple', prompt.length > 4000 ? `${prompt.slice(0, 4000)}…(+${prompt.length - 4000})` : prompt)
  const inputs = await sess.processor.tokenizer(prompt, { add_special_tokens: false })
  const inputTokens = inputs.input_ids.dims.at(-1) ?? 0
  console.log(`%c[vlm] %s: tokenized → ${inputTokens} input tokens, generating ≤${maxNewTokens}`, 'color:#0a8', tag)
  const text = await decodeGeneration(sess, inputs, maxNewTokens)
  console.log(`%c[vlm] %s: model returned ${text.length} chars`, 'color:#0a8', tag)
  return text
}

export async function extractMealText(text: string, onProgress?: OnProgress): Promise<AnalyzeResult> {
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
    logParsed('identify', items)
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

export async function extractMealPhoto(image: Blob, onProgress?: OnProgress): Promise<AnalyzeResult> {
  const started = performance.now()
  try {
    const sess = await loadSession(onProgress)
    onProgress?.('Reading the photo…', 16)
    const img = await sess.loadImage(image)
    console.log('%c[vlm:verbose]', 'color:rebeccapurple', 'photo identify: image bytes =', (image as Blob).size)
    console.log('%c[vlm:photo] INPUT (user text)', 'color:#08f', PHOTO_EXTRACT_USER)
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
      PHOTO_EXTRACT_PREFIX,
    )
    const inputs = await sess.runProcessor(img, prompt)
    console.log('%c[vlm]', 'color:#0a8', 'photo identify: prompt ready (1 image + static extract system); generating ≤220 tokens')
    onProgress?.('Finding foods…', 28)
    const raw = await decodeGeneration(sess, inputs, 220)
    const trimmedRaw = raw.trim()
    const labeled = /^(?:\[|\{)/.test(trimmedRaw) ? raw : `${PHOTO_EXTRACT_PREFIX}${raw}`
    const { mealName, items } = parsePhotoExtraction(labeled)
    logParsed('photo-identify', items, items.length ? mealName ?? undefined : undefined)
    return {
      raw: stripSpecialTokens(labeled) || labeled,
      items,
      mealName: items.length ? (mealName ?? undefined) : undefined,
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
  onProgress?: OnProgress,
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
    logParsed('text-portion', items)
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
  onProgress?: OnProgress,
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
    console.log('%c[vlm]', 'color:#0a8', 'photo portion: prompt ready (1 image + catalog); generating ≤280 tokens')
    console.log('%c[vlm:photo-portion] INPUT (user text)', 'color:#08f', user)
    const raw = await decodeGeneration(sess, inputs, 280)
    const labeled = raw.trim().startsWith('{') ? raw : `${EXTRACT_PREFIX}${raw}`
    const items = parseExtractedFoods(labeled)
    logParsed('photo-portion', items)
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
  onProgress?: OnProgress,
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
export async function analyzeMealText(text: string, onProgress?: OnProgress): Promise<AnalyzeResult> {
  return extractMealText(text, onProgress)
}

export async function analyzeMealPhoto(image: Blob, onProgress?: OnProgress): Promise<AnalyzeResult> {
  return extractMealPhoto(image, onProgress)
}
