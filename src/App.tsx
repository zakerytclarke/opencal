import { useEffect, useState } from 'react'
import { LogOverlay, type LogKind, type QueuePayload } from './components/LogOverlay'
import { addEntries, clearAllData, clearDiary, clearProfile, loadDiary, loadProfile, removeBatch, removeEntry, saveProfile, uid } from './lib/storage'
import { loadFoods, quickAddEntry } from './lib/foods'
import { cropToSquare } from './lib/crop'
import { logFromPhoto, logFromText } from './lib/pipeline'
import { subscribeVlm, warmupVlm } from './lib/vlm'
import { todayKey } from './lib/dates'
import type { Diary, ExtractedItem, LogEntry, LogJob, PendingFood, Profile } from './types'
import { Home } from './screens/Home'
import { Onboarding } from './screens/Onboarding'

function pendingFrom(items: { query: string; brand?: string | null; quantity: number; unit: string | null }[]): PendingFood[] {
  return items.map((item) => ({
    id: uid(),
    query: item.query,
    brand: item.brand,
    quantity: item.quantity,
    unit: item.unit,
    status: 'waiting',
  }))
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile())
  const [diary, setDiary] = useState<Diary>(() => loadDiary())
  const [date, setDate] = useState(todayKey())
  const [flow, setFlow] = useState<LogKind | null>(null)
  const [jobs, setJobs] = useState<LogJob[]>([])

  useEffect(() => {
    void loadFoods().finally(() => setReady(true))
    warmupVlm()
    return subscribeVlm((s) => {
      if (s.state !== 'downloading') return
      const message = `${s.message || 'Preparing the food model…'}`
      setJobs((list) =>
        list.map((j) =>
          j.status === 'extracting' || j.status === 'matching'
            ? { ...j, step: message, pct: Math.max(j.pct, Math.round(s.pct * 0.22)) }
            : j,
        ),
      )
    })
  }, [])

  function finishOnboarding(next: Profile) {
    saveProfile(next)
    setProfile(next)
  }

  function patchJob(id: string, patch: Partial<LogJob> | ((job: LogJob) => LogJob)) {
    setJobs((list) =>
      list.map((job) => {
        if (job.id !== id) return job
        return typeof patch === 'function' ? patch(job) : { ...job, ...patch }
      }),
    )
  }

  function addLogged(entries: Parameters<typeof addEntries>[2]) {
    if (!entries.length) return
    setDiary((d) => addEntries(d, date, entries))
  }

  function queuePayload(payload: QueuePayload) {
    const id = uid()
    const job: LogJob = {
      id,
      date,
      source: payload.kind === 'photo' ? 'photo' : payload.source,
      input: payload.kind === 'photo' ? 'Photo' : payload.text,
      previewUrl: payload.kind === 'photo' ? URL.createObjectURL(payload.file) : undefined,
      status: 'extracting',
      step: payload.kind === 'photo' ? 'Reading the photo…' : 'Finding foods…',
      pct: 6,
      pending: [],
    }
    setJobs((list) => [job, ...list])

    const handlers = {
      onProgress: ({ message, pct }: { message: string; pct: number }) => {
        patchJob(id, (j) => ({
          ...j,
          step: message,
          pct,
          status: message.startsWith('Matching') ? 'matching' : j.status,
          pending: message.startsWith('Matching')
            ? j.pending.map((p) =>
                p.status === 'done'
                  ? p
                  : message.includes(p.query)
                    ? { ...p, status: 'matching' as const }
                    : p.status === 'matching'
                      ? { ...p, status: 'waiting' as const }
                      : p,
              )
            : j.pending,
        }))
      },
      onExtracted: (items: ExtractedItem[]) => {
        patchJob(id, {
          status: 'matching',
          pending: pendingFrom(items),
          step: items.length ? `Found ${items.length} food${items.length === 1 ? '' : 's'}` : 'No foods found',
          pct: 28,
        })
      },
      onEntry: (entry: LogEntry, item: ExtractedItem, index: number) => {
        addLogged([entry])
        patchJob(id, (j) => ({
          ...j,
          pending: j.pending.map((p, i) => (i === index ? { ...p, status: 'done' as const } : p)),
          step: item.query ? `Logged ${item.query}` : j.step,
        }))
      },
    }

    void (async () => {
      try {
        if (payload.kind === 'photo') {
          patchJob(id, (j) => ({ ...j, step: 'Cropping the photo…', pct: 12 }))
          const square = await cropToSquare(payload.file)
          await logFromPhoto(square, date, handlers)
        } else {
          await logFromText(payload.text, date, payload.source, handlers)
        }
        patchJob(id, { status: 'done', step: 'Done', pct: 100, pending: [] })
        window.setTimeout(() => {
          setJobs((list) => {
            const gone = list.find((j) => j.id === id)
            if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
            return list.filter((j) => j.id !== id)
          })
        }, 900)
      } catch (err) {
        patchJob(id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Could not log that.',
          step: 'Could not log that.',
        })
      }
    })()
  }

  function quickLog(kcal: number, raw: string) {
    const entry = { ...quickAddEntry(kcal, date), debugInput: raw, debugRaw: '(quick add — model skipped)', debugPath: 'quick' as const }
    addLogged([entry])
  }

  function del(id: string) {
    setDiary((d) => removeEntry(d, date, id))
  }

  function delBatch(batchId: string) {
    setDiary((d) => removeBatch(d, date, batchId))
  }

  function instantLog(entry: LogEntry) {
    addLogged([entry])
  }

  function resetOnboarding() {
    clearProfile()
    setProfile(null)
  }

  function deleteLogs() {
    clearDiary()
    setDiary({})
    setJobs([])
  }

  function deleteAll() {
    clearAllData()
    setDiary({})
    setJobs([])
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
          jobs={jobs}
          onDate={setDate}
          onDelete={del}
          onDeleteBatch={delBatch}
          onVoice={() => setFlow('voice')}
          onSearch={() => setFlow('search')}
          onPhoto={() => setFlow('photo')}
          onResetOnboarding={resetOnboarding}
          onDeleteLogs={deleteLogs}
          onDeleteAll={deleteAll}
        />
      )}

      {profile && flow && <div className="backdrop" onClick={() => setFlow(null)} />}
      {profile && flow && (
        <LogOverlay
          kind={flow}
          date={date}
          diary={diary}
          onClose={() => setFlow(null)}
          onQueue={queuePayload}
          onQuick={quickLog}
          onInstant={instantLog}
        />
      )}
    </div>
  )
}
