# Repository Guidelines

## Project Structure & Module Organization
- `server.js` is the Express entrypoint; serves static assets from `public` and wires CAD/ML routes.
- `lib/` holds core domain logic (CAD parsers, corridor/îlot generators, ML processors, exports, webhook workers).
- `public/` contains the Vite-built frontend; `build/` and `exports/` store generated bundles/exports; `uploads/` is runtime-only for incoming files.
- `tests/` is split into `unit/`, `integration/`, and `e2e/`; `tests/setup.js` configures Jest globals. Fixtures live in `fixtures/`.
- `models/` and `checkpoints/` hold model weights; avoid committing regenerated artifacts without need.

## Build, Test, and Development Commands
- `npm start` — run the production server (`server.js`) on `PORT` (default 5000).
- `npm run dev` — watch/restart backend via nodemon for local API work.
- `npm run vite-dev` — run the Vite frontend dev server (hot reload).
- `npm run vite-build` — create a production frontend build into `public/dist`.
- `npm test` — Jest test suite (Node env, runInBand). Add `--coverage` for reports to `coverage/`.
- `npm run vite-preview` — preview the built frontend locally.

## Coding Style & Naming Conventions
- JavaScript/Node with CommonJS modules; prefer `const`/`let`, semicolons on, and 4-space indentation (match `server.js` and `lib/*`).
- Filenames use camelCase for modules (e.g., `productionCorridorGenerator.js`); tests mirror source names with `.test.js`.
- Keep functions small and pure inside `lib/`; push IO concerns to `server.js` routes. Reuse helpers in `geometryHelpers.js` and `overlayHelpers.js` before adding new utilities.
- Environment keys are UPPER_SNAKE_CASE in `.env`; never commit secrets.

## Testing Guidelines
- Framework: Jest with `testMatch` for `**/?(*.)+(spec|test).js`; coverage collected from `lib/**` and `server.js`.
- Place unit tests under `tests/unit`, integration under `tests/integration`, e2e under `tests/e2e`; name files `{module}.test.js`.
- Use `supertest` for HTTP endpoints and fixtures from `fixtures/` for repeatable inputs. Target ≥80% coverage for modified files when feasible.

## Commit & Pull Request Guidelines
- Commit style mirrors history: concise imperative summaries with optional type prefixes (`Fix:`, `Feat:`, `Guard:`). Keep subject ≤72 chars (e.g., `Fix DWG wasm loading with cached LibreDwg`).
- For PRs: include a short change description, linked issue/bug ID, test evidence (`npm test`, manual checks), and screenshots/GIFs for UI-affecting changes. Note any config or data migrations.

## Security & Configuration Tips
- Create `.env` from `.env.example`; set `PORT`, `NODE_ENV`, and optional APS credentials. Keep `.env` and runtime artifacts (`uploads/`, `exports/`, `coverage/`) out of commits.
- Large assets (e.g., `training-data.json`, model checkpoints) should not be regenerated unless required; document provenance if updated.
