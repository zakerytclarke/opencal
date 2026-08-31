import { useState } from 'react'
import {
  addMonths,
  monthGrid,
  monthLabel,
  sameMonth,
  todayKey,
  weekdayLabel,
} from '../lib/dates'

type Props = {
  date: string
  logged: Set<string>
  onSelect: (key: string) => void
  onClose: () => void
}

function Check() {
  return (
    <svg className="cal-check" width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M4.2 8.2 6.7 10.5 11.8 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CalendarSheet({ date, logged, onSelect, onClose }: Props) {
  const [month, setMonth] = useState(date)
  const today = todayKey()
  const cells = monthGrid(month)
  const headers = monthGrid(month).slice(0, 7)

  return (
    <div className="sheet cal-sheet" role="dialog" aria-label="Choose a date">
      <div className="sheet-head">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Calendar</h2>
        <span className="sheet-spacer" />
      </div>

      <div className="cal-month-row">
        <button type="button" className="date-arrow" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="cal-month-label">{monthLabel(month)}</div>
        <button type="button" className="date-arrow" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="cal-grid" role="grid" aria-label={monthLabel(month)}>
        {headers.map((key) => (
          <div key={`h-${key}`} className="cal-dow" aria-hidden>
            {weekdayLabel(key)}
          </div>
        ))}
        {cells.map((key) => {
          const inMonth = sameMonth(key, month)
          const isOn = key === date
          const isToday = key === today
          const didLog = logged.has(key)
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={isOn}
              aria-current={isToday ? 'date' : undefined}
              className={`cal-day${inMonth ? '' : ' is-out'}${isOn ? ' is-on' : ''}${isToday ? ' is-today' : ''}${didLog ? ' is-logged' : ''}`}
              onClick={() => onSelect(key)}
            >
              <span className="cal-num">{Number(key.slice(-2))}</span>
              {didLog ? <Check /> : <span className="cal-dot" aria-hidden />}
            </button>
          )
        })}
      </div>

      {date !== today && (
        <button type="button" className="ghost cal-today" onClick={() => onSelect(today)}>
          Jump to today
        </button>
      )}
    </div>
  )
}
