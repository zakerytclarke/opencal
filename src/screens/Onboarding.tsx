import { useMemo, useState } from 'react'
import {
  UNTOUCHED,
  applyOnboardingSuggestions,
  bmiOf,
  buildGoals,
  convertOnboardingUnits,
  draftGoalKg,
  draftHeightCm,
  draftWeightKg,
  goalDate,
  initialOnboardingDraft,
  kgToLb,
  parseDraftNumber,
  type OnboardingDraft,
  type OnboardingTouched,
  weeksToGoal,
} from '../lib/plan'
import type { Activity, Profile } from '../types'

const PACES_LB = [0.5, 1, 1.5, 2] as const

const ACTIVITY: { id: Activity; label: string; hint: string }[] = [
  { id: 'sedentary', label: 'Sedentary', hint: 'Desk job, little exercise' },
  { id: 'light', label: 'Lightly active', hint: '1–3 workouts a week' },
  { id: 'moderate', label: 'Active', hint: '3–5 workouts a week' },
  { id: 'active', label: 'Very active', hint: '6–7 workouts a week' },
  { id: 'very', label: 'Extra active', hint: 'Physical job + training' },
]

function Logo() {
  return (
    <svg className="splash-logo" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#3b8fdf" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#fff" strokeWidth="5" />
      <circle cx="32" cy="32" r="6" fill="#19c37d" />
    </svg>
  )
}

export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [{ draft, touched }, setOnboard] = useState(() => ({
    draft: initialOnboardingDraft(),
    touched: { ...UNTOUCHED },
  }))

  function patch(next: Partial<OnboardingDraft>, touch?: Partial<OnboardingTouched>) {
    setOnboard((s) => {
      const touched = { ...s.touched, ...touch }
      return { touched, draft: applyOnboardingSuggestions({ ...s.draft, ...next }, touched) }
    })
  }

  const weightKg = draftWeightKg(draft)
  const goalKg = draftGoalKg(draft)
  const heightCm = draftHeightCm(draft)
  const weeklyKg = (goalKg < weightKg ? 1 : goalKg > weightKg ? -1 : 0) * (draft.paceLb * 0.45359237)

  const preview = useMemo(
    () =>
      buildGoals({
        sex: draft.sex,
        age: parseDraftNumber(draft.age) || 28,
        heightCm: heightCm || 163,
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
  const goalBmi = bmiOf(goalKg, heightCm)
  const currentBmi = bmiOf(weightKg, heightCm)

  function next() {
    if (step < 5) setStep(step + 1)
    else onDone(preview)
  }

  function back() {
    if (step > 0) setStep(step - 1)
  }

  return (
    <div className={`onboard${step === 0 ? ' is-splash' : ''}`}>
      {step > 0 && (
        <>
          <div className="onboard-top">
            <div className="brand">OpenCal</div>
            <button type="button" className="text-btn" onClick={back}>
              Back
            </button>
          </div>
          <div className="dots" aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
            ))}
          </div>
        </>
      )}

      {step === 0 && (
        <section className="onboard-card splash-card">
          <Logo />
          <h1 className="splash-brand">OpenCal</h1>
          <p className="splash-lede">
            Open-source calorie tracking, science-backed and locally powered. Nutrition comes from USDA data and
            Mifflin–St Jeor calorie math. Photo, voice, and text logging run on a private AI model on this device —
            your meals never leave it.
          </p>
        </section>
      )}

      {step === 1 && (
        <section className="onboard-card">
          <h1>About you</h1>
          <p className="lede">We’ll estimate a healthy weight and calorie budget from this. Edit anything that’s off.</p>
          <div className="seg" role="group" aria-label="Units">
            <button
              type="button"
              className={draft.units === 'imperial' ? 'is-on' : ''}
              onClick={() => setOnboard((s) => ({ ...s, draft: convertOnboardingUnits(s.draft, 'imperial') }))}
            >
              lb / ft
            </button>
            <button
              type="button"
              className={draft.units === 'metric' ? 'is-on' : ''}
              onClick={() => setOnboard((s) => ({ ...s, draft: convertOnboardingUnits(s.draft, 'metric') }))}
            >
              kg / cm
            </button>
          </div>
          <div className="seg">
            <button type="button" className={draft.sex === 'female' ? 'is-on' : ''} onClick={() => patch({ sex: 'female' })}>
              Female
            </button>
            <button type="button" className={draft.sex === 'male' ? 'is-on' : ''} onClick={() => patch({ sex: 'male' })}>
              Male
            </button>
          </div>
          <label className="field">
            <span>Age</span>
            <input inputMode="numeric" value={draft.age} onChange={(e) => patch({ age: e.target.value })} />
          </label>
          {draft.units === 'imperial' ? (
            <div className="row-2">
              <label className="field">
                <span>Height (ft)</span>
                <input
                  inputMode="numeric"
                  value={draft.ft}
                  onChange={(e) => patch({ ft: e.target.value }, { height: true })}
                />
              </label>
              <label className="field">
                <span>Inches</span>
                <input
                  inputMode="numeric"
                  value={draft.inch}
                  onChange={(e) => patch({ inch: e.target.value }, { height: true })}
                />
              </label>
            </div>
          ) : (
            <label className="field">
              <span>Height (cm)</span>
              <input
                inputMode="numeric"
                value={draft.heightCm}
                onChange={(e) => patch({ heightCm: e.target.value }, { height: true })}
              />
            </label>
          )}
          <p className="micro">Activity</p>
          <div className="choice-list">
            {ACTIVITY.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`choice${draft.activity === a.id ? ' is-on' : ''}`}
                onClick={() => patch({ activity: a.id })}
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
          <p className="lede">
            {touched.weight
              ? 'You can update this any time from home.'
              : `Starting estimate for a ${draft.sex === 'male' ? 'man' : 'woman'} your height${
                  currentBmi ? ` (BMI ${currentBmi.toFixed(1)})` : ''
                }. Change it if it’s off.`}
          </p>
          <label className="field hero-field">
            <span>{draft.units === 'imperial' ? 'Pounds' : 'Kilograms'}</span>
            <input
              inputMode="decimal"
              value={draft.weight}
              onChange={(e) => patch({ weight: e.target.value }, { weight: true })}
              autoFocus
            />
          </label>
        </section>
      )}

      {step === 3 && (
        <section className="onboard-card">
          <h1>Goal weight</h1>
          <p className="lede">
            {touched.goal
              ? 'We’ll estimate a target date from your pace.'
              : gaining
                ? `A healthy BMI for your height is about 20. That’s ${draft.goal}${draft.units === 'imperial' ? ' lb' : ' kg'}.`
                : losing
                  ? `A healthy BMI for your height is 22. That’s ${draft.goal}${draft.units === 'imperial' ? ' lb' : ' kg'}${
                      goalBmi ? ` (BMI ${goalBmi.toFixed(1)})` : ''
                    }.`
                  : 'You’re already in a healthy BMI range, so this matches your current weight.'}
          </p>
          <label className="field hero-field">
            <span>{draft.units === 'imperial' ? 'Pounds' : 'Kilograms'}</span>
            <input
              inputMode="decimal"
              value={draft.goal}
              onChange={(e) => patch({ goal: e.target.value }, { goal: true })}
              autoFocus
            />
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
                    onClick={() => patch({ paceLb: p }, { pace: true })}
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
        {step === 0 ? 'Let’s get started' : step === 5 ? 'Go to Today' : 'Continue'}
      </button>
    </div>
  )
}
