import { useEffect, useMemo, useRef, useState } from 'react'
import { extractFoods, isQuickCalorie, looksLikeSentence } from '../lib/extract'
import { filterRecents, recentLoggedFoods } from '../lib/diary'
import { entryFromFood, foodSourceLabel, foodSourceUrl, repeatEntry, searchFoods } from '../lib/foods'
import { canListen, listen, type SpeechHandle } from '../lib/speech'
import { warmupVlm } from '../lib/vlm'
import type { Diary, ExtractedItem, Food, LogEntry } from '../types'

export type LogKind = 'search' | 'voice' | 'photo'

export type QueuePayload =
  | { kind: 'text'; text: string; source: 'search' | 'voice' }
  | { kind: 'photo'; file: File }

type Props = {
  kind: LogKind
  date: string
  diary: Diary
  onClose: () => void
  onQueue: (payload: QueuePayload) => void
  onQuick?: (kcal: number, raw: string) => void
  onInstant?: (entry: LogEntry) => void
}

function SuggestRow({
  emoji,
  name,
  sub,
  kcal,
  badge,
  sourceId,
  onClick,
}: {
  emoji: string
  name: string
  sub: string
  kcal: number
  badge?: string
  sourceId?: string
  onClick: () => void
}) {
  const sourceUrl = sourceId ? foodSourceUrl(sourceId, name) : null
  const sourceLabel = sourceId ? foodSourceLabel(sourceId) : null
  return (
    <div className="result suggest-row">
      <button type="button" className="suggest-pick" onClick={onClick}>
        <span className="food-emoji" aria-hidden>
          {emoji}
        </span>
        <span className="food-main">
          <span className="food-name">{name}</span>
          <span className="food-sub">
            {badge ? `${badge} · ` : ''}
            {sub}
          </span>
        </span>
        <span className="food-kcal">{Math.round(kcal)}</span>
        <span className="suggest-add">Add</span>
      </button>
      {sourceUrl && (
        <a
          className="food-src"
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${sourceLabel} source for ${name}`}
          title={`${sourceLabel} · USDA FoodData Central`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 11v5.5M12 8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </a>
      )}
    </div>
  )
}

export function LogOverlay({ kind, date, diary, onClose, onQueue, onQuick, onInstant }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const rec = useRef<SpeechHandle | null>(null)
  const [query, setQuery] = useState('')
  const voiceOk = kind !== 'voice' || canListen()
  const [phase, setPhase] = useState<'compose' | 'listening' | 'error'>(() => {
    if (kind === 'voice') return voiceOk ? 'listening' : 'error'
    return 'compose'
  })
  const [error, setError] = useState(voiceOk ? '' : 'Voice is not available in this browser.')

  const recents = useMemo(() => recentLoggedFoods(diary, 12), [diary])
  const recentHits = useMemo(() => filterRecents(recents, query).slice(0, 6), [recents, query])
  const dbHits = useMemo(() => {
    const q = query.trim()
    if (q.length < 2 || looksLikeSentence(q) || isQuickCalorie(q) != null) return []
    const recentIds = new Set(recentHits.map((e) => e.foodId))
    return searchFoods(q, 8, 'search').filter((food) => !recentIds.has(food.id))
  }, [query, recentHits])
  const quickCal = isQuickCalorie(query)

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

  function pickRecent(entry: LogEntry) {
    onInstant?.(repeatEntry(entry, date))
    onClose()
  }

  function pickMatch(food: Food) {
    const parsed = extractFoods(query)[0]
    const item: ExtractedItem = {
      raw: query,
      query: parsed?.query || query.trim() || food.name,
      brand: parsed?.brand ?? null,
      quantity: parsed?.quantity ?? 1,
      unit: parsed?.unit ?? null,
    }
    onInstant?.(entryFromFood(food, item, 'search', date))
    onClose()
  }

  const showSuggest = kind === 'search' && (recentHits.length > 0 || dbHits.length > 0 || quickCal != null)

  const suggest = showSuggest ? (
    <div className="log-suggest">
      {quickCal != null && (
        <SuggestRow
          emoji="⚡"
          name={`Quick add ${quickCal}`}
          sub="Calories only"
          kcal={quickCal}
          onClick={() => {
            onQuick?.(quickCal, query)
            onClose()
          }}
        />
      )}
      {recentHits.length > 0 && (
        <>
          <div className="suggest-label">{query.trim() ? 'From your log' : 'Recently logged'}</div>
          {recentHits.map((entry) => (
            <SuggestRow
              key={entry.id}
              emoji={entry.emoji}
              name={entry.name}
              sub={`${entry.brand ? `${entry.brand} · ` : ''}${entry.serveLabel}`}
              kcal={entry.kcal}
              badge="Logged"
              sourceId={entry.foodId !== 'quick' && entry.foodId !== 'unmatched' ? entry.foodId : undefined}
              onClick={() => pickRecent(entry)}
            />
          ))}
        </>
      )}
      {dbHits.length > 0 && (
        <>
          <div className="suggest-label">Best matches</div>
          {dbHits.map((food) => (
            <SuggestRow
              key={food.id}
              emoji={food.emoji}
              name={food.name}
              sub={food.serveLabel}
              kcal={Math.round(food.kcal * (food.serveG / 100))}
              sourceId={food.id}
              onClick={() => pickMatch(food)}
            />
          ))}
        </>
      )}
    </div>
  ) : null

  return (
    <div className={`log-overlay${kind === 'search' ? ' is-search' : ''}`} role="dialog" aria-label="Log food">
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
        <div className="log-search">
          {suggest}
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
              {quickCal != null ? `Quick add ${quickCal}` : 'Log'}
            </button>
          </form>
        </div>
      )}

      {kind !== 'search' && <p className="log-copy">{error || query || (kind === 'voice' ? 'Listening…' : 'Opening camera…')}</p>}

      <p className="log-sub">
        {phase === 'error'
          ? 'Try again or type it'
          : kind === 'voice'
            ? 'Speak your meal'
            : kind === 'search'
              ? 'Tap a food to add it, or log a full meal'
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
