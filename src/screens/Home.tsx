import { BottomBar } from '../components/BottomBar'
import { CalorieRing } from '../components/CalorieRing'
import { FoodRow } from '../components/FoodRow'
import { MacroBars } from '../components/MacroBars'
import { WeekStrip } from '../components/WeekStrip'
import { totals } from '../lib/diary'
import { foodCount } from '../lib/foods'
import { prettyDate, weekKeys } from '../lib/dates'
import { kgToLb } from '../lib/plan'
import type { Diary, Profile } from '../types'

type Props = {
  profile: Profile
  diary: Diary
  date: string
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
  onDate,
  onDelete,
  onVoice,
  onSearch,
  onPhoto,
  onReset,
}: Props) {
  const entries = diary[date] ?? []
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
          <button type="button" className="text-btn" onClick={onSearch}>
            Add
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="empty">Nothing logged yet. Search, speak, or snap a photo.</p>
        ) : (
          entries.map((e) => <FoodRow key={e.id} entry={e} onDelete={onDelete} />)
        )}
      </section>

      <p className="db-note">{foodCount().toLocaleString()} foods on this device · USDA + compiled</p>
      <BottomBar onVoice={onVoice} onSearch={onSearch} onPhoto={onPhoto} />
    </div>
  )
}
