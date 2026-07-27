# Local LLM UI — Requirements & Field Notes

A reference doc distilled from testing LM Studio, llama-server, KoboldCpp, SillyTavern, Open WebUI, Jan, Front Porch AI, Odysseus, Msty Studio, LibreChat, Cherry Studio, LobeChat, and AnythingLLM.

## Core wishlist (the actual goal)

- A "local Claude, LM Studio and Open WebUI competitor" — clean, professional chat interface, not a roleplay/character app
- **MCP / Skills / Tools** support on par with LM Studio
- **Model compatibility** on par with llama.cpp — point directly at existing GGUF files or a running server; never import/duplicate models already on disk
- **True multimodal input** that matches the actual loaded model's capabilities (image, audio, video where supported — e.g. Gemma 4 12B) rather than a hardcoded allowlist
- **Presets** on par with Open WebUI's "Models" feature: take one backend LLM and define multiple named personas from it (custom name, custom picture/avatar, system prompt, sampling params). Presets should inherit the parent model's full settings (name, icon, params, multimodality capabilities, etc.) only once when they are created (only optionally on edit or parent model change, and the user should be able to pick what is inherited). If a parent model is deleted, then hide the preset from the model/preset selector or grey it out, and let the user pick a new parent model for it.
- **Inline artifact rendering** on par with Open WebUI — HTML/SVG rendered in-UI, not just as a code block
- **Inline Markdown rendering** on par with Claude — code blocks/snippets, headers, hyperlinks, bold/italic/underline/strikethrough rendering in the chat (even better if it renders markdown in the text input, just like how it does with Claude)
- Toggleable persistent memory with RAG
- Native Linux app preferred (tauri/electron is acceptable); a self-hosted web UI is acceptable
- Not CLI-only
- **STT + TTS** (planned defaults: Qwen3-ASR for STT, Qwen3-TTS via qwentts.cpp for TTS), each independently configurable to run on CPU or GPU/CUDA and abstracted behind generic provider interfaces
- **Auto chat naming**, pluggable per user preference:
  1. First few words of the user's message (free, no LLM call)
  2. Summarized by the currently-loaded/active model
  3. Summarized by a different, separately-designated model
- **Multiple simultaneous backends** — e.g. one local backend for privacy-sensitive/quick tasks and one remote API backend for heavier tasks that don't need the same privacy, with an optional backend-wide model-ID prefix to disambiguate models across backends
- **Context-scoped tool routing** — an optional mode where, before the main model sees the task, a lightweight pass shows a model (the main one, or a separate designated one) short summaries of every installed MCP server/skill/tool, has it pick which are relevant, and only forwards the full descriptions/schemas of the selected subset into the main conversation — so unused tools don't bloat the primary context window (summaries sourced from a summary and keywords field in the backend's MCP registry where the user (or a one-time LLM pass) can write a 1-sentence description of the tool when it's installed). The user can of course select any tools they want to force before sending the message, and the context-scoped tool routing is entirely optional as previously stated
- **Theming** — Theming is important, so the UI should have absolutely 0 hardcoded colors, everything should be driven by themes (not just light/dark mode)
- **Backups** — The user should be able to fully backup/export (and import) their instance
- Almost certainly more to come — this list should stay living, not final

## Hard dealbreakers (things that got an app rejected outright)

- Forced login / account creation for a tool that's supposed to be 100% local
- Pre-checked consent/privacy boxes, or any dark-pattern-y consent flow
- Roleplay/character-card UX (character import, persona-as-fictional-character framing)
- Generic "AI-generated" or template-y visual design
- Sluggish, choppy, or freeze-prone UI
- Model management that requires importing/copying files you already have on disk
- Advertising or pushing the vendor's own hosted model inside the UI

## App-by-app verdict

| App | Verdict | Reason |
|---|---|---|
| **LM Studio** | Rejected (starting point) | No Gemma MTP (speculative decoding drafter) support, no audio input, over-simplified for advanced config |
| **llama-server** (bundled web UI) | Rejected | Too bare — model/folder has to be set via CLI, no persistent per-model settings beyond shell aliases |
| **KoboldCpp** | Rejected | UI is ugly; clearly built for roleplay |
| **SillyTavern** | Rejected | Same roleplay-shaped issues as KoboldCpp |
| **Open WebUI** | Kept, but only as the *server-side* interface | Favorite UI overall; artifacts and presets ("Models") are done right — but MCP/skills/tool handling isn't great, and it's not what's wanted for the local PC app |
| **Jan** | Rejected | Forces "importing" (duplicating) models already on disk; a 6GB import took forever; nags to use Jan's own model; choppy/freeze-prone UI |
| **Front Porch AI** | Rejected | Generic "AI-generated dark mode" look; forces character import; roleplay-oriented UX |
| **Odysseus** | Untested since launch | Was buggy/disappointing at launch; may be worth a second look given how much it's changed |
| **Oobabooga** | Untested since ~2021 | Wasn't impressed years ago; open to retesting |
| **Msty Studio** | Rejected, untested | No public GitHub repo, site reads as shady |
| **LibreChat** | Rejected, untested | UI looked too simplified on sight |
| **Cherry Studio** | Rejected | Login screen and pre-checked privacy box on a local tool; UI feels bloated/generic ("Apple-y/Gnome-y"); rejected a valid audio/video upload on a model that supports both (Gemma 4 12B) |
| **LobeChat** | Rejected | Chat UI looks like "Jan and Cherry had a child" — same generic/bloated design language |
| **AnythingLLM** | Skipped | Hard pass on the UI, and its features do not align with my needs |

