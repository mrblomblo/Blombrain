## 1. Bundle the backend to a single CJS file

Node SEA (single executable apps) wants one flat file, and works most reliably with CommonJS. If your backend build already outputs ESM `dist/index.js`, add an esbuild bundling step to flatten it to CJS first:

```bash
npx esbuild backend/dist/index.js --bundle --platform=node --format=cjs \
  --outfile=backend/dist/bundle.cjs --external:fastify
```
(Adjust `--external` for any packages with native bits under the hood — you said none, but worth double-checking transitive deps like some logger transports.)

## 2. Turn that into a SEA binary — and the nice trick: you don't need per-OS compilation

```json
// sea-config.json
{
  "main": "backend/dist/bundle.cjs",
  "output": "backend/dist/sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
```

```bash
node --experimental-sea-config sea-config.json
```

This produces a blob, not a binary. The binary comes from **injecting that blob into a copy of a `node` executable** — and since `postject` just edits binary sections rather than compiling anything, you can inject into the Linux, macOS, *and* Windows Node executables all from one machine. Download the three official Node tarballs/zips for your Node major version from nodejs.org, copy each, and postject the same blob into each:

```bash
# repeat per platform, using that platform's official node binary
cp node-v24.x.x-linux-x64/bin/node   src-tauri/binaries/blombrain-backend-x86_64-unknown-linux-gnu
npx postject src-tauri/binaries/blombrain-backend-x86_64-unknown-linux-gnu NODE_SEA_BLOB \
  backend/dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  [--macho-segment-name NODE_SEA on macOS]
```

Naming must match Rust's target triple exactly, since that's the convention Tauri's sidecar bundling expects:
- `blombrain-backend-x86_64-unknown-linux-gnu`
- `blombrain-backend-x86_64-apple-darwin` / `blombrain-backend-aarch64-apple-darwin`
- `blombrain-backend-x86_64-pc-windows-msvc.exe`

This means **your whole backend-packaging step can run in one Linux CI job** even though it targets all three OSes — only the Tauri/Rust shell itself needs to actually build on (or cross-compile for) each target OS.

## 3. tauri.conf.json — register the sidecar

```json
{
  "bundle": {
    "externalBin": ["binaries/blombrain-backend"],
    "targets": ["appimage", "deb", "dmg", "msi", "nsis"]
  },
  "app": {
    "windows": [{ "url": "index.html" }]
  }
}
```

`frontendDist` should point at your Svelte `dist/` build directly — Tauri serves that as the app's own assets, so you don't need the backend to serve the frontend at all anymore. The backend becomes API-only, which also simplifies it (drop the static-file-serving branch if your Fastify setup has one).

v2 capabilities need explicit permission to spawn it, e.g. in `src-tauri/capabilities/default.json`:
```json
{ "permissions": ["shell:allow-execute"] }
```

## 4. Rust side — spawn on startup, pick a free port, wait for readiness

```rust
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command]
async fn get_backend_port(state: tauri::State<'_, BackendPort>) -> Result<u16, String> {
    Ok(state.0)
}

// in setup():
let port = pick_free_port(); // e.g. via std::net::TcpListener bound to :0
let (mut rx, _child) = app.shell()
    .sidecar("blombrain-backend")?
    .env("PORT", port.to_string())
    .spawn()?;

app.manage(BackendPort(port));

tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line) = event { /* log it, or pipe through your formatter */ }
    }
});
```

Frontend fetches the assigned port once at startup via `invoke('get_backend_port')` instead of hardcoding 4300 — avoids port clashes if the user runs multiple instances or something else is already listening. Poll a `/health` endpoint (or just retry connect) before your Svelte app starts hitting the API, same as you'd do in dev mode today.

On exit, kill the child (Tauri's shell plugin's `Child` handle has `.kill()`) — mirrors your `on_exit`/trap logic in `run-linux.sh` almost exactly.

## 5. Multi-OS builds via CI

`tauri-action` (official GitHub Action) with a matrix of `ubuntu-latest` / `macos-latest` / `windows-latest` runners handles the Rust-side cross-building correctly, producing `.AppImage`+`.deb` / `.dmg` / `.msi`+`.exe` per OS in one workflow run. Your sidecar-binary step (from #2) just needs to run once beforehand and drop all three named binaries into `src-tauri/binaries/` before `tauri build` runs on each runner.

Two things to flag honestly since they'll bite you regardless of Electron vs. Tauri:
- **macOS** wants your app signed + notarized or Gatekeeper will complain hard on first launch (an Apple Developer account, $99/yr).
- **Windows** SmartScreen will warn on unsigned installers too, though it's a softer warning than macOS's block.

Neither is Tauri-specific — same story for Electron — but worth knowing up front if you want a smooth first-run experience.
