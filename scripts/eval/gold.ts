import { entryFromFood, getFood, bestMatch } from '../../src/lib/foods.ts'
import type { ExpectItem } from './types.ts'

export function goldEntry(item: ExpectItem) {
  const food = (item.foodId ? getFood(item.foodId) : null) ?? bestMatch(item.query)
  if (!food) {
    return { kcal: 0, protein: 0, carbs: 0, fat: 0, grams: 0, foodId: null, foodName: null }
  }
  const entry = entryFromFood(
    food,
    {
      raw: item.query,
      query: item.query,
      quantity: item.quantity,
      unit: item.unit,
      brand: null,
    },
    'search',
    '1970-01-01',
  )
  return {
    kcal: entry.kcal,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
    grams: entry.grams,
    foodId: food.id,
    foodName: food.name,
  }
}

export function goldMealKcal(items: ExpectItem[]): number {
  return items.reduce((sum, item) => sum + goldEntry(item).kcal, 0)
}
