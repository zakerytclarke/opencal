import { FoodRow } from './FoodRow'
import { pathLabel, type FoodBatch as Batch } from '../lib/batches'

type Props = {
  batch: Batch
  debug: boolean
  onDelete: (id: string) => void
}

export function FoodBatchCard({ batch, debug, onDelete }: Props) {
  return (
    <div className="food-batch">
      {debug && (
        <div className="debug-block">
          <div className="debug-meta">
            <span className={`debug-pill is-${batch.path ?? 'unknown'}`}>{pathLabel(batch.path)}</span>
            <span>{batch.source}</span>
            {batch.ms != null && <span>{batch.ms} ms</span>}
          </div>
          {batch.input && (
            <p className="debug-input">
              <b>In</b> {batch.input}
            </p>
          )}
          <pre className="debug-raw">{batch.raw || '(no transcript)'}</pre>
          {batch.error && <p className="debug-error">{batch.error}</p>}
        </div>
      )}
      {batch.entries.map((entry) => (
        <FoodRow key={entry.id} entry={entry} onDelete={onDelete} />
      ))}
    </div>
  )
}
