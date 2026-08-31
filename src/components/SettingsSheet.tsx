import { USDA_DATASETS, USDA_DOCS, USDA_FDC, catalogCount, foodCount } from '../lib/foods'
import { kgToLb } from '../lib/plan'
import type { Profile } from '../types'

type Props = {
  profile: Profile
  onClose: () => void
  onResetOnboarding: () => void
  onDeleteLogs: () => void
  onDeleteAll: () => void
}

export function SettingsSheet({ profile, onClose, onResetOnboarding, onDeleteLogs, onDeleteAll }: Props) {
  const weight =
    profile.units === 'imperial'
      ? `${Math.round(kgToLb(profile.weightKg))} lb`
      : `${Math.round(profile.weightKg)} kg`
  const sex = profile.sex === 'male' ? 'Male' : 'Female'

  function resetPlan() {
    if (!confirm('Redo onboarding and set a new plan? Food logs stay on this device.')) return
    onResetOnboarding()
  }

  function deleteLogs() {
    if (!confirm('Delete every food log on this device? Your plan stays.')) return
    onDeleteLogs()
    onClose()
  }

  function deleteAll() {
    if (!confirm('Delete your plan and every food log? This cannot be undone.')) return
    onDeleteAll()
  }

  return (
    <div className="sheet settings-sheet" role="dialog" aria-label="Settings">
      <div className="sheet-head">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Settings</h2>
        <span className="sheet-spacer" />
      </div>

      <section className="settings-card">
        <div className="micro">Your plan</div>
        <p className="settings-lead">
          {sex} · {profile.age} · {weight}
        </p>
        <p className="settings-goal">
          <b>{profile.calorieGoal.toLocaleString()}</b> cal/day
          <span>
            P {profile.proteinGoal} · C {profile.carbsGoal} · F {profile.fatGoal}
          </span>
        </p>
      </section>

      <ul className="settings-list">
        <li>
          <button type="button" className="settings-row" onClick={resetPlan}>
            <span>
              <b>Reset onboarding</b>
              <small>Redo your plan. Food logs stay.</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row" onClick={deleteLogs}>
            <span>
              <b>Delete food logs</b>
              <small>Clear every logged day on this device.</small>
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="settings-row is-danger" onClick={deleteAll}>
            <span>
              <b>Delete all data</b>
              <small>Plan and logs. This cannot be undone.</small>
            </span>
          </button>
        </li>
      </ul>

      <section className="settings-card">
        <div className="micro">Nutrition data</div>
        <p className="settings-lead">Calories come from USDA FoodData Central, stored on this device.</p>
        <ul className="source-links">
          <li>
            <a href={USDA_FDC} target="_blank" rel="noopener noreferrer">
              USDA FoodData Central
            </a>
          </li>
          <li>
            <a href={`${USDA_FDC}food-search?type=Survey%20(FNDDS)`} target="_blank" rel="noopener noreferrer">
              FNDDS survey foods
            </a>
          </li>
          <li>
            <a href={`${USDA_FDC}food-search?type=Foundation`} target="_blank" rel="noopener noreferrer">
              Foundation Foods
            </a>
          </li>
          <li>
            <a href={`${USDA_FDC}food-search?type=SR%20Legacy`} target="_blank" rel="noopener noreferrer">
              SR Legacy
            </a>
          </li>
          <li>
            <a href={`${USDA_FDC}food-search?type=Branded`} target="_blank" rel="noopener noreferrer">
              Branded Foods
            </a>
          </li>
          <li>
            <a href={USDA_DATASETS} target="_blank" rel="noopener noreferrer">
              Download the USDA datasets
            </a>
          </li>
          <li>
            <a href={USDA_DOCS} target="_blank" rel="noopener noreferrer">
              Data documentation
            </a>
          </li>
        </ul>
        <p className="settings-cite">
          Search shows everyday names and household servings. Voice and photo matching can also use the full USDA
          reference set, including lab and garnish rows. A few restaurant items use typical published values. Each logged
          food has an info link to its USDA record when one exists.
        </p>
      </section>

      <p className="db-note settings-note">
        {catalogCount().toLocaleString()} search foods · {foodCount().toLocaleString()} on this device
      </p>
    </div>
  )
}
