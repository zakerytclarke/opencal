import type { LogEntry } from '../types'

type Props = {
  entry: LogEntry
  onDelete: (id: string) => void
}

export function FoodRow({ entry, onDelete }: Props) {
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
          {' · '}P {Math.round(entry.protein)} · C {Math.round(entry.carbs)} · F {Math.round(entry.fat)}
        </div>
      </div>
      <div className="food-kcal">{Math.round(entry.kcal)}</div>
      <button type="button" className="food-del" aria-label={`Delete ${entry.name}`} onClick={() => onDelete(entry.id)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16M9 7V5h6v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
