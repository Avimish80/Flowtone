# Defiant Harmony Flow App (Local)

This app now runs as a standalone local Vite + React app with no Base44 dependency.

## Run locally

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`
3. Open:
   - `http://localhost:5173`

## Data model

- All app data is stored in browser `localStorage`.
- The API compatibility layer is in `src/api/appClient.js`.
- Clearing browser storage resets local data.

## Build

- `npm run build`
- `npm run preview`
