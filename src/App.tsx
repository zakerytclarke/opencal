import { useEffect, useState } from 'react'
import { LogOverlay, type LogKind } from './components/LogOverlay'
import { addEntries, clearProfile, loadDiary, loadProfile, removeEntry, saveProfile } from './lib/storage'
import { loadFoods } from './lib/foods'
import { warmupVlm } from './lib/vlm'
import { todayKey } from './lib/dates'
import { speak } from './lib/speech'
import type { Diary, LogEntry, Profile } from './types'
import { Home } from './screens/Home'
import { Onboarding } from './screens/Onboarding'

export default function App() {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile())
  const [diary, setDiary] = useState<Diary>(() => loadDiary())
  const [date, setDate] = useState(todayKey())
  const [flow, setFlow] = useState<LogKind | null>(null)

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
    const names = entries.map((e) => e.name).slice(0, 3).join(', ')
    speak(`Logged ${names}. ${kcal} calories.`)
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
          onVoice={() => setFlow('voice')}
          onSearch={() => setFlow('search')}
          onPhoto={() => setFlow('photo')}
          onReset={reset}
        />
      )}

      {profile && flow && <div className="backdrop" onClick={() => setFlow(null)} />}
      {profile && flow && (
        <LogOverlay kind={flow} date={date} onClose={() => setFlow(null)} onLog={log} />
      )}
    </div>
  )
}
