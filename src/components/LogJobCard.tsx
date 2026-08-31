import type { LogJob } from '../types'

type Props = {
  job: LogJob
}

export function LogJobCard({ job }: Props) {
  return (
    <div className="log-job" aria-live="polite">
      <div className="log-job-input">{job.input}</div>
      {job.previewUrl && (
        <div className="log-job-thumb">
          <img src={job.previewUrl} alt="" />
        </div>
      )}
      {job.pending.length > 0 && (
        <ul className="log-job-items">
          {job.pending.filter((item) => item.status !== 'done').map((item) => (
            <li key={item.id} className={`log-job-item is-${item.status}`}>
              <span className="log-job-dot" aria-hidden />
              <span>
                {[item.quantity !== 1 ? item.quantity : null, item.unit, item.query].filter(Boolean).join(' ')}
                {item.brand ? ` · ${item.brand}` : ''}
              </span>
              <b>{item.status === 'matching' ? 'Matching…' : item.status === 'done' ? 'In' : 'Waiting'}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="progress log-job-progress" aria-valuenow={job.pct}>
        <i style={{ width: `${job.pct}%` }} />
      </div>
      <p className="log-job-step">{job.error || job.step}</p>
    </div>
  )
}
