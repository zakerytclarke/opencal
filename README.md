# OpenCal

Open-source, on-device calorie tracker. The diary looks and feels like modern MyFitnessPal; logging is closer to Cal AI — speak a sentence, type one, or photograph a plate. Food matching and vision run locally.

## What you get

- **Quick onboarding** — current weight, goal weight, weekly pace, plus the few stats needed for a Mifflin–St Jeor calorie budget
- **Today home** — remaining calories, macro bars, week checkmarks for days you logged, emoji food list with delete
- **Search** — 13,000+ USDA foods (FNDDS 2021–2023, Foundation Foods, SR Legacy) plus compiled restaurant items. Quick-add calories, or type a full sentence
- **Speak** — Web Speech API → local food extractor → database match. Confirmation is read back with speech synthesis
- **Photo** — on-device vision (`@huggingface/transformers` image-to-text) captions the meal, then the same extractor maps foods to the local database
- **PWA** — mobile-first web app. Wrap `dist/` with [Capacitor](https://capacitorjs.com/) for iOS and Android (`appId`: `app.opencal.mobile`)

Nothing you log leaves the device. The first photo uses a one-time model download (then cached).

## Develop

```bash
npm install
npm run dev
```

Rebuild the food database from USDA dumps in `/tmp/opencal-usda`:

```bash
npm run db
```

## Stack

Vite + React + TypeScript, MiniSearch, localStorage diary, Workbox PWA, Transformers.js for vision.
