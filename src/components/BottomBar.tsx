type Props = {
  onVoice: () => void
  onSearch: () => void
  onPhoto: () => void
}

export function BottomBar({ onVoice, onSearch, onPhoto }: Props) {
  return (
    <nav className="dock" aria-label="Log food">
      <button type="button" className="dock-btn" onClick={onVoice} aria-label="Speak to log food">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span>Speak</span>
      </button>
      <button type="button" className="dock-search" onClick={onSearch} aria-label="Search foods">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="dock-btn" onClick={onPhoto} aria-label="Log food from a photo">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.6A1.5 1.5 0 0 1 10.9 4h2.2a1.5 1.5 0 0 1 1.2.6L15.5 6h2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span>Photo</span>
      </button>
    </nav>
  )
}
