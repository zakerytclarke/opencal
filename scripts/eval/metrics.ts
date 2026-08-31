import type { CaseScore, MetricSummary } from './types.ts'

const STOP = new Set([
  'a', 'an', 'and', 'or', 'with', 'the', 'of', 'in', 'on', 'for', 'from',
  'raw', 'cooked', 'large', 'medium', 'small', 'whole', 'plain', 'grade', 'extra', 'only',
])

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stem(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`
  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function tokensOf(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .map(stem)
    .filter((t) => t && !STOP.has(t))
}

export function aliasHit(predicted: string[], aliases: string[]): boolean {
  if (!predicted.length || !aliases.length) return false
  return aliases.some((alias) => {
    const aToks = tokensOf(alias)
    if (!aToks.length) return false
    return predicted.some((pred) => {
      if (aToks.length === 1) {
        const first = tokensOf(pred.split(',')[0] ?? pred)
        const last = first[first.length - 1]
        return last === aToks[0] || first.join(' ') === aToks[0]
      }
      const all = tokensOf(pred)
      return aToks.every((t) => all.includes(t))
    })
  })
}

export function ape(pred: number, gold: number): number {
  const denom = Math.max(Math.abs(gold), 1)
  return Math.abs(pred - gold) / denom
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function scoreCase(input: {
  id: string
  split: CaseScore['split']
  modality: CaseScore['modality']
  source?: string
  predictedNames: string[]
  goldAliases: string[][]
  loose?: boolean
  kcalPred: number
  kcalGold: number
  unmatched: number
  ms: number
  error?: string
}): CaseScore {
  const hits = input.goldAliases.filter((aliases) => aliasHit(input.predictedNames, aliases))
  const named =
    input.loose && input.goldAliases.length
      ? hits.length > 0
      : hits.length === input.goldAliases.length && input.goldAliases.length > 0
  return {
    id: input.id,
    split: input.split,
    modality: input.modality,
    source: input.source,
    named,
    namedCount: hits.length,
    namedNeed: input.goldAliases.length,
    kcalPred: input.kcalPred,
    kcalGold: input.kcalGold,
    kcalAbsErr: Math.abs(input.kcalPred - input.kcalGold),
    kcalApe: ape(input.kcalPred, input.kcalGold),
    unmatched: input.unmatched,
    itemsPred: input.predictedNames,
    itemsGold: input.goldAliases.map((a) => a[0] ?? ''),
    ms: input.ms,
    error: input.error,
  }
}

export function summarize(scores: CaseScore[]): MetricSummary {
  const n = scores.length
  if (!n) {
    return {
      n: 0,
      namedAcc: 0,
      unmatchedRate: 0,
      kcalMae: 0,
      kcalMdae: 0,
      kcalMape: 0,
      within20: 0,
      within50: 0,
      kcalMaeNamed: null,
      meanMs: 0,
    }
  }
  const named = scores.filter((s) => s.named)
  const kcalMaeNamed = named.length ? named.reduce((a, s) => a + s.kcalAbsErr, 0) / named.length : null
  return {
    n,
    namedAcc: scores.filter((s) => s.named).length / n,
    unmatchedRate: scores.filter((s) => s.unmatched > 0 && s.kcalPred === 0).length / n,
    kcalMae: scores.reduce((a, s) => a + s.kcalAbsErr, 0) / n,
    kcalMdae: median(scores.map((s) => s.kcalAbsErr)),
    kcalMape: scores.reduce((a, s) => a + s.kcalApe, 0) / n,
    within20: scores.filter((s) => s.kcalApe <= 0.2).length / n,
    within50: scores.filter((s) => s.kcalApe <= 0.5).length / n,
    kcalMaeNamed,
    meanMs: scores.reduce((a, s) => a + s.ms, 0) / n,
  }
}

export function formatSummary(title: string, s: MetricSummary): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const maeNamed = s.kcalMaeNamed == null ? 'n/a' : s.kcalMaeNamed.toFixed(1)
  return [
    `### ${title} (n=${s.n})`,
    `- Food name accuracy: ${pct(s.namedAcc)}`,
    `- Calorie MAE: ${s.kcalMae.toFixed(1)} kcal (median ${s.kcalMdae.toFixed(1)})`,
    `- Calorie MAPE: ${pct(s.kcalMape)} · within 20%: ${pct(s.within20)} · within 50%: ${pct(s.within50)}`,
    `- Calorie MAE when named correctly: ${maeNamed} kcal`,
    `- Empty/unmatched: ${pct(s.unmatchedRate)} · mean latency ${Math.round(s.meanMs)} ms`,
  ].join('\n')
}
