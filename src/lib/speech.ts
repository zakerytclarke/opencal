export type SpeechHandle = {
  stop: () => void
}

type RecCtor = new () => {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canListen(): boolean {
  return recognitionCtor() != null
}

export function listen(opts: {
  onPartial?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (message: string) => void
}): SpeechHandle {
  const Ctor = recognitionCtor()
  if (!Ctor) {
    opts.onError?.('Voice input is not available in this browser.')
    return { stop() {} }
  }
  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (ev) => {
    let finalText = ''
    let partial = ''
    for (let i = 0; i < ev.results.length; i++) {
      const row = ev.results[i]
      const t = row[0].transcript
      if (row.isFinal) finalText += t
      else partial += t
    }
    if (partial) opts.onPartial?.(partial)
    if (finalText.trim()) opts.onFinal(finalText.trim())
  }
  rec.onerror = (ev) => {
    if (ev.error === 'no-speech') opts.onError?.('No speech heard. Try again.')
    else if (ev.error !== 'aborted') opts.onError?.(ev.error)
  }
  rec.onend = () => {}
  rec.start()
  return { stop: () => rec.stop() }
}
