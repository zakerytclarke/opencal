import { FoodRow } from './FoodRow'
import type { FoodBatch as Batch } from '../lib/batches'

type Props = {
  batch: Batch
  onDelete: (id: string) => void
  onDeleteBatch?: (id: string) => void
}

export function FoodBatchCard({ batch, onDelete, onDeleteBatch }: Props) {
  const canDeleteBatch = batch.entries.length > 1 && onDeleteBatch != null
  return (
    <div className={`food-batch${batch.mealName ? ' has-meal' : ''}`}>
      {batch.mealName && (
        <div className="food-batch-head">
          <span className="food-batch-name">{batch.mealName}</span>
          <span className="food-batch-count">{batch.entries.length} items</span>
          {canDeleteBatch && (
            <button
              type="button"
              className="food-batch-del"
              aria-label={`Delete meal ${batch.mealName}`}
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
      )}
      {batch.entries.map((entry) => (
        <FoodRow key={entry.id} entry={entry} onDelete={onDelete} />
      ))}
    </div>
  )
}
