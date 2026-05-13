# Hermes Handoff: Jordan Water Filling Station App

## Project

Arabic-first V1 web app for a water filling station in Jordan.

## Current Stack

- React
- Vite
- TypeScript
- CSS
- LocalStorage persistence
- Vitest tests

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
```

## Manager Mode

Manager Mode is protected by the configured app PIN. Do not write the PIN in docs or public messages.

## Current Key Features

- Arabic-first RTL UI.
- Employee sale flow.
- Saved customer search by name, truck number, or phone.
- New customer creation from sale screen.
- Manual filling amount entry.
- Optional tank-size quick buttons.
- Cash, debt, and partial payments.
- Automatic debt calculation.
- Loyal customer pricing.
- Customer health panel with debt, credit limit, last sale, last payment, and pricing type.
- Toggle selected customer between standard and loyal pricing.
- Today control summary on sale screen.
- Two-pool daily meter closing.
- Customer debt ledger.
- Sales history.
- WhatsApp report copy.
- LocalStorage persistence.

## Loyal Customer Pricing

- 16 meters = 14 JOD
- 12 meters = 11 JOD
- 11 meters = 10 JOD
- 10 meters = 9 JOD
- 8 meters = 7 JOD
- 7 meters = 6 JOD
- 6 meters = 6 JOD
- 5 meters = 5 JOD
- 4 meters = 4 JOD
- 3 meters = 3 JOD

All other loyal customer sizes fall back to standard `1 JOD / meter`.

## Important Files

- `src/App.tsx`: Main app UI and workflows.
- `src/lib/business.ts`: Pricing, sale, meter closing, and customer status business rules.
- `src/lib/business.test.ts`: Business logic tests.
- `src/types.ts`: Core data models.
- `src/data.ts`: Demo seed data and helper functions.
- `src/styles.css`: Main visual system.
- `README.md`: Setup and feature notes.

## Notes

Existing LocalStorage customers created before loyal pricing may default to standard pricing. Select the customer and use `تغيير السعر` to toggle them to `سعر مميز`.
