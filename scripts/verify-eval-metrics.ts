import { aliasHit, ape, scoreCase, summarize } from './eval/metrics.ts'

const cases: { name: string; pass: boolean; got: string }[] = []
function check(name: string, pass: boolean, got: string) {
  cases.push({ name, pass, got })
}

check('aliasHit matches banana in USDA-style title', aliasHit(['Banana, raw'], ['banana']), 'banana')
check('banana gold does not match banana pepper', !aliasHit(['banana pepper'], ['banana']), 'rejected')
check('pepper gold matches banana pepper', aliasHit(['banana pepper'], ['pepper']), 'pepper')
check('pepper gold matches USDA banana pepper row', aliasHit(['Pepper, banana, raw'], ['pepper']), 'Pepper, banana')
check('aliasHit turkey bacon', aliasHit(['Turkey bacon, cooked'], ['turkey bacon']), 'turkey bacon')
check('egg white matches USDA white row', aliasHit(['Egg, white only, raw'], ['egg white', 'white']), 'egg white')
check('ape 10 vs 8 is 25%', Math.abs(ape(10, 8) - 0.25) < 1e-9, String(ape(10, 8)))
check('ape gold 0 uses denom 1', ape(5, 0) === 5, String(ape(5, 0)))

const hit = scoreCase({
  id: 'a',
  split: 'test',
  modality: 'text',
  predictedNames: ['Eggs, Grade A, Large, egg whole', 'Banana'],
  goldAliases: [['egg'], ['banana']],
  kcalPred: 220,
  kcalGold: 200,
  unmatched: 0,
  ms: 10,
})
check('named when every gold alias hits', hit.named && hit.kcalAbsErr === 20, `${hit.named} ${hit.kcalAbsErr}`)

const miss = scoreCase({
  id: 'b',
  split: 'test',
  modality: 'image',
  predictedNames: ['Pepper, banana, raw'],
  goldAliases: [['banana']],
  kcalPred: 20,
  kcalGold: 105,
  unmatched: 0,
  ms: 10,
})
check('image miss when the fruit is not named', !miss.named, String(miss.named))

const loose = scoreCase({
  id: 'c',
  split: 'train',
  modality: 'image',
  predictedNames: ['Chicken bowl'],
  goldAliases: [['bowl', 'salad', 'chicken']],
  loose: true,
  kcalPred: 500,
  kcalGold: 520,
  unmatched: 0,
  ms: 8,
})
check('loose image hit accepts any alias', loose.named, String(loose.named))

const sum = summarize([hit, miss])
check('summary n and mae', sum.n === 2 && Math.abs(sum.kcalMae - (20 + 85) / 2) < 1e-6, `${sum.n} ${sum.kcalMae}`)
check('named acc is 1/2', sum.namedAcc === 0.5, String(sum.namedAcc))
check('within20 counts only the close case', sum.within20 === 0.5, String(sum.within20))
check('kcal WAPE is total abs / total gold', Math.abs(sum.kcalWape - (20 + 85) / (200 + 105)) < 1e-9, String(sum.kcalWape))
check('kcal median relative error averages the two APEs', Math.abs(sum.kcalMdape - (20 / 200 + 85 / 105) / 2) < 1e-9, String(sum.kcalMdape))

const macros = scoreCase({
  id: 'd',
  split: 'test',
  modality: 'image',
  predictedNames: ['Chicken'],
  goldAliases: [['chicken']],
  kcalPred: 250,
  kcalGold: 200,
  proteinPred: 30,
  proteinGold: 20,
  carbsPred: 5,
  carbsGold: 0,
  fatPred: 10,
  fatGold: 12,
  unmatched: 0,
  ms: 1,
})
check('protein abs err', macros.proteinAbsErr === 10, String(macros.proteinAbsErr))
const macroSum = summarize([macros])
check('protein MAE', macroSum.protein.mae === 10, String(macroSum.protein.mae))
check('protein WAPE', macroSum.protein.wape === 10 / 20, String(macroSum.protein.wape))
check('meal ≥50 kcal is counted', macroSum.mealN === 1 && macroSum.within20Meal === 0, `${macroSum.mealN} ${macroSum.within20Meal}`)
check('meal MAPE is the close-enough APE', Math.abs(macroSum.kcalMapeMeal - 50 / 200) < 1e-9, String(macroSum.kcalMapeMeal))

const failed = cases.filter((c) => !c.pass)
console.log('| # | Test | Got | Result |')
console.log('|---|------|-----|--------|')
cases.forEach((c, i) => {
  console.log(`| ${i + 1} | ${c.name} | ${c.got.replace(/\|/g, '/')} | ${c.pass ? 'PASS' : 'FAIL'} |`)
})
console.log('')
console.log(`${cases.length - failed.length}/${cases.length} passed`)
if (failed.length) process.exit(1)
