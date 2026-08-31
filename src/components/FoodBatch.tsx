import { FoodRow } from './FoodRow'
import type { FoodBatch as Batch } from '../lib/batches'

type Props = {
  batch: Batch
  onDelete: (id: string) => void
}

export function FoodBatchCard({ batch, onDelete }: Props) {
  return (
    <div className="food-batch">
      {batch.entries.map((entry) => (
        <FoodRow key={entry.id} entry={entry} onDelete={onDelete} />
      ))}
    </div>
  )
}
