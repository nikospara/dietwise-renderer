# AGENTS.md

## Project Overview
DietWise Renderer is a Node.js + TypeScript service that renders and cleans recipe web pages for downstream consumption.
Core runtime stack: Express + Playwright (Chromium).

## Tech and Entry Points
- Runtime: Node 20, ESM (`"type": "module"`)
- Server entry: `src/server.ts`
- App wiring: `src/app.ts`
- Rendering route: `src/routes/render.ts`
- Health route: `src/routes/health.ts`
- Build output: `dist/`

## Local Development
- Install deps: `npm install`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Run built app: `npm run start`

Default runtime envs used by server:
- `PORT` (default `3000`)
- `BROWSER_COUNT` (default `2`)
- `MAX_CONCURRENT_JOBS` (default `4`)
- `DW_RENDERER_TEST_DIR` (optional local HTML fixture folder)

## Testing and Validation
- Unit tests: `npm run test:unit`
- E2E tests: `npm run test:e2e`
- Full test suite: `npm test`
- Lint: `npm run lint`
- Format: `npm run format`

When modifying rendering/cleaning logic, run at least:
1. `npm run test:unit`
2. `npm run lint`

Run e2e tests when Playwright/browser behavior or HTTP endpoints are touched.

## HTML Cleaning / Data Extraction Scripts
- Clean HTML CLI: `npm run clean:html -- <file>`
- JSON-LD extraction: `tsx scripts/extract-jsonld-recipes.ts <file>`
- Cleaning validation: `tsx scripts/validate-cleaning.ts`

Use `testdata/_control.csv` + scripts in `scripts/` to reproduce cleaning scenarios.
Do not add copyrighted downloaded pages permanently unless explicitly requested.

## Docker Notes
The container must include Playwright browser binaries at build time.
Current Dockerfile installs Chromium in-image and sets:
- `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`

If Docker/Playwright changes are made, verify container boot with:
- `docker build -t dietwise-renderer .`
- `docker run --rm -p 3000:3000 dietwise-renderer`

## Implementation Guidelines
- Keep changes minimal and scoped to the task.
- Preserve ESM import style and `.js` import suffixes in TS files.
- Follow existing path alias style (`app/...`) used in source.
- Avoid adding heavy dependencies unless necessary.
- Prefer small pure functions and targeted tests for parser/cleaner behavior.

## Agent Workflow Expectations
Before finishing a code change:
1. Build (`npm run build`) for TypeScript/alias correctness.
2. Run relevant tests/lint commands for touched areas.
3. Summarize behavior changes and any new env/config assumptions.

If you cannot run a required check (missing dependency/tooling limits), explicitly state what was not run.
