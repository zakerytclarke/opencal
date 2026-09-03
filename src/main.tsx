import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// Print a build tag first so debugging can identify which commit/timestamp is running.
console.log(`[OpenCal] build=${import.meta.env.VITE_OPC_BUILD ?? 'n/a'}`)

// Reflect the auto-incrementing version (1.0.<commit count>, see vite.config.ts) in the tab title.
const opcVersion = import.meta.env.VITE_OPC_VERSION
if (opcVersion) document.title = `OpenCal v${opcVersion}`

// ---- DEBUG: trace every model-file fetch so a "not valid JSON" error is traceable to the
// exact URL, HTTP status, and the first bytes returned (HTML would show right here). ----
if (import.meta.env.VITE_OPC_BUILD && typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch.bind(globalThis)
  const isModelFile = (u: string) =>
    /huggingface\.co|\/models\/|\.onnx(\.data)?|config\.json|processor|preprocessor|tokenizer/.test(u)
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : 'url' in input
            ? String(input.url)
            : String(input)
    const interesting = isModelFile(url)
    const t0 = Date.now()
    let res: Response
    if (interesting) console.log(`[fetch] → ${input instanceof Request ? 'REPLAY' : 'GET'} ${url}`)
    try {
      res = await realFetch(input, init)
    } catch (e) {
      if (interesting) console.error(`[fetch] ✗ ${url} threw ${String(e)}`)
      throw e
    }
    if (interesting) {
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      const len = res.headers.get('content-length') ?? ''
      // Only peek the first bytes for small text/json payloads. Never clone-read
      // the multi-hundred-MB .onnx / .onnx_data shards — that would buffer the
      // whole file just to log 40 chars. (JSON configs are the things that
      // historically surfaced "not valid JSON" as HTML, so those are the ones
      // worth peeking.)
      const peekable = /json|text/.test(ct) || (ct === '' && res.status >= 400)
      let peek = ''
      if (peekable) {
        peek = (await res.clone().text().catch(() => '')).slice(0, 40).replace(/\n/g, ' ')
      }
      console.log(
        `[fetch] ${res.status} ${res.ok ? '✓' : '✗'} ${url}  type=${ct}  ${len}b${peek ? `  "${peek}"` : ''}  ${Date.now() - t0}ms`,
      )
      if (!res.ok || (peek !== '' && peek.trimStart().startsWith('<'))) {
        console.error(
          `[fetch] ⚠ non-JSON/failed → ${url} — ${ct ? `type=${ct}` : 'no type'}${peek ? `  body="${peek}"` : ''}`,
        )
      }
    }
    return res
  }) as typeof fetch
}
// ---- end DEBUG ----

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
