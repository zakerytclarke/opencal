import { addDays, longDate, prettyDate } from '../lib/dates'

type Props = {
  date: string
  onDate: (key: string) => void
  onOpenCalendar: () => void
}

export function DateNav({ date, onDate, onOpenCalendar }: Props) {
  return (
    <div className="date-nav">
      <button type="button" className="date-arrow" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="date-nav-label" onClick={onOpenCalendar} aria-haspopup="dialog">
        <span className="date-nav-title">{prettyDate(date)}</span>
        <span className="date-nav-sub">{longDate(date)}</span>
      </button>
      <button type="button" className="date-arrow" aria-label="Next day" onClick={() => onDate(addDays(date, 1))}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
