import { useMemo, useState } from 'react'
import { extractFoods, isQuickCalorie, looksLikeSentence } from '../lib/extract'
import { resolveExtracted, searchFoods, entryFromFood } from '../lib/foods'
import type { ExtractedItem, Food, LogEntry } from '../types'

type Props = {
  date: string
  initialQuery?: string
  listening?: boolean
  onClose: () => void
  onLog: (entries: LogEntry[]) => void
}

export function SearchSheet({ date, initialQuery = '', listening = false, onClose, onLog }: Props) {
  const [q, setQ] = useState(initialQuery)
  const [quick, setQuick] = useState('')
  const [preview, setPreview] = useState<LogEntry[] | null>(null)

  const results = useMemo(() => (q.trim().length < 2 || looksLikeSentence(q) ? [] : searchFoods(q, 24)), [q])
  const sentence = looksLikeSentence(q) || extractFoods(q).length > 1
  const quickCal = isQuickCalorie(q)

  function logFood(food: Food) {
    const item: ExtractedItem = { raw: q, query: food.name, quantity: 1, unit: null }
    onLog([entryFromFood(food, item, 'search', date)])
    onClose()
  }

  function runSentence() {
    const items = extractFoods(q)
    const resolved = resolveExtracted(items, date, 'sentence').map((r) => r.entry)
    setPreview(resolved)
  }

  function confirmPreview() {
    if (preview?.length) onLog(preview)
    onClose()
  }

  function doQuick(fromBar = false) {
    const n = Number(fromBar ? q.replace(/\D/g, '') : quick)
    if (!n) return
    onLog([
      {
        id: crypto.randomUUID(),
        date,
        foodId: 'quick',
        name: 'Quick add',
        emoji: '⚡',
        grams: 0,
        servings: 1,
        serveLabel: `${n} cal`,
        kcal: n,
        protein: 0,
        carbs: 0,
        fat: 0,
        source: 'quick',
        loggedAt: new Date().toISOString(),
      },
    ])
    onClose()
  }

  return (
    <div className="sheet" role="dialog" aria-label="Search foods">
      <div className="sheet-head">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Add food</h2>
        <span className="sheet-spacer" />
      </div>
      <div className="search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPreview(null)
          }}
          placeholder={listening ? 'Listening…' : 'Search or type “2 eggs and toast”'}
          autoFocus
        />
      </div>

      {preview ? (
        <div className="preview">
          <p className="lede">We’ll log these from your sentence.</p>
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
          <button type="button" className="primary" onClick={confirmPreview}>
            Log {preview.length} {preview.length === 1 ? 'item' : 'items'}
          </button>
        </div>
      ) : (
        <>
          <div className="quick-row">
            <input
              inputMode="numeric"
              placeholder="Quick add calories"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
            />
            <button type="button" className="ghost" onClick={() => doQuick(false)} disabled={!Number(quick)}>
              Add
            </button>
          </div>

          {(sentence || quickCal != null) && q.trim().length > 1 && (
            <button type="button" className="sentence-cta" onClick={quickCal != null ? () => doQuick(true) : runSentence}>
              {quickCal != null ? `Quick add ${quickCal} calories` : `Extract foods from “${q.trim()}”`}
            </button>
          )}

          <ul className="results">
            {results.map((food) => (
              <li key={food.id}>
                <button type="button" className="result" onClick={() => logFood(food)}>
                  <span className="food-emoji">{food.emoji}</span>
                  <span className="food-main">
                    <span className="food-name">{food.name}</span>
                    <span className="food-sub">
                      {food.serveLabel} · P {Math.round(food.protein * (food.serveG / 100))} · C{' '}
                      {Math.round(food.carbs * (food.serveG / 100))} · F {Math.round(food.fat * (food.serveG / 100))}
                    </span>
                  </span>
                  <span className="food-kcal">{Math.round(food.kcal * (food.serveG / 100))}</span>
                </button>
              </li>
            ))}
          </ul>
          {q.trim().length >= 2 && !results.length && !sentence && (
            <p className="empty">No matches. Try a simpler name, or quick-add calories.</p>
          )}
        </>
      )}
    </div>
  )
}
