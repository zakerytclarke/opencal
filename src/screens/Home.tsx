import { useState } from 'react'
import { BottomBar } from '../components/BottomBar'
import { CalendarSheet } from '../components/CalendarSheet'
import { DateNav } from '../components/DateNav'
import { FoodBatchCard } from '../components/FoodBatch'
import { LogJobCard } from '../components/LogJobCard'
import { SettingsSheet } from '../components/SettingsSheet'
import { VlmStatusBar } from '../components/VlmStatus'
import { NutritionCard } from '../components/NutritionCard'
import { groupBatches } from '../lib/batches'
import { loggedDays, totals } from '../lib/diary'
import { foodCount } from '../lib/foods'
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
  onResetOnboarding: () => void
  onDeleteLogs: () => void
  onDeleteAll: () => void
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
  onResetOnboarding,
  onDeleteLogs,
  onDeleteAll,
}: Props) {
  const [calendar, setCalendar] = useState(false)
  const [settings, setSettings] = useState(false)
  const entries = diary[date] ?? []
  const batches = groupBatches(entries)
  const t = totals(entries)
  const logged = loggedDays(diary)
  const dayJobs = jobs.filter((j) => j.date === date)

  return (
    <div className="home">
      <header className="home-head">
        <div className="eyebrow">OpenCal</div>
        <button type="button" className="icon-btn" onClick={() => setSettings(true)} aria-label="Settings">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M19.4 13a7.8 7.8 0 0 0 .1-2l1.8-1.4-1.8-3.2-2.2.6a8 8 0 0 0-1.7-1L15.2 4h-3.6l-.4 2.1a8 8 0 0 0-1.7 1l-2.2-.6-1.8 3.2L6.5 11a7.8 7.8 0 0 0 .1 2l-1.8 1.4 1.8 3.2 2.2-.6a8 8 0 0 0 1.7 1l.4 2.1h3.6l.4-2.1a8 8 0 0 0 1.7-1l2.2.6 1.8-3.2L19.4 13Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      <DateNav date={date} onDate={onDate} onOpenCalendar={() => setCalendar(true)} />

      <NutritionCard
        kcal={t.kcal}
        goal={profile.calorieGoal}
        carbs={t.carbs}
        carbsGoal={profile.carbsGoal}
        fat={t.fat}
        fatGoal={profile.fatGoal}
        protein={t.protein}
        proteinGoal={profile.proteinGoal}
      />

      <section className="card foods-card">
        <div className="foods-head">
          <h2>Foods</h2>
          <div className="foods-actions">
            <button type="button" className="text-btn" onClick={onSearch}>
              Add
            </button>
          </div>
        </div>
        {dayJobs.map((job) => (
          <LogJobCard key={job.id} job={job} />
        ))}
        {entries.length === 0 && dayJobs.length === 0 ? (
          <p className="empty">Nothing logged yet. Search, speak, or snap a photo.</p>
        ) : (
          batches.map((batch) => <FoodBatchCard key={batch.id} batch={batch} onDelete={onDelete} />)
        )}
      </section>

      <VlmStatusBar />
      <p className="db-note">{foodCount().toLocaleString()} foods on this device · USDA + compiled</p>
      <BottomBar onVoice={onVoice} onSearch={onSearch} onPhoto={onPhoto} />

      {calendar && <div className="backdrop" onClick={() => setCalendar(false)} />}
      {calendar && (
        <CalendarSheet
          key={date}
          date={date}
          logged={logged}
          onSelect={(key) => {
            onDate(key)
            setCalendar(false)
          }}
          onClose={() => setCalendar(false)}
        />
      )}

      {settings && <div className="backdrop" onClick={() => setSettings(false)} />}
      {settings && (
        <SettingsSheet
          profile={profile}
          onClose={() => setSettings(false)}
          onResetOnboarding={onResetOnboarding}
          onDeleteLogs={onDeleteLogs}
          onDeleteAll={onDeleteAll}
        />
      )}
    </div>
  )
}
