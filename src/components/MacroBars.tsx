type Props = {
  carbs: number
  carbsGoal: number
  fat: number
  fatGoal: number
  protein: number
  proteinGoal: number
}

function Bar({
  label,
  value,
  goal,
  tone,
}: {
  label: string
  value: number
  goal: number
  tone: 'carbs' | 'fat' | 'protein'
}) {
  const pct = Math.min(100, (value / Math.max(goal, 1)) * 100)
  return (
    <div className="macro">
      <div className="macro-top">
        <span className="macro-label">{label}</span>
        <span className="macro-nums">
          {Math.round(value)} / {goal}g
        </span>
      </div>
      <div className="macro-track">
        <div className={`macro-fill is-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function MacroBars(props: Props) {
  return (
    <div className="macros">
      <Bar label="Carbs" value={props.carbs} goal={props.carbsGoal} tone="carbs" />
      <Bar label="Fat" value={props.fat} goal={props.fatGoal} tone="fat" />
      <Bar label="Protein" value={props.protein} goal={props.proteinGoal} tone="protein" />
    </div>
  )
}
