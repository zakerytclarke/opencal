import type { LogJob, PendingFood } from '../types'

type Props = {
  job: LogJob
}

function PendingRow({ item }: { item: PendingFood }) {
  const label = [item.quantity !== 1 ? item.quantity : null, item.unit, item.query].filter(Boolean).join(' ')
  return (
    <div className="food-row is-pending" aria-busy="true">
      <div className="food-emoji" aria-hidden>
        <span className="spinner" />
      </div>
      <div className="food-main">
        <div className="food-name">{label}</div>
        <div className="food-sub">{item.brand ? `${item.brand} · ` : ''}Finding nutrition…</div>
      </div>
    </div>
  )
}

export function LogJobCard({ job }: Props) {
  const open = job.pending.filter((item) => item.status !== 'done')
  const extracting = (job.status === 'extracting' || job.status === 'queued') && open.length === 0
  if (job.status === 'done' && open.length === 0) return null
  if (job.status === 'error' && open.length === 0) {
    return (
      <div className="food-row is-pending">
        {job.previewUrl && (
          <div className="job-photo">
            <img src={job.previewUrl} alt="Meal photo" />
          </div>
        )}
        <div className="food-emoji" aria-hidden>
          ⚠️
        </div>
        <div className="food-main">
          <div className="food-name">{job.input}</div>
          <div className="food-sub">{job.error || 'Could not log that.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="food-batch is-live" aria-live="polite">
      {job.previewUrl && (
        <div className="job-photo">
          <img src={job.previewUrl} alt="Meal photo" />
        </div>
      )}
      {extracting && (
        <PendingRow
          item={{
            id: `${job.id}-input`,
            query: job.input,
            quantity: 1,
            unit: null,
            status: 'matching',
          }}
        />
      )}
      {open.map((item) => (
        <PendingRow key={item.id} item={item} />
      ))}
    </div>
  )
}
