import { useEffect, useRef, useState } from 'react'
import { extractFoods } from '../lib/extract'
import { resolveExtracted } from '../lib/foods'
import { canListen, listen, speak, type SpeechHandle } from '../lib/speech'
import type { LogEntry } from '../types'

type Props = {
  date: string
  onClose: () => void
  onLog: (entries: LogEntry[]) => void
  onFallbackSearch: (text: string) => void
}

export function VoiceSheet({ date, onClose, onLog, onFallbackSearch }: Props) {
  const [status, setStatus] = useState(canListen() ? 'Listening…' : 'Voice is not available here')
  const [partial, setPartial] = useState('')
  const [finalText, setFinalText] = useState('')
  const [preview, setPreview] = useState<LogEntry[]>([])
  const handle = useRef<SpeechHandle | null>(null)

  useEffect(() => {
    if (!canListen()) return
    handle.current = listen({
      onPartial: setPartial,
      onFinal: (text) => {
        setFinalText(text)
        setPartial('')
        setStatus('Matching foods…')
        const items = extractFoods(text)
        const resolved = resolveExtracted(items, date, 'voice').map((r) => r.entry)
        setPreview(resolved)
        setStatus(resolved.length ? 'Confirm to log' : 'Nothing to log')
      },
      onError: (m) => setStatus(m),
    })
    return () => handle.current?.stop()
  }, [date])

  function confirm() {
    if (!preview.length) return
    onLog(preview)
    const cals = preview.reduce((s, e) => s + e.kcal, 0)
    speak(`Logged ${preview.map((e) => e.name).join(', ')}. ${cals} calories.`)
    onClose()
  }

  return (
    <div className="sheet voice-sheet" role="dialog" aria-label="Voice log">
      <div className="sheet-head">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Speak</h2>
        <span className="sheet-spacer" />
      </div>
      <div className={`mic-orb${preview.length ? '' : ' is-live'}`} aria-hidden>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
      <p className="lede center">{status}</p>
      <p className="voice-text">{finalText || partial || '“I had two eggs and a banana”'}</p>
      {preview.length > 0 && (
        <div className="preview">
          {preview.map((e) => (
            <div key={e.id} className="preview-row">
              <span>{e.emoji}</span>
              <div>
                <b>{e.name}</b>
                <small>
                  {e.serveLabel} · {e.kcal} cal
                </small>
              </div>
            </div>
          ))}
          <button type="button" className="primary" onClick={confirm}>
            Log {preview.length} {preview.length === 1 ? 'item' : 'items'}
          </button>
        </div>
      )}
      {!canListen() && (
        <button type="button" className="ghost" onClick={() => onFallbackSearch('')}>
          Type it instead
        </button>
      )}
    </div>
  )
}
