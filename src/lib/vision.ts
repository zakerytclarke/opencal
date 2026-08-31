import { extractFoods } from './extract'

type ProgressFn = (message: string, pct?: number) => void

type Captioner = (image: Blob, onProgress?: ProgressFn) => Promise<string>

let captionerPromise: Promise<Captioner> | null = null

async function loadCaptioner(onProgress?: ProgressFn): Promise<Captioner> {
  onProgress?.('Loading on-device vision model…', 8)
  const tf = await import('@huggingface/transformers')
  onProgress?.('Preparing WebGPU…', 20)

  const device = (navigator as Navigator & { gpu?: unknown }).gpu ? 'webgpu' : 'wasm'
  const modelId = 'Xenova/vit-gpt2-image-captioning'

  const pipe = await tf.pipeline('image-to-text', modelId, {
    device,
    progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === 'progress' && info.progress != null) {
        onProgress?.(`Downloading ${info.file ?? 'model'}…`, 20 + Math.round(info.progress * 0.6))
      }
    },
  })

  onProgress?.('Vision model ready', 90)
  return async (image: Blob, progress?: ProgressFn) => {
    progress?.('Looking at the photo…', 40)
    const url = URL.createObjectURL(image)
    try {
      const out = await pipe(url)
      const first = Array.isArray(out) ? out[0] : out
      const text =
        (first as { generated_text?: string })?.generated_text ??
        (typeof first === 'string' ? first : '')
      return String(text)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function captionImage(image: Blob, onProgress?: ProgressFn): Promise<string> {
  if (!captionerPromise) captionerPromise = loadCaptioner(onProgress)
  const run = await captionerPromise
  return run(image, onProgress)
}

function foodsFromCaption(caption: string): string {
  let t = caption.toLowerCase()
  t = t.replace(/^(a |an |the )?(photo|picture|image|close[- ]up) of /i, '')
  t = t.replace(/\b(on a (plate|table|bowl|tray)|in a (bowl|plate|box)|sitting on .*)\b/g, '')
  t = t.replace(/\b(with|and)\b/g, ' and ')
  return t.replace(/\s+/g, ' ').trim()
}

export async function foodsFromImage(image: Blob, onProgress?: ProgressFn) {
  const caption = await captionImage(image, onProgress)
  onProgress?.('Matching foods in the local database…', 92)
  const cleaned = foodsFromCaption(caption)
  const items = extractFoods(cleaned || caption)
  return { caption, items }
}
