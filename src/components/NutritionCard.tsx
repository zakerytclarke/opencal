import { useState } from 'react'
import { CalorieRing } from './CalorieRing'

type Props = {
  kcal: number
  goal: number
  carbs: number
  carbsGoal: number
  fat: number
  fatGoal: number
  protein: number
  proteinGoal: number
}

function VBar({
  letter,
  value,
  goal,
  tone,
}: {
  letter: string
  value: number
  goal: number
  tone: 'carbs' | 'fat' | 'protein'
}) {
  const pct = Math.min(100, (value / Math.max(goal, 1)) * 100)
  return (
    <div className="vbar">
      <div className="vbar-track" title={`${letter} ${Math.round(value)} / ${goal}g`}>
        <div className={`vbar-fill is-${tone}`} style={{ height: `${pct}%` }} />
      </div>
      <span className={`vbar-letter is-${tone}`}>{letter}</span>
      <span className="vbar-g">{Math.round(value)}</span>
    </div>
  )
}

export function NutritionCard(props: Props) {
  const [view, setView] = useState<'remaining' | 'eaten'>('remaining')
  const remaining = props.goal - props.kcal

  return (
    <section className="card calorie-card">
      <button
        type="button"
        className="calorie-hero"
        onClick={() => setView((v) => (v === 'remaining' ? 'eaten' : 'remaining'))}
        aria-label={view === 'remaining' ? 'Show calories eaten' : 'Show calories remaining'}
      >
        <CalorieRing
          goal={props.goal}
          consumed={props.kcal}
          display={view === 'remaining' ? Math.round(Math.abs(remaining)) : Math.round(props.kcal)}
          label={view === 'remaining' ? (remaining >= 0 ? 'Remaining' : 'Over') : 'Eaten'}
        />
        <div className="ring-meta">
          <span className="stat">
            <b>{Math.round(props.kcal).toLocaleString()}</b>
            {' / '}
            {props.goal.toLocaleString()}
          </span>
        </div>
      </button>
      <div className="vbars" aria-label="Macros">
        <VBar letter="Carbs" value={props.carbs} goal={props.carbsGoal} tone="carbs" />
        <VBar letter="Fat" value={props.fat} goal={props.fatGoal} tone="fat" />
        <VBar letter="Protein" value={props.protein} goal={props.proteinGoal} tone="protein" />
      </div>
    </section>
  )
}