## Things worth stealing from what's already been tried

- **Cherry Studio**: lets you add/remove attachments on messages you're *editing*, not just new messages — genuinely nice, worth replicating
- **Open WebUI**: the "Models" preset concept (name + avatar + system prompt + params on top of one backend model) and inline HTML/SVG artifact rendering
- **llama.cpp philosophy**: never touch or copy the user's model files — read them, or the server exposing them, as-is

## Open technical questions for the build

- **MCP**: most MCP servers are stdio subprocesses, which a pure browser app can't spawn directly. Every tool above that "does MCP" actually relies on a small local bridge process (e.g. an MCP-to-HTTP proxy) under the hood — this isn't a step down, it's how it's done everywhere.
- **Backend target**: assume an OpenAI-compatible endpoint (llama-server, KoboldCpp, etc.) rather than reimplementing a model loader.
- **Multimodal capability configuration**: capability (image/audio/video support) should be configurable per model, per preset, and per multimodality (one toggle for audio, one for video, etc.). There shouldn't be any assumptions (especially any non-configurable) about whether a model supports audio/video/image input.
- **Multi-backend model namespacing**: with more than one backend connected, model IDs can collide (two backends both serving something called `llama-3.1-8b`). Solve with an optional per-backend and user-customizable prefix (e.g. `local:`, `local2:`, `cloud:`) applied when aggregating the model list, rather than requiring globally-unique names.
- **Tool-scoped routing adds a network hop**: the "let a model pick relevant tools first" feature means one extra completion call before the real one. Worth pairing with multi-backend — optionally route that selection call to a small/fast local model while the actual conversation goes wherever the user configured, so the extra hop doesn't add much latency.
- **TTS engine choice**: Qwen3-TTS (via qwentts.cpp) is the primary target, offering SOTA voice cloning and expressive speech. qwentts.cpp is a standalone C++17/GGML port that supports CPU, CUDA, Metal, and Vulkan, satisfying the CPU/GPU toggle requirement. Keep it behind a generic "TTS provider" interface so the engine can be swapped later without touching the rest of the app (e.g., dropping down to OuteTTS via llama-server if a single-binary setup is preferred, or using an OpenAI-compatible HTTP wrapper like Qwen3-TTS-Openai-Fastapi).
- **How to handle VRAM usage**: If all three (an LLM, Qwen3-ASR, and Qwen3-TTS) are running on CUDA simultaneously, you will OOM on consumer GPUs (e.g., 12GB/24GB VRAM). Even though they're abstracted behind provider interfaces, the backend will need a basic "resource manager" to pause/unload the LLM when TTS is generating, or vice versa, and have a very short amount of time until STT and TTS models get unloaded (should probably have an "eject" button for TTS and STT).

## Planned stack

