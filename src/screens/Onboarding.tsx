import { useMemo, useState } from 'react'
import { VlmStatusBar } from '../components/VlmStatus'
import { buildGoals, ftInToCm, goalDate, kgToLb, lbToKg, weeksToGoal } from '../lib/plan'
import type { Activity, Profile, Sex, Units } from '../types'

const PACES_LB = [0.5, 1, 1.5, 2] as const

const ACTIVITY: { id: Activity; label: string; hint: string }[] = [
  { id: 'sedentary', label: 'Sedentary', hint: 'Desk job, little exercise' },
  { id: 'light', label: 'Lightly active', hint: '1–3 workouts a week' },
  { id: 'moderate', label: 'Active', hint: '3–5 workouts a week' },
  { id: 'active', label: 'Very active', hint: '6–7 workouts a week' },
  { id: 'very', label: 'Extra active', hint: 'Physical job + training' },
]

type Draft = {
  units: Units
  sex: Sex
  age: string
  ft: string
  inch: string
  heightCm: string
  weight: string
  goal: string
  paceLb: number
  activity: Activity
}

const initial: Draft = {
  units: 'imperial',
  sex: 'female',
  age: '28',
  ft: '5',
  inch: '6',
  heightCm: '168',
  weight: '160',
  goal: '145',
  paceLb: 1,
  activity: 'light',
}

function num(s: string): number {
  return Number(String(s).replace(/[^\d.]/g, '')) || 0
}

