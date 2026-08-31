import { useEffect, useState } from 'react'
import { getVlmStatus, subscribeVlm, type VlmStatus } from '../lib/vlm'

export function VlmStatusBar() {
  const [s, setS] = useState<VlmStatus>(() => getVlmStatus())
  useEffect(() => subscribeVlm(setS), [])
  if (s.state === 'idle' || s.state === 'ready') return null
  return (
    <div className={`vlm-bar${s.state === 'error' ? ' is-error' : ''}`}>
      <div className="vlm-bar-top">
        <span>{s.state === 'error' ? s.message : 'Preparing photo logging on this device…'}</span>
        {s.state === 'downloading' && <b>{Math.round(s.pct)}%</b>}
      </div>
      {s.state === 'downloading' && (
        <div className="progress">
          <i style={{ width: `${s.pct}%` }} />
        </div>
      )}
    </div>
  )
}
