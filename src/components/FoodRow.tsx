import { foodSourceLabel, foodSourceUrl } from '../lib/foods'
import type { LogEntry } from '../types'

type Props = {
  entry: LogEntry
  onDelete: (id: string) => void
}

export function FoodRow({ entry, onDelete }: Props) {
  const hasUsda = Boolean(entry.foodId && entry.foodId !== 'quick' && entry.foodId !== 'unmatched')
  const sourceUrl = hasUsda ? foodSourceUrl(entry.foodId, entry.name) : null
  const sourceLabel = hasUsda ? foodSourceLabel(entry.foodId) : null

  return (
    <div className="food-row">
      <div className="food-emoji" aria-hidden>
        {entry.emoji}
      </div>
      <div className="food-main">
        <div className="food-name">{entry.name}</div>
        <div className="food-sub">
          {entry.brand ? `${entry.brand} · ` : ''}
          {entry.serveLabel}
          {' · '}Protein {Math.round(entry.protein)} · Carbs {Math.round(entry.carbs)} · Fat {Math.round(entry.fat)}
        </div>
      </div>
      <div className="food-kcal">{Math.round(entry.kcal)}</div>
      {sourceUrl && (
        <a
          className="food-src"
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${sourceLabel} source for ${entry.name}`}
          title={`${sourceLabel} · USDA FoodData Central`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 11v5.5M12 8h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </a>
      )}
      <button type="button" className="food-del" aria-label={`Delete ${entry.name}`} onClick={() => onDelete(entry.id)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16M9 7V5h6v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
