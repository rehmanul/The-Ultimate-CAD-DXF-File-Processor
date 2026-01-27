# Repository Guidelines

## Project Structure & Module Organization
- `server.js` is the Node/Express entry point for the API and processing pipeline.
- `lib/` contains core processing and domain modules (DXF parsing, corridor generation, ML helpers).
- `public/` hosts the browser app (ES modules, CSS, HTML). Vite serves/builds from here.
- `tests/` is organized by `unit/`, `integration/`, and `e2e/` with Jest as the runner.
- `fixtures/`, `Samples/`, and `models/` hold reference data; `uploads/` is runtime-only.

## Build, Test, and Development Commands
- `npm start` runs the production server on the configured port (default `5000`).
- `npm run dev` runs the server with `nodemon` for live reload.
- `npm run vite-dev` starts the frontend dev server from `public/` (default `3000`).
- `npm run build` (alias of `npm run vite-build`) builds frontend assets to `public/dist`.
- `npm run vite-preview` serves the built frontend for local verification.
- `npm test` runs the Jest suite; add `-- --coverage` to produce `coverage/`.

## Coding Style & Naming Conventions
- Use 4-space indentation and semicolons, matching existing files in `lib/` and `public/`.
- Backend uses CommonJS (`require`, `module.exports`); frontend uses ES modules (`import`).
- Naming: PascalCase for classes (`ProductionCorridorGenerator`), camelCase for functions/vars,
  and UPPER_SNAKE for constants.
- Prefer small, single-responsibility modules; new backend logic belongs in `lib/`.
- No formatter/linter is enforced; follow the established style and add JSDoc for complex APIs.

## Testing Guidelines
- Jest configuration lives in `jest.config.js` with test discovery via `*.test.js`/`*.spec.js`.
- Use existing folders for scope, e.g. `tests/unit/lib/productionCorridorGenerator.test.js`.
- Shared setup lives in `tests/setup.js`; use it for stubs/mocks to keep tests consistent.

## Commit & Pull Request Guidelines
- Recent history uses a conventional prefix (e.g., `feat: ...`, `Fix: ...`); keep messages short
  and action-oriented.
- PRs should include a concise description, testing notes, and links to any related issues.
- Include screenshots or short clips for UI changes under `public/`.

## Configuration & Security
- Copy `.env.example` to `.env` for local settings; do not commit secrets.
- Keep sample files in `fixtures/` or `Samples/`, not in `uploads/`.
