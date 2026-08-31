import { useEffect, useState } from 'react'
import { addEntries, clearProfile, loadDiary, loadProfile, removeEntry, saveProfile } from './lib/storage'
import { loadFoods } from './lib/foods'
import { warmupVlm } from './lib/vlm'
import { todayKey } from './lib/dates'
import { speak } from './lib/speech'
import type { Diary, LogEntry, Profile } from './types'
import { Home } from './screens/Home'
import { Onboarding } from './screens/Onboarding'
import { PhotoSheet } from './screens/PhotoSheet'
import { SearchSheet } from './screens/SearchSheet'
import { VoiceSheet } from './screens/VoiceSheet'

type Sheet = 'none' | 'search' | 'voice' | 'photo'

export default function App() {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile())
  const [diary, setDiary] = useState<Diary>(() => loadDiary())
  const [date, setDate] = useState(todayKey())
  const [sheet, setSheet] = useState<Sheet>('none')
  const [searchSeed, setSearchSeed] = useState('')

  useEffect(() => {
    void loadFoods().finally(() => setReady(true))
    warmupVlm()
  }, [])

  function finishOnboarding(next: Profile) {
    saveProfile(next)
    setProfile(next)
  }

  function log(entries: LogEntry[]) {
    setDiary((d) => addEntries(d, date, entries))
    const kcal = entries.reduce((s, e) => s + e.kcal, 0)
    if (entries[0]?.source === 'search' || entries[0]?.source === 'sentence' || entries[0]?.source === 'quick') {
      speak(`Logged ${kcal} calories.`)
    }
  }

  function del(id: string) {
    setDiary((d) => removeEntry(d, date, id))
  }

  function reset() {
    if (!confirm('Start over and clear your plan? Food logs stay on this device.')) return
    clearProfile()
    setProfile(null)
  }

  if (!ready) {
    return (
      <div className="boot">
        <div className="brand">OpenCal</div>
        <p>Loading your local food database…</p>
      </div>
    )
  }

  return (
    <div className="app">
      {!profile ? (
        <Onboarding onDone={finishOnboarding} />
      ) : (
        <Home
          profile={profile}
          diary={diary}
          date={date}
          onDate={setDate}
          onDelete={del}
          onVoice={() => setSheet('voice')}
          onSearch={() => {
            setSearchSeed('')
            setSheet('search')
          }}
          onPhoto={() => setSheet('photo')}
          onReset={reset}
        />
      )}

      {profile && sheet !== 'none' && <div className="backdrop" onClick={() => setSheet('none')} />}

      {profile && sheet === 'search' && (
        <SearchSheet
          key={searchSeed || 'search'}
          date={date}
          initialQuery={searchSeed}
          onClose={() => setSheet('none')}
          onLog={log}
        />
      )}
      {profile && sheet === 'voice' && (
        <VoiceSheet
          date={date}
          onClose={() => setSheet('none')}
          onLog={log}
          onFallbackSearch={(text) => {
            setSearchSeed(text)
            setSheet('search')
          }}
        />
      )}
      {profile && sheet === 'photo' && (
        <PhotoSheet date={date} onClose={() => setSheet('none')} onLog={log} />
      )}
    </div>
  )
}
