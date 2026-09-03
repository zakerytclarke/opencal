// Verify the FINE-TUNED fine-tuned weights, loaded through the SAME library the
// app uses (@huggingface/transformers), running the app's EXACT production photo
// prompt (vlmParse.EXTRACT_* + formatChatPrompt) and parse (parsePhotoExtraction).
//
// This box's headless WebGPU can't run the fp16 browser path, so we load the SAME
// shipped bundle (fp16 set) on CPU via ORT — a faithful library+bundle+prompt check.
import { AutoProcessor, AutoModelForImageTextToText, RawImage } from '@huggingface/transformers'
import { EXTRACT_SYSTEM, EXTRACT_USER_TAIL, formatChatPrompt, parsePhotoExtraction } from '../src/lib/vlmParse'

// Use the SHIPPED bundle so this verifies exactly what the browser receives.
export const BUNDLE_PROCESSOR = '/home/zclarke/Documents/OpenCal/public/models/lfm25vl-opencal'
export const BUNDLE_MODEL = BUNDLE_PROCESSOR

export const MAX_NEW_TOKENS = 512 // the production bump (220->512); mirror it here
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a)

log('loading processor from', BUNDLE_PROCESSOR)
const processor = await AutoProcessor.from_pretrained(BUNDLE_PROCESSOR)
const imageProc = processor.image_processor as { do_image_splitting?: boolean } | undefined
if (imageProc) imageProc.do_image_splitting = false

log('loading fine-tuned model (cpu, fp16)...')
const model = await AutoModelForImageTextToText.from_pretrained(BUNDLE_MODEL, {
  device: 'cpu',
  dtype: { embed_tokens: 'fp16', decoder_model_merged: 'fp16', vision_encoder: 'fp16' },
})
log('model loaded; generating...')

async function textExtract(text: string) {
  const userText = `${text}\n${EXTRACT_USER_TAIL}`
  const prompt = formatChatPrompt(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: userText },
    ],
    true,
    '[',
  )
  const inputs = await processor.tokenizer(prompt, { add_special_tokens: false })
  const prefill = inputs.input_ids.dims.at(-1) ?? 0
  const out = await model.generate({ ...inputs, max_new_tokens: MAX_NEW_TOKENS, do_sample: false, repetition_penalty: 1.05 })
  const raw = String(processor.batch_decode(out.slice(null, [prefill, null]), { skip_special_tokens: false })[0] ?? '').trim()
  const labeled = /^(?:\[|\{)/.test(raw) ? raw : `[${raw}`
  return { raw, items: parsePhotoExtraction(labeled).items }
}

async function photoExtract(path: string) {
  const img = await RawImage.read(path)
  const userText = EXTRACT_USER_TAIL
  const prompt = formatChatPrompt(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: [{ type: 'image' }, { type: 'text', text: userText }] },
    ],
    true,
    '[',
  )
  const inputs = await (processor as unknown as (i: unknown, p: string, o: object) => Promise<any>)(img, prompt, { add_special_tokens: false })
  const prefill = inputs.input_ids.dims.at(-1) ?? 0
  const out = await model.generate({ ...inputs, max_new_tokens: MAX_NEW_TOKENS, do_sample: false, repetition_penalty: 1.05 })
  const raw = String(processor.batch_decode(out.slice(null, [prefill, null]), { skip_special_tokens: false })[0] ?? '').trim()
  const labeled = /^(?:\[|\{)/.test(raw) ? raw : `[${raw}`
  return { raw, items: parsePhotoExtraction(labeled).items }
}

// --- text case (mirrors e2e text case) ---
const t = await textExtract('2 eggs and a banana')
log('TEXT  raw=', t.raw)
log('TEXT  items=', JSON.stringify(t.items))

// --- photo case (mirrors e2e banana.jpg) ---
const fixtures = ['/home/zclarke/Documents/OpenCal/public/test-fixtures/banana.jpg']
for (const p of fixtures) {
  const ph = await photoExtract(p)
  log('PHOTO', p.split('/').pop(), 'raw=', ph.raw)
  log('PHOTO items=', JSON.stringify(ph.items))
}

const failed = !(t.items?.length) || !(await photoExtract(fixtures[0])).items?.length
log(failed ? 'RESULT: DEGRADED (empty items)' : 'RESULT: OK — fine-tuned bundle loads via transformers.js and produces valid flat-array items')
process.exit(failed ? 1 : 0)
