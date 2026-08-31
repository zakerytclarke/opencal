import { extractFoods } from './extract'
import type { ExtractedItem } from '../types'

export const VLM_ID = 'onnx-community/LFM2.5-VL-450M-ONNX'

export type VlmState = 'idle' | 'downloading' | 'ready' | 'error'

export type VlmStatus = {
  state: VlmState
  message: string
  pct: number
}

type ProgressFn = (message: string, pct?: number) => void

type Session = {
  processor: {
    apply_chat_template: (messages: unknown[], opts: { add_generation_prompt: boolean }) => string
    batch_decode: (ids: unknown, opts: { skip_special_tokens: boolean }) => string[]
  }
  model: {
    generate: (opts: Record<string, unknown>) => Promise<unknown>
  }
  runProcessor: (image: unknown, prompt: string) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>
  runText: (prompt: string) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>
  loadImage: (url: string) => Promise<unknown>
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

const SYSTEM = `You are OpenCal's on-device food logger.
The user will describe a meal in text or show a photo.
Identify every distinct food or drink.
Reply with JSON only — no markdown, no prose.
Format:
{"tools":[{"name":"search_foods","arguments":{"query":"scrambled eggs","quantity":2,"unit":"large"}}]}
Rules:
- One search_foods call per distinct item.
- query is a short common grocery name (banana, grilled chicken, brown rice).
- quantity is a number. unit is optional: medium, large, slice, cup, oz, g, bowl, tbsp.
- Estimate portions. Skip plates, utensils, and napkins.`

const PHOTO_USER = 'Log the foods in this photo using search_foods tool calls.'

function hasWebGpu(): boolean {
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
}

async function loadSession(onProgress?: ProgressFn): Promise<Session> {
  if (session) return session
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    setStatus({ state: 'downloading', message: 'Downloading on-device vision…', pct: 4 })
    onProgress?.('Downloading on-device vision…', 4)
    const tf = await import('@huggingface/transformers')
    const gpu = hasWebGpu()
    const device = gpu ? 'webgpu' : 'wasm'
    setStatus({ message: gpu ? 'Preparing WebGPU…' : 'Preparing on-device runtime…', pct: 10 })
    onProgress?.(gpu ? 'Preparing WebGPU…' : 'Preparing on-device runtime…', 10)

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
      dtype: gpu
        ? { embed_tokens: 'fp16', decoder_model_merged: 'q4f16', vision_encoder: 'fp16' }
        : { embed_tokens: 'q8', decoder_model_merged: 'q4', vision_encoder: 'q8' },
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
      processor: processor as Session['processor'],
      model: model as Session['model'],
      runProcessor: (image, prompt) =>
        (processor as unknown as (img: unknown, text: string, opts: { add_special_tokens: boolean }) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>)(
          image,
          prompt,
          { add_special_tokens: false },
        ),
      runText: async (prompt) => {
        const call = processor as unknown as {
          tokenizer?: (text: string, opts?: object) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>
        } & ((text: string, opts?: object) => Promise<{ input_ids: { dims: number[] } } & Record<string, unknown>>)
        if (typeof call.tokenizer === 'function') {
          return call.tokenizer(prompt, { add_special_tokens: false })
        }
        return call(prompt, { add_special_tokens: false })
      },
      loadImage: (url) => tf.RawImage.fromURL(url),
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

function parseToolCalls(text: string): { query: string; quantity: number; unit: string | null }[] {
  const trimmed = text.trim()
  const blobs: string[] = []
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) blobs.push(fenced[1])
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) blobs.push(trimmed.slice(firstBrace, lastBrace + 1))
  blobs.push(trimmed)

  for (const blob of blobs) {
    try {
      const parsed = JSON.parse(blob) as {
        tools?: { name?: string; arguments?: { query?: string; quantity?: number; unit?: string } }[]
        query?: string
        foods?: { query?: string; name?: string; quantity?: number; unit?: string }[]
      }
      const fromTools = (parsed.tools ?? [])
        .filter((t) => (t.name ?? 'search_foods') === 'search_foods')
        .map((t) => ({
          query: String(t.arguments?.query ?? '').trim(),
          quantity: Number(t.arguments?.quantity) || 1,
          unit: t.arguments?.unit ? String(t.arguments.unit) : null,
        }))
      if (fromTools.length) return fromTools.filter((t) => t.query)
      if (parsed.foods?.length) {
        return parsed.foods
          .map((f) => ({
            query: String(f.query ?? f.name ?? '').trim(),
            quantity: Number(f.quantity) || 1,
            unit: f.unit ? String(f.unit) : null,
          }))
          .filter((t) => t.query)
      }
      if (parsed.query) {
        return [{ query: parsed.query, quantity: 1, unit: null }]
      }
    } catch {
      // try next blob
    }
  }
  return []
}

function itemsFromModelText(raw: string): ExtractedItem[] {
  const calls = parseToolCalls(raw)
  if (calls.length) {
    return calls.map((c) => ({
      raw,
      query: c.query,
      quantity: c.quantity,
      unit: c.unit,
    }))
  }
  return extractFoods(raw)
}

async function decodeGeneration(
  sess: Session,
  inputs: { input_ids: { dims: number[] } } & Record<string, unknown>,
): Promise<string> {
  const outputs = await sess.model.generate({
    ...inputs,
    max_new_tokens: 220,
    temperature: 0.1,
    repetition_penalty: 1.05,
  })
  const start = inputs.input_ids.dims.at(-1) ?? 0
  const decoded = sess.processor.batch_decode(
    (outputs as { slice: (a: null, range: [number | null, null]) => unknown }).slice(null, [start, null]),
    { skip_special_tokens: true },
  )[0]
  return String(decoded ?? '').trim()
}

export async function analyzeMealPhoto(image: Blob, onProgress?: ProgressFn): Promise<{ raw: string; items: ExtractedItem[] }> {
  const sess = await loadSession(onProgress)
  onProgress?.('Reading the photo…', 82)
  const url = URL.createObjectURL(image)
  try {
    const img = await sess.loadImage(url)
    const messages = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'image' },
          { type: 'text', text: PHOTO_USER },
        ],
      },
    ]
    const prompt = sess.processor.apply_chat_template(messages, { add_generation_prompt: true })
    const inputs = await sess.runProcessor(img, prompt)
    onProgress?.('Finding foods…', 88)
    const raw = await decodeGeneration(sess, inputs)
    onProgress?.('Matching the local database…', 94)
    return { raw, items: itemsFromModelText(raw) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function analyzeMealText(text: string, onProgress?: ProgressFn): Promise<{ raw: string; items: ExtractedItem[] }> {
  const sess = await loadSession(onProgress)
  onProgress?.('Reading your log…', 82)
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Log this meal using search_foods tool calls:\n${text}` },
  ]
  const prompt = sess.processor.apply_chat_template(messages, { add_generation_prompt: true })
  const inputs = await sess.runText(prompt)
  onProgress?.('Finding foods…', 88)
  const raw = await decodeGeneration(sess, inputs)
  onProgress?.('Matching the local database…', 94)
  const items = itemsFromModelText(raw)
  return { raw, items: items.length ? items : extractFoods(text) }
}
