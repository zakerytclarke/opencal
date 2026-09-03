import { FoodRow } from './FoodRow'
import { sourceLabel, type FoodBatch as Batch } from '../lib/batches'

type Props = {
  batch: Batch
  onDelete: (id: string) => void
  onDeleteBatch?: (id: string) => void
  busy?: boolean
}

export function FoodBatchCard({ batch, onDelete, onDeleteBatch, busy }: Props) {
  const name = batch.mealName ?? sourceLabel(batch.source)
  const canDeleteBatch = batch.entries.length >= 2 && onDeleteBatch != null
  return (
    <div className={`food-batch${batch.entries.length > 1 ? ' has-meal' : ''}${busy ? ' is-live' : ''}`} aria-busy={busy || undefined}>
      <div className="food-batch-head">
        {busy && <span className={`food-batch-spin${batch.entries.length > 1 ? '' : ' is-lead'}`} aria-hidden />}
        <span className="food-batch-name">{name}</span>
        <span className="food-batch-count">{batch.entries.length} {batch.entries.length === 1 ? 'item' : 'items'}</span>
        {canDeleteBatch && (
          <button
            type="button"
            className="food-batch-del"
            aria-label={`Delete ${name}`}
            onClick={() => onDeleteBatch!(batch.id)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M9 7V5h6v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      {batch.entries.map((entry) => (
        <FoodRow key={entry.id} entry={entry} onDelete={onDelete} />
      ))}
    </div>
  )
}
