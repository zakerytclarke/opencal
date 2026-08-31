import { useEffect, useRef, useState } from 'react'
import { logFromPhoto, logFromText } from '../lib/pipeline'
import { canListen, listen, type SpeechHandle } from '../lib/speech'
import { getVlmStatus, subscribeVlm, warmupVlm } from '../lib/vlm'
import type { LogEntry } from '../types'

export type LogKind = 'search' | 'voice' | 'photo'

type Props = {
  kind: LogKind
  date: string
  onClose: () => void
  onLog: (entries: LogEntry[]) => void
}

export function LogOverlay({ kind, date, onClose, onLog }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const rec = useRef<SpeechHandle | null>(null)
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const voiceOk = kind !== 'voice' || canListen()
  const [phase, setPhase] = useState<'compose' | 'listening' | 'working' | 'error'>(() => {
    if (kind === 'voice') return voiceOk ? 'listening' : 'error'
    if (kind === 'photo') return 'working'
    return 'compose'
  })
  const [status, setStatus] = useState(
    kind === 'voice' ? 'Listening…' : kind === 'photo' ? 'Opening camera…' : 'What did you eat?',
  )
  const [pct, setPct] = useState(kind === 'search' ? 0 : 8)
  const [error, setError] = useState(voiceOk ? '' : 'Voice is not available in this browser.')
  const [vlmPct, setVlmPct] = useState(() => getVlmStatus().pct)

  useEffect(() => subscribeVlm((s) => setVlmPct(s.pct)), [])

  useEffect(() => {
    warmupVlm()
    if (kind === 'photo') {
      const t = window.setTimeout(() => fileRef.current?.click(), 80)
      return () => clearTimeout(t)
    }
    if (kind === 'voice') {
      if (!canListen()) return
      rec.current = listen({
        onPartial: (text) => {
          setQuery(text)
          setStatus(text)
        },
        onFinal: (text) => {
          rec.current = null
          setQuery(text)
          void runText(text, 'voice')
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

  async function runText(text: string, source: 'search' | 'voice') {
    const trimmed = text.trim()
    if (!trimmed) return
    setPhase('working')
    setPct(12)
    setStatus(trimmed)
    try {
      const entries = await logFromText(trimmed, date, source, (message, p) => {
        setStatus(message)
        if (p != null) setPct(p)
      })
      finish(entries)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Could not log that.')
    }
  }

  async function runPhoto(file: File) {
    if (preview) URL.revokeObjectURL(preview)
    const url = URL.createObjectURL(file)
    setPreview(url)
    setPhase('working')
    setPct(12)
    setStatus('Looking at your photo…')
    try {
      const entries = await logFromPhoto(file, date, (message, p) => {
        setStatus(message)
        if (p != null) setPct(p)
      })
      finish(entries)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Could not read that photo.')
    }
  }

  function finish(entries: LogEntry[]) {
    if (!entries.length) {
      setPhase('error')
      setError('Nothing to log. Try again.')
      return
    }
    setPct(100)
    onLog(entries)
    onClose()
  }

  const bar = phase === 'working' ? Math.max(pct, getVlmStatus().state === 'downloading' ? vlmPct * 0.7 : pct) : pct

  return (
    <div className="log-overlay" role="dialog" aria-label="Log food">
      <button type="button" className="text-btn log-close" onClick={onClose}>
        Close
      </button>

      {kind === 'photo' && (
        <div className="log-media">
          {preview ? <img src={preview} alt="Meal" /> : <span>Take or choose a photo</span>}
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

      {kind === 'search' && phase === 'compose' && (
        <form
          className="log-compose"
          onSubmit={(e) => {
            e.preventDefault()
            void runText(query, 'search')
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

      {(kind !== 'search' || phase !== 'compose') && (
        <p className="log-copy">{error || query || status}</p>
      )}

      {(phase === 'working' || (kind === 'voice' && phase === 'listening')) && (
        <div className="progress log-progress" aria-valuenow={bar}>
          <i style={{ width: `${phase === 'listening' ? 18 : bar}%` }} />
        </div>
      )}

      <p className="log-sub">
        {phase === 'working'
          ? status
          : phase === 'listening'
            ? 'Speak your meal'
            : phase === 'error'
              ? 'Try again or type it'
              : 'On-device model · logs straight to Today'}
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
          void runPhoto(file)
        }}
      />
    </div>
  )
}