Two clearly separated pieces: a **frontend** (pure UI, no direct knowledge of MCP or model files) and a **backend** (owns persistence, MCP process management, and proxies inference). The frontend never talks to `llama-server`/whatever LLM provider(s) or MCP servers directly — it only talks to the backend's API. This keeps CORS, subprocess-spawning, and file-system access out of the browser entirely.

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Svelte 5 + Vite + TypeScript | Fast dev loop, no need for SSR/routing complexity of Next.js for a single-page app |
| Component library | shadcn-svelte | Not a runtime dependency — components are copied into the repo, so nothing to fight if the design needs to diverge from "generic AI app" look. |
| Styling | Tailwind CSS | Pairs directly with shadcn; utility classes make it easy to deliberately *not* end up with the generic corporate look everything else had |
| State/data fetching | TanStack Query + Svelte stores | Query for backend API calls/caching, Svelte stores for small bits of local UI state (active preset, open panels). No Redux — overkill here |
| Artifact rendering | Sandboxed `<iframe sandbox>` + `postMessage` + `allow-scripts` | Same approach Claude/ChatGPT use — isolates arbitrary HTML/SVG/JS from the parent app |
| Backend runtime | Node.js + TypeScript | Matches the frontend's language (shared types possible), and the official MCP SDK (`@modelcontextprotocol/sdk`) is TypeScript-first and the most complete implementation |
| Backend framework | Fastify (or plain Node `http`) | Lightweight HTTP + WebSocket/SSE server; no need for Express-level ceremony |
| Persistence | SQLite via `better-sqlite3` | Single-user, single-machine, zero-config — no separate DB server. Stores conversations, messages, presets, memory notes |
| Semantic RAG | SQLite VEC via `sqlite-vec` | a pure-C SQLite extension that runs anywhere SQLite runs, and has a first-class better-sqlite3 binding |
| Attachments | Flat files on disk, referenced by path/hash in SQLite | Avoids blob bloat in the DB |
| Inference backends | A **registry** of OpenAI-compatible endpoints (not just one) — each with base URL, optional API key, optional model-ID prefix, CPU/GPU-agnostic since that's the endpoint's own concern | Supports the local-for-privacy + remote-for-heavy-lifting split, and matches the llama.cpp-style "never reimplement a model loader" philosophy for each one |
| MCP transport | `@modelcontextprotocol/sdk` client, backend spawns/manages servers (stdio + HTTP) | Browser JS can't spawn subprocesses; this has to live server-side regardless of frontend choice |
| STT engine | Qwen3-ASR (via llama-server or standalone) | SOTA open-source ASR (outperforms Whisper v3); runs natively in llama.cpp behind /v1/audio/transcriptions or as a Python subprocess. Abstracted behind a generic STT provider interface. |
| TTS engine | Qwen3-TTS (via qwentts.cpp) | Highest quality open-weight TTS (voice cloning, expressive). Standalone C++17/GGML binary supports CPU, CUDA, Metal, and Vulkan. Abstracted behind a generic TTS provider interface (with OuteTTS via llama-server as a lightweight alternative). |

## Build order

Boring plumbing first, so there's a working chat loop to sanity-check against before any of the harder features get layered on. (theming compatibility should be considered at all steps and is therefore left out)

1. **Scaffolding** — repo with `frontend/` and `backend/`, Vite + shadcn + Tailwind wired up on the frontend, a bare Fastify server on the backend. No features yet, just both sides running and talking to each other. Set up CSS variables for theming.
2. **Core chat loop + backend registry** — backend holds a list of configured inference backends (not just one) and proxies `/v1/chat/completions` (streaming) to whichever is selected; `/api/models` aggregates model lists across all configured backends with optional prefixing. Frontend: message list, input box, streamed response rendering, a simple backend/model picker. No persistence yet — prove the round trip end to end.
3. **Persistence** — SQLite schema for conversations/messages; sidebar with history, load/resume past chats.
4. **Multimodal attachments** — backend reads model capabilities from the user-configured model configuration and gates the UI accordingly; frontend attachment upload, including edit-time add/remove (the one thing worth keeping from Cherry Studio).
5. **Presets (the "one model, many personas" feature)** — backend table for name/avatar/system-prompt/backend+model/sampling-params; frontend preset editor + switcher.
6. **Artifacts** — detect HTML/SVG output, render in the sandboxed iframe side panel, with a toggle to instead show the code in the same side panel.
7. **Auto chat naming** — the three-mode setting (first words / active model / designated model); simplest feature on this list, cheap to slot in once the chat loop exists.
8. **MCP integration** — backend manages MCP server processes and exposes their tools to the model via standard tool-calling; frontend gets a server on/off toggle per conversation and a tool-call transcript in the chat log.
9. **Context-scoped tool routing** — builds directly on the MCP registry from step 8: an optional pre-pass that has a model select relevant tools/skills before the main request is built, keeping unused tool descriptions out of the primary context. The user can of course select any tools they want to force before sending the message, and the context-scoped tool routing is entirely optional as well.
10. **STT/TTS** — Qwen3-ASR for STT and Qwen3-TTS for TTS, each with a CPU/GPU config toggle; voice input/output wired into the chat input and message actions.
11. **Memory/Chat Recall** — toggleable (optional) persistent memory with semantic RAG (e.g., how relevant is this memory to the user's query?) and another toggleable feature where the LLM can use information from previous chats (optionally including archived chats) to be able to better help the user (e.g., are there any messages in any chats that contain relevant information to the user's query?)
12. **Polish** — theming pass specifically aimed at *not* looking like the generic Tailwind-dashboard/"Apple-y" aesthetic everything else landed on, keyboard shortcuts, etc.
