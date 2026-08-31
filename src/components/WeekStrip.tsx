import { prettyDate, weekdayLabel } from '../lib/dates'

type Props = {
  keys: string[]
  selected: string
  logged: Set<string>
  onSelect: (key: string) => void
}

export function WeekStrip({ keys, selected, logged, onSelect }: Props) {
  return (
    <div className="week-strip" role="tablist" aria-label="This week">
      {keys.map((key) => {
        const isOn = key === selected
        const didLog = logged.has(key)
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isOn}
            className={`week-day${isOn ? ' is-on' : ''}${didLog ? ' is-logged' : ''}`}
            onClick={() => onSelect(key)}
            title={prettyDate(key)}
          >
            <span className="week-letter">{weekdayLabel(key)}</span>
            <span className="week-check" aria-hidden>
              {didLog ? (
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="8" fill="var(--under)" />
                  <path d="M4.4 8.2 6.7 10.4 11.6 5.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="week-empty">{Number(key.slice(-2))}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
