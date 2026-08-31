import { useState } from 'react'
import { BottomBar } from '../components/BottomBar'
import { FoodBatchCard } from '../components/FoodBatch'
import { LogJobCard } from '../components/LogJobCard'
import { VlmStatusBar } from '../components/VlmStatus'
import { CalorieRing } from '../components/CalorieRing'
import { MacroBars } from '../components/MacroBars'
import { WeekStrip } from '../components/WeekStrip'
import { groupBatches } from '../lib/batches'
import { totals } from '../lib/diary'
import { foodCount } from '../lib/foods'
import { prettyDate, weekKeys } from '../lib/dates'
import { kgToLb } from '../lib/plan'
import type { Diary, LogJob, Profile } from '../types'

type Props = {
  profile: Profile
  diary: Diary
  date: string
  jobs: LogJob[]
  onDate: (key: string) => void
  onDelete: (id: string) => void
  onVoice: () => void
  onSearch: () => void
  onPhoto: () => void
  onReset: () => void
}

export function Home({
  profile,
  diary,
  date,
  jobs,
  onDate,
  onDelete,
  onVoice,
  onSearch,
  onPhoto,
  onReset,
}: Props) {
  const [debug, setDebug] = useState(true)
  const entries = diary[date] ?? []
  const batches = groupBatches(entries)
  const t = totals(entries)
  const keys = weekKeys(date)
  const logged = new Set(keys.filter((k) => (diary[k] ?? []).length > 0))
  const weightLabel =
    profile.units === 'imperial'
      ? `${Math.round(kgToLb(profile.weightKg))} lb`
      : `${Math.round(profile.weightKg)} kg`

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <div className="eyebrow">OpenCal</div>
          <h1>{prettyDate(date)}</h1>
        </div>
        <button type="button" className="avatar" onClick={onReset} title="Reset plan" aria-label="Profile">
          {profile.sex === 'male' ? 'M' : 'F'}
        </button>
      </header>

      <WeekStrip keys={keys} selected={date} logged={logged} onSelect={onDate} />

      <section className="card calorie-card">
        <CalorieRing goal={profile.calorieGoal} consumed={t.kcal} />
        <div className="calorie-side">
          <div className="stat">
            <b>{Math.round(t.kcal).toLocaleString()}</b>
            <span>Eaten</span>
          </div>
          <div className="stat">
            <b>{profile.calorieGoal.toLocaleString()}</b>
            <span>Goal</span>
          </div>
          <div className="stat">
            <b>{weightLabel}</b>
            <span>Weight</span>
          </div>
        </div>
      </section>

      <section className="card">
        <MacroBars
          carbs={t.carbs}
          carbsGoal={profile.carbsGoal}
          fat={t.fat}
          fatGoal={profile.fatGoal}
          protein={t.protein}
          proteinGoal={profile.proteinGoal}
        />
      </section>

      <section className="card foods-card">
        <div className="foods-head">
          <h2>Foods</h2>
          <div className="foods-actions">
            <button type="button" className={`text-btn${debug ? ' is-on' : ''}`} onClick={() => setDebug((v) => !v)}>
              Debug {debug ? 'on' : 'off'}
            </button>
            <button type="button" className="text-btn" onClick={onSearch}>
              Add
            </button>
          </div>
        </div>
        {jobs.filter((j) => j.date === date).map((job) => (
          <LogJobCard key={job.id} job={job} />
        ))}
        {entries.length === 0 && jobs.length === 0 ? (
          <p className="empty">Nothing logged yet. Search, speak, or snap a photo.</p>
        ) : (
          batches.map((batch) => <FoodBatchCard key={batch.id} batch={batch} debug={debug} onDelete={onDelete} />)
        )}
      </section>

      <VlmStatusBar />
      <p className="db-note">{foodCount().toLocaleString()} foods on this device · USDA + compiled</p>
      <BottomBar onVoice={onVoice} onSearch={onSearch} onPhoto={onPhoto} />
    </div>
  )
}
