import { useEffect, useRef, useState } from 'react'
import { isQuickCalorie } from '../lib/extract'
import { canListen, listen, type SpeechHandle } from '../lib/speech'
import { warmupVlm } from '../lib/vlm'

export type LogKind = 'search' | 'voice' | 'photo'

export type QueuePayload =
  | { kind: 'text'; text: string; source: 'search' | 'voice' }
  | { kind: 'photo'; file: File }

type Props = {
  kind: LogKind
  onClose: () => void
  onQueue: (payload: QueuePayload) => void
  onQuick?: (kcal: number, raw: string) => void
}

export function LogOverlay({ kind, onClose, onQueue, onQuick }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const rec = useRef<SpeechHandle | null>(null)
  const [query, setQuery] = useState('')
  const voiceOk = kind !== 'voice' || canListen()
  const [phase, setPhase] = useState<'compose' | 'listening' | 'error'>(() => {
    if (kind === 'voice') return voiceOk ? 'listening' : 'error'
    return 'compose'
  })
  const [error, setError] = useState(voiceOk ? '' : 'Voice is not available in this browser.')

  useEffect(() => {
    warmupVlm()
    if (kind === 'photo') {
      const t = window.setTimeout(() => fileRef.current?.click(), 80)
      return () => window.clearTimeout(t)
    }
    if (kind === 'voice') {
      if (!canListen()) return
      rec.current = listen({
        onPartial: (text) => setQuery(text),
        onFinal: (text) => {
          rec.current = null
          submitText(text, 'voice')
        },
        onError: (message) => {
          setPhase('error')
          setError(message)
        },
      })
      return () => rec.current?.stop()
    }
    return undefined
  }, [kind])

  function submitText(text: string, source: 'search' | 'voice') {
    const trimmed = text.trim()
    if (!trimmed) return
    const quick = isQuickCalorie(trimmed)
    if (quick != null && onQuick) {
      onQuick(quick, trimmed)
      onClose()
      return
    }
    onQueue({ kind: 'text', text: trimmed, source })
    onClose()
  }

  return (
    <div className="log-overlay" role="dialog" aria-label="Log food">
      <button type="button" className="text-btn log-close" onClick={onClose}>
        Close
      </button>

      {kind === 'photo' && (
        <div className="log-media">
          <span>Take or choose a photo</span>
        </div>
      )}

      {kind === 'voice' && (
        <div className={`mic-orb${phase === 'listening' ? ' is-live' : ''}`} aria-hidden>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {kind === 'search' && (
        <form
          className="log-compose"
          onSubmit={(e) => {
            e.preventDefault()
            submitText(query, 'search')
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="2 eggs and a banana"
            autoFocus
          />
          <button type="submit" className="primary" disabled={!query.trim()}>
            Log
          </button>
        </form>
      )}

      {kind !== 'search' && <p className="log-copy">{error || query || (kind === 'voice' ? 'Listening…' : 'Opening camera…')}</p>}

      <p className="log-sub">
        {phase === 'error'
          ? 'Try again or type it'
          : kind === 'voice'
            ? 'Speak your meal'
            : 'Logs in the background · keep adding'}
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) {
            onClose()
            return
          }
          onQueue({ kind: 'photo', file })
          onClose()
        }}
      />
    </div>
  )
}
