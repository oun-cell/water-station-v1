# Water Station Management App

Arabic-first offline operations app for a Jordan water filling station.

## Main features

- Fast new sale entry by customer/tank/meter quantity
- Cash, CliQ, debt, and partial payment handling
- Old debt payment during a new sale
- Customer debt ledger and account statement
- Daily closing with meter readings and cash reconciliation
- Manager-only controls
- JSON backup/export and import
- PWA/offline support for Android tablet use

## Development

```bash
npm install
npm run dev
```

## Test and build

```bash
npm test -- --run
npm run build
```

## Android tablet offline setup

See:

```text
ANDROID_TABLET_SETUP.md
```

Important: the farm does not need internet after the app is installed/preloaded on the tablet, but you must load/install it once before going offline.

## Data storage

V1 stores data in the browser/tablet local storage. Export a backup from Manager Mode every day after closing.
