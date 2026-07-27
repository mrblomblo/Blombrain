# Blombrain

A local-first, self-hosted LLM chat frontend -- built to the spec in
`impl_plan.md` (local Claude / LM Studio / Open WebUI competitor: real MCP
support, no forced model duplication, presets, inline artifacts, full
theming, multi-backend routing, STT/TTS, and so on).

This repo is being built in the order laid out in that plan's **Build
order** section, boring plumbing first. **This pass covers step 1
(scaffolding) and step 2 (core chat loop + backend registry).** Nothing
past that exists yet -- see [Status](#status) below for the honest
breakdown of what works today versus what's still a stub or missing
entirely.

## Architecture

Two clearly separated pieces, exactly as specced:

- **`frontend/`** -- Svelte 5 + Vite + TypeScript + Tailwind CSS v4. Pure UI.
  It has *no* direct knowledge of MCP servers or model files, and never
  talks to an inference backend directly -- only to the Blombrain backend's
  own API. This keeps CORS, subprocess-spawning, and file-system access out
  of the browser entirely.
- **`backend/`** -- Node.js + TypeScript + Fastify. Owns the backend
  registry, proxies `/v1/chat/completions` (streaming) and `/v1/models` to
  whichever configured OpenAI-compatible endpoint(s) you point it at.
  Persistence (SQLite), MCP process management, STT/TTS, etc. will live
  here as they're built in later passes.

```
blombrain/
  frontend/   Svelte 5 + Vite + Tailwind v4 SPA
  backend/    Fastify server: backend registry + chat/model proxy
```

## Prerequisites

- Node.js 22+ (repo was built/tested against v22)
- An OpenAI-compatible inference server already running somewhere --
  `llama-server`, KoboldCpp, vLLM, an actual OpenAI-compatible cloud
  endpoint, etc. Blombrain never loads or copies model files itself; it
  only ever talks to an existing server's `/v1/models` and
  `/v1/chat/completions` endpoints.

## Getting started (dev mode, two processes)

```bash
# Terminal 1 -- backend
cd backend
npm install
npm run dev          # Fastify on http://localhost:4300

# Terminal 2 -- frontend
cd frontend
npm install
npm run dev           # Vite on http://localhost:5173, proxies /api -> :4300
```

Open `http://localhost:5173`. If you have `llama-server` (or anything else
OpenAI-compatible) running on `127.0.0.1:8080`, it'll show up immediately --
that's the default entry in `backend/config/backends.json`.

## Getting started (single process, production-ish)

```bash
cd frontend && npm install && npm run build   # writes frontend/dist
cd ../backend && npm install && npm run build # writes backend/dist
npm start                                     # serves API + built frontend on :4300
```

When `backend/src/server.ts` finds a built `frontend/dist`, it serves it
directly, so the whole app can run as a single process on a single port.

## Configuring backends

`backend/config/backends.json` is a plain JSON array, loaded once at
startup (this becomes a proper DB-backed, editable-from-the-UI registry in
step 3 -- persistence -- but the shape below is designed to carry over
unchanged):

```json
[
  {
    "id": "local",
    "name": "Local (llama-server)",
    "baseUrl": "http://127.0.0.1:8080",
    "prefix": "local"
  },
  {
    "id": "cloud",
    "name": "Cloud (heavy tasks)",
    "baseUrl": "https://api.example.com",
    "prefix": "cloud",
    "apiKeyEnv": "CLOUD_API_KEY"
  }
]
```

- **`prefix`** disambiguates model IDs across backends -- a model shows up
  in the picker and is addressed over the API as `"<prefix>:<raw-id>"`
  (e.g. `local:llama-3.1-8b-instruct`), so two backends can both serve
  something literally called `llama-3.1-8b` without colliding. Defaults to
  `id` if omitted.
- **`apiKeyEnv`** names an environment variable to read the key from at
  startup (recommended for anything that isn't purely local, so you're not
  tempted to commit a real key into this file). A literal `apiKey` field
  also works if you'd rather keep everything in one file for a fully local
  setup.
- You can point at any number of backends -- there's nothing hardcoded
  about "one local + one remote"; add as many entries as you want.
- Restart the backend after editing this file for now (hot-reloading the
  registry is a step-3 persistence concern).

## Theming

Every color in the UI comes from a semantic CSS variable in
`frontend/src/app.css` -- no component hardcodes a hex value or a raw
Tailwind color. Three themes ship today (`slate-ember`, `paper-fern`,
`nightshade`), deliberately not just an inverted light/dark pair -- each
has its own signal color and mood. To add a new theme, add one
`[data-theme="your-name"]` block in `app.css` defining the same set of
variables, and add the name to `THEMES` / `THEME_LABELS` in
`frontend/src/lib/theme.ts`. The switcher in the sidebar picks it up
automatically.

## Status

**Working (steps 1-2 of the build order):**
- Repo scaffolding, both processes running and talking to each other
- Backend registry (multi-backend, prefixed model IDs, per-backend API
  keys via env var)
- `/api/backends` (with a live online/offline ping) and `/api/models`
  (aggregated + prefixed across all configured backends)
- `/api/chat/completions` -- resolves the prefix, proxies to the real
  backend, streams the SSE response straight through
- Frontend: message list, streaming response rendering, input composer
  (Enter to send / Shift+Enter for newline, stop-generating button),
  backend/model picker, live backend status in the sidebar, full theme
  system

**Explicitly NOT built yet** (all still on the plan, in build order):
- **Persistence** (step 3) -- there is no database. Every page reload
  starts a fresh conversation; the backend registry above is
  config-file-only, not yet editable from the UI.
- **Presets** ("Models" à la Open WebUI, step 4)
- **Multimodal attachments** (step 5)
- **Artifacts / inline HTML-SVG rendering** (step 6) -- and relatedly,
  chat responses are rendered as plain text right now, not Markdown.
  Markdown + syntax highlighting is being deferred to land together with
  artifact rendering rather than half-implemented now.
- **Auto chat naming** (step 7)
- **MCP integration** (step 8) and **context-scoped tool routing** (step 9)
- **STT/TTS** (step 10)
- **Memory / cross-chat recall with RAG** (step 11)
- **Polish pass** (step 12) -- keyboard shortcuts, deeper theming audit,
  etc.

## Notes on a couple of build choices

- **UI components are hand-written Tailwind, not the shadcn-svelte CLI.**
  The plan calls for shadcn-svelte specifically because its components are
  copied into the repo rather than pulled in as a runtime dependency. This
  sandbox's network access doesn't reach the shadcn registry the CLI needs,
  so `frontend/src/lib/components/ui/` was written by hand in the same
  spirit instead (plain Tailwind, no runtime UI-kit dependency, easy to
  keep diverging from a "generic AI app" look). If you want the real
  shadcn-svelte primitives, `npx shadcn-svelte@latest init` should work
  fine on your own machine with normal internet access -- nothing here
  depends on avoiding it going forward.
- **Fonts are system stacks, not a webfont CDN.** Deliberate, not just a
  sandbox limitation: this is meant to be a 100% local, offline-capable
  tool, so it shouldn't phone home to Google Fonts (or anywhere else) just
  to render text.
- **No monorepo tooling.** `frontend/` and `backend/` are two independent
  `npm` projects on purpose -- there's no shared workspace config to fight
  with as the plan's own two-process, clean-separation architecture
  implies.

## Troubleshooting

- **"Couldn't reach the Blombrain backend" in the model picker** -- the
  backend process isn't running, or isn't on port 4300. Check
  `npm run dev` in `backend/` is still alive.
- **A backend shows offline in the sidebar** -- Blombrain pings
  `<baseUrl>/v1/models` with a 2s timeout to determine this. Confirm that
  URL is reachable directly (`curl http://127.0.0.1:8080/v1/models`) and
  that whatever you're running there actually implements the
  OpenAI-compatible `/v1/models` and `/v1/chat/completions` routes.
- **Port conflicts** -- override with `PORT=<n> npm run dev` (backend) or
  edit `frontend/vite.config.ts`'s `server.port` / proxy target if you
  change the backend's port.
