import { useEffect, useRef, useState } from 'react'
import { extractFoods } from '../lib/extract'
import { resolveExtracted } from '../lib/foods'
import { getVlmStatus, subscribeVlm, warmupVlm } from '../lib/vlm'
import { foodsFromImage } from '../lib/vision'
import type { LogEntry } from '../types'

type Props = {
  date: string
  onClose: () => void
  onLog: (entries: LogEntry[]) => void
}

export function PhotoSheet({ date, onClose, onLog }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState('Snap a meal. The vision model runs on this device.')
  const [busy, setBusy] = useState(false)
  const [caption, setCaption] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [pct, setPct] = useState(0)
  const [vlm, setVlm] = useState(() => getVlmStatus())

  useEffect(() => {
    warmupVlm()
    return subscribeVlm(setVlm)
  }, [])

  async function onFile(file: File | undefined) {
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setBusy(true)
    setEntries([])
    setCaption('')
    setPct(4)
    try {
      const { caption: cap, items } = await foodsFromImage(file, (message, p) => {
        setStatus(message)
        if (p != null) setPct(p)
      })
      setCaption(cap)
      const resolved = resolveExtracted(items.length ? items : extractFoods(cap), date, 'photo').map((r) => r.entry)
      setEntries(resolved)
      setStatus(resolved.length ? 'Looks right? Log it.' : 'Could not match foods. Try search.')
      setPct(100)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Vision model failed to load. Try search instead.')
    } finally {
      setBusy(false)
    }
  }

  function confirm() {
    if (entries.length) onLog(entries)
    onClose()
  }

  return (
    <div className="sheet photo-sheet" role="dialog" aria-label="Photo log">
      <div className="sheet-head">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Photo</h2>
        <span className="sheet-spacer" />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button type="button" className="photo-stage" onClick={() => inputRef.current?.click()}>
        {previewUrl ? <img src={previewUrl} alt="Meal preview" /> : <span>Tap to take or upload a photo</span>}
      </button>
      {busy && (
        <div className="progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {!busy && vlm.state === 'downloading' && (
        <div className="progress" aria-valuenow={vlm.pct}>
          <i style={{ width: `${vlm.pct}%` }} />
        </div>
      )}
      <p className="lede">
        {busy
          ? status
          : vlm.state === 'ready'
            ? 'Snap a meal. Vision runs on this device and searches the food database.'
            : vlm.state === 'downloading'
              ? `Preparing photo logging… ${Math.round(vlm.pct)}%`
              : vlm.state === 'error'
                ? vlm.message
                : status}
      </p>
      {caption && <p className="caption">{caption}</p>}
      {entries.length > 0 && (
        <div className="preview">
          {entries.map((e) => (
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
          <button type="button" className="primary" onClick={confirm} disabled={busy}>
            Log {entries.length} {entries.length === 1 ? 'item' : 'items'}
          </button>
        </div>
      )}
    </div>
  )
}