export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft>(initial)

  const weightKg = draft.units === 'imperial' ? lbToKg(num(draft.weight)) : num(draft.weight)
  const goalKg = draft.units === 'imperial' ? lbToKg(num(draft.goal)) : num(draft.goal)
  const heightCm = draft.units === 'imperial' ? ftInToCm(num(draft.ft), num(draft.inch)) : num(draft.heightCm)
  const weeklyKg = (goalKg < weightKg ? 1 : goalKg > weightKg ? -1 : 0) * (draft.paceLb * 0.45359237)

  const preview = useMemo(
    () =>
      buildGoals({
        sex: draft.sex,
        age: num(draft.age) || 28,
        heightCm: heightCm || 168,
        weightKg: weightKg || 72,
        goalWeightKg: goalKg || 66,
        weeklyKg,
        activity: draft.activity,
        units: draft.units,
      }),
    [draft, heightCm, weightKg, goalKg, weeklyKg],
  )

  const weeks = weeksToGoal(preview.weightKg, preview.goalWeightKg, preview.weeklyKg)
  const eta = goalDate(weeks)
  const losing = preview.goalWeightKg < preview.weightKg - 0.2
  const gaining = preview.goalWeightKg > preview.weightKg + 0.2

  function next() {
    if (step < 5) setStep(step + 1)
    else onDone(preview)
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  return (
    <div className="onboard">
      <div className="onboard-top">
        <div className="brand">OpenCal</div>
        {step > 0 ? (
          <button type="button" className="text-btn" onClick={back}>
            Back
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="dots" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
        ))}
      </div>

      {step === 0 && (
        <section className="onboard-card">
          <h1>Let’s personalize your plan</h1>
          <p className="lede">
            A few quick questions — weight, goal, and how fast you want to get there. Everything stays on this device.
          </p>
          <div className="seg" role="group" aria-label="Units">
            <button type="button" className={draft.units === 'imperial' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, units: 'imperial' })}>
              lb / ft
            </button>
            <button type="button" className={draft.units === 'metric' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, units: 'metric' })}>
              kg / cm
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="onboard-card">
          <h1>About you</h1>
          <p className="lede">Used to estimate your daily calorie budget.</p>
          <div className="seg">
            <button type="button" className={draft.sex === 'female' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, sex: 'female' })}>
              Female
            </button>
            <button type="button" className={draft.sex === 'male' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, sex: 'male' })}>
              Male
            </button>
          </div>
          <label className="field">
            <span>Age</span>
            <input inputMode="numeric" value={draft.age} onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
          </label>
          {draft.units === 'imperial' ? (
            <div className="row-2">
              <label className="field">
                <span>Height (ft)</span>
                <input inputMode="numeric" value={draft.ft} onChange={(e) => setDraft({ ...draft, ft: e.target.value })} />
              </label>
              <label className="field">
                <span>Inches</span>
                <input inputMode="numeric" value={draft.inch} onChange={(e) => setDraft({ ...draft, inch: e.target.value })} />
              </label>
            </div>
          ) : (
            <label className="field">
              <span>Height (cm)</span>
              <input inputMode="numeric" value={draft.heightCm} onChange={(e) => setDraft({ ...draft, heightCm: e.target.value })} />
            </label>
          )}
          <p className="micro">Activity</p>
          <div className="choice-list">
            {ACTIVITY.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`choice${draft.activity === a.id ? ' is-on' : ''}`}
                onClick={() => setDraft({ ...draft, activity: a.id })}
              >
                <b>{a.label}</b>
                <span>{a.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="onboard-card">
          <h1>Current weight</h1>
          <p className="lede">You can update this any time from home.</p>
          <label className="field hero-field">
            <span>{draft.units === 'imperial' ? 'Pounds' : 'Kilograms'}</span>
            <input inputMode="decimal" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} autoFocus />
          </label>
        </section>
      )}

      {step === 3 && (
        <section className="onboard-card">
          <h1>Goal weight</h1>
          <p className="lede">We’ll estimate a target date from your pace.</p>
          <label className="field hero-field">
            <span>{draft.units === 'imperial' ? 'Pounds' : 'Kilograms'}</span>
            <input inputMode="decimal" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} autoFocus />
          </label>
        </section>
      )}

      {step === 4 && (
        <section className="onboard-card">
          <h1>{gaining ? 'How quickly do you want to gain?' : losing ? 'How quickly do you want to lose?' : 'Maintain your weight'}</h1>
          <p className="lede">
            {losing || gaining
              ? '1 lb per week is the usual recommended pace.'
              : 'You can still log food and keep your calories at maintenance.'}
          </p>
          {(losing || gaining) && (
            <div className="choice-list">
              {PACES_LB.map((p) => {
                const labels: Record<number, string> = {
                  0.5: 'Slow & easy',
                  1: 'Recommended',
                  1.5: 'Challenging',
                  2: 'Aggressive',
                }
                return (
                  <button
                    key={p}
                    type="button"
                    className={`choice${draft.paceLb === p ? ' is-on' : ''}`}
                    onClick={() => setDraft({ ...draft, paceLb: p })}
                  >
                    <b>
                      {p} lb / week
                      {draft.units === 'metric' ? ` (${(p * 0.45).toFixed(2)} kg)` : ''}
                    </b>
                    <span>{labels[p]}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {step === 5 && (
        <section className="onboard-card">
          <h1>Your daily goal</h1>
          <p className="lede">
            {losing
              ? `Lose ${draft.units === 'imperial' ? `${Math.round(kgToLb(weightKg - goalKg))} lb` : `${Math.round(weightKg - goalKg)} kg`}${eta ? ` by ${eta}` : ''}.`
              : gaining
                ? `Gain toward your goal${eta ? ` by ${eta}` : ''}.`
                : 'Stay at maintenance.'}
          </p>
          <div className="goal-hero">{preview.calorieGoal.toLocaleString()}</div>
          <div className="goal-sub">calories a day</div>
          <div className="goal-macros">
            <span>
              <b>{preview.carbsGoal}g</b> carbs
            </span>
            <span>
              <b>{preview.fatGoal}g</b> fat
            </span>
            <span>
              <b>{preview.proteinGoal}g</b> protein
            </span>
          </div>
        </section>
      )}

      <button type="button" className="primary" onClick={next}>
        {step === 0 ? 'Get started' : step === 5 ? 'Go to Today' : 'Continue'}
      </button>
      <VlmStatusBar />
    </div>
  )
}
