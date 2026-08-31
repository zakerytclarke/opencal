import { extractFoods } from './extract'
import type { ExtractedItem } from '../types'

export type ToolCall = {
  query: string
  quantity: number
  unit: string | null
}

export const SEARCH_FOODS_TOOL = {
  name: 'search_foods',
  description: 'Look up one food or drink in the local USDA database and log it.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Short common grocery name, e.g. banana, grilled chicken, brown rice, latte',
      },
      quantity: {
        type: 'number',
        description: 'How much was eaten. Default 1.',
      },
      unit: {
        type: 'string',
        description: 'Optional unit such as medium, large, slice, cup, oz, g, bowl, tbsp, handful',
      },
    },
    required: ['query'],
  },
} as const

export const VLM_TOOLS = [SEARCH_FOODS_TOOL]

export const SYSTEM_PROMPT = `You are OpenCal's on-device food logger.
Identify every distinct food or drink.
List of tools: ${JSON.stringify(VLM_TOOLS)}
Call search_foods once per item. Estimate portions. Skip plates, utensils, napkins, and tableware.
Do not invent calorie numbers.`

export const PHOTO_USER_PROMPT =
  'Log every visible food and drink using search_foods tool calls. Ignore plates and utensils.'

export function textUserPrompt(meal: string): string {
  return `Log this meal using search_foods tool calls:\n${meal}`
}

function toCall(query: unknown, quantity: unknown, unit: unknown): ToolCall | null {
  const q = String(query ?? '').trim()
  if (!q) return null
  const n = Number(quantity)
  return {
    query: q,
    quantity: Number.isFinite(n) && n > 0 ? n : 1,
    unit: unit != null && String(unit).trim() && String(unit).trim().toLowerCase() !== 'none' ? String(unit).trim() : null,
  }
}

function parseScalar(raw: string): string | number | boolean | null {
  const s = raw.trim()
  if (!s || s === 'None' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\(["'\\])/g, '$1')
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function parseKwargs(argStr: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const re =
    /([A-Za-z_]\w*)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|-?\d+(?:\.\d+)?|true|false|None|null|[A-Za-z_][\w-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(argStr))) {
    out[m[1]] = parseScalar(m[2])
  }
  return out
}

function parsePythonToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  const re = /search_foods\s*\(([\s\S]*?)\)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const args = parseKwargs(m[1])
    const call = toCall(args.query ?? args.name ?? args.food, args.quantity ?? args.qty ?? args.amount, args.unit)
    if (call) calls.push(call)
  }
  return calls
}

function parseJsonObject(parsed: unknown): ToolCall[] {
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as {
    tools?: { name?: string; arguments?: Record<string, unknown>; parameters?: Record<string, unknown> }[]
    foods?: { query?: string; name?: string; quantity?: number; unit?: string }[]
    items?: { query?: string; name?: string; quantity?: number; unit?: string }[]
    query?: string
    name?: string
    quantity?: number
    unit?: string
    arguments?: Record<string, unknown>
  }

  const fromTools = (obj.tools ?? [])
    .filter((t) => !t.name || t.name === 'search_foods')
    .map((t) => {
      const args = t.arguments ?? t.parameters ?? {}
      return toCall(args.query ?? args.name, args.quantity ?? args.qty, args.unit)
    })
    .filter((c): c is ToolCall => !!c)
  if (fromTools.length) return fromTools

  const list = obj.foods ?? obj.items
  if (list?.length) {
    return list
      .map((f) => toCall(f.query ?? f.name, f.quantity, f.unit))
      .filter((c): c is ToolCall => !!c)
  }
  if (obj.query || obj.name) {
    const call = toCall(obj.query ?? obj.name, obj.quantity, obj.unit)
    return call ? [call] : []
  }
  if (obj.arguments) {
    const call = toCall(obj.arguments.query ?? obj.arguments.name, obj.arguments.quantity, obj.arguments.unit)
    return call ? [call] : []
  }
  return []
}

function jsonBlobs(text: string): string[] {
  const blobs: string[] = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) blobs.push(fenced[1])
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) blobs.push(text.slice(firstBrace, lastBrace + 1))
  const firstArr = text.indexOf('[')
  const lastArr = text.lastIndexOf(']')
  if (firstArr >= 0 && lastArr > firstArr) blobs.push(text.slice(firstArr, lastArr + 1))
  blobs.push(text.trim())
  return blobs
}

export function parseToolCalls(text: string): ToolCall[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const native: ToolCall[] = []
  const blocks = trimmed.matchAll(/<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g)
  for (const block of blocks) native.push(...parsePythonToolCalls(block[1]))
  if (native.length) return native

  const python = parsePythonToolCalls(trimmed)
  if (python.length) return python

  for (const blob of jsonBlobs(trimmed)) {
    try {
      const parsed = JSON.parse(blob) as unknown
      if (Array.isArray(parsed)) {
        const fromArr = parsed
          .map((row) => {
            if (typeof row === 'string') return toCall(row, 1, null)
            if (row && typeof row === 'object') {
              const r = row as { name?: string; query?: string; arguments?: Record<string, unknown>; quantity?: number; unit?: string }
              if (r.arguments) return toCall(r.arguments.query ?? r.arguments.name, r.arguments.quantity, r.arguments.unit)
              return toCall(r.query ?? r.name, r.quantity, r.unit)
            }
            return null
          })
          .filter((c): c is ToolCall => !!c)
        if (fromArr.length) return fromArr
      }
      const fromObj = parseJsonObject(parsed)
      if (fromObj.length) return fromObj
    } catch {
      // try next blob
    }
  }
  return []
}

export function itemsFromModelText(raw: string, fallbackText?: string): ExtractedItem[] {
  const calls = parseToolCalls(raw)
  if (calls.length) {
    return calls.map((c) => ({
      raw,
      query: c.query,
      quantity: c.quantity,
      unit: c.unit,
    }))
  }
  const fromRaw = extractFoods(raw)
  if (fromRaw.length && raw.trim()) return fromRaw
  return fallbackText ? extractFoods(fallbackText) : []
}

export function stripSpecialTokens(text: string): string {
  return text
    .replace(/<\|[^>]+?\|>/g, '')
    .replace(/<\|im_end\|>/g, '')
    .trim()
}
