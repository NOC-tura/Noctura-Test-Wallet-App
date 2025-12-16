# Noctura Wallet (Frontend)

## Available Scripts
- `npm run dev` – start the Vite dev server
- `npm run test` – run the Vitest suite once in jsdom
- `npm run test:watch` – watch mode for Vitest
- `npm run build` – production build using default `.env`
- `npm run build:staging` – production build that loads `.env.staging`
- `npm run preview` – preview the production bundle with default env
- `npm run preview:staging` – preview staging bundle

## Environment Files
- `.env.example` documents required variables for local/dev use
- `.env.staging` holds defaults for staging RPC, prover, and fee collector

Copy the appropriate file to `.env` or pass `--mode` when running Vite so the correct variables are injected. For example, `npm run build:staging` reads `.env.staging` automatically.

## Testing Notes
Vitest + React Testing Library power the unit/UI tests. Matchers from `@testing-library/jest-dom` are bootstrapped via `src/setupTests.ts`.
