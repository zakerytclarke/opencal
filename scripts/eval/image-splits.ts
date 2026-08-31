import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvalSplit, ImageCase, ImageSplitFile } from './types.ts'

const EXTRA = ['images.foodd.json', 'images.n5k.json']

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/** Frozen fixtures plus optional FooDD / Nutrition5k identification splits. */
export function loadAllImageSplits(root: string): ImageSplitFile[] {
  const files: ImageSplitFile[] = [loadJson<ImageSplitFile>(join(root, 'evals/splits/images.json'))]
  for (const name of EXTRA) {
    const path = join(root, 'evals/splits', name)
    if (existsSync(path)) files.push(loadJson<ImageSplitFile>(path))
  }
  return files
}

export function imageCasesFor(split: EvalSplit | 'all', files: ImageSplitFile[]): ImageCase[] {
  const out: ImageCase[] = []
  for (const file of files) {
    if (split === 'train') out.push(...file.train)
    else if (split === 'test') out.push(...file.test)
    else out.push(...file.train, ...file.test)
  }
  return out
}

export function imageCaseIndex(files: ImageSplitFile[]): Map<string, ImageCase> {
  const map = new Map<string, ImageCase>()
  for (const file of files) {
    for (const row of [...file.train, ...file.test]) map.set(row.id, row)
  }
  return map
}
