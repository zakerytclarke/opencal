type Props = {
  goal: number
  consumed: number
  display: number
  label: string
  size?: number
  stroke?: number
}

function ringColor(ratio: number): string {
  if (ratio <= 0.6) return 'var(--under)'
  if (ratio <= 0.95) return 'var(--lake)'
  if (ratio <= 1) return 'var(--approaching)'
  return 'var(--over)'
}

export function CalorieRing({ goal, consumed, display, label, size = 148, stroke = 12 }: Props) {
  const ratio = consumed / Math.max(goal, 1)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = Math.min(1, Math.max(0, ratio)) * c
  const color = ringColor(ratio)

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">
        <div className="ring-number">{Math.round(display).toLocaleString()}</div>
        <div className="ring-label">{label}</div>
      </div>
    </div>
  )
}
