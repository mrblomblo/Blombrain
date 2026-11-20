use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PREFERRED_PORT: u16 = 47300;
const MAX_RECENT_LOGS: usize = 80;

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    shutting_down: AtomicBool,
}

fn generate_launch_secret() -> String {
    let mut bytes = [0u8; 32];
    if getrandom::fill(&mut bytes).is_err() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = ((now >> ((i % 16) * 4)) & 0xff) as u8;
        }
    }
    let mut hex = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    hex
}

fn can_bind_port(port: u16) -> Option<u16> {
    TcpListener::bind(("127.0.0.1", port))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
}

fn pick_stable_port(app_data_dir: &Path) -> u16 {
    let port_file = app_data_dir.join("port");
    if let Ok(contents) = fs::read_to_string(&port_file) {
        if let Ok(saved) = contents.trim().parse::<u16>() {
            if saved >= 1024 && can_bind_port(saved).is_some() {
                return saved;
            }
        }
    }

    let chosen = can_bind_port(PREFERRED_PORT)
        .or_else(|| can_bind_port(0))
        .unwrap_or(PREFERRED_PORT);

    let _ = fs::write(&port_file, chosen.to_string());
    chosen
}

fn resolve_login_shell_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    let mut shell_path = String::new();
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.is_empty() {
            if let Ok(mut child) = Command::new(&shell)
                .args(["-lc", "printf '%s' \"$PATH\""])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                let deadline = Instant::now() + Duration::from_millis(1500);
                loop {
                    if let Ok(Some(status)) = child.try_wait() {
                        if status.success() {
                            if let Some(mut out) = child.stdout.take() {
                                use std::io::Read as _;
                                let _ = out.read_to_string(&mut shell_path);
                            }
                        }
                        break;
                    }
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            }
        }
    }

    let mut merged: Vec<String> = Vec::new();
    let mut push_entries = |raw: &str| {
        for part in raw.split(':') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && !merged.iter().any(|existing| existing == trimmed) {
                merged.push(trimmed.to_string());
            }
        }
    };

    push_entries(&shell_path);
    push_entries(&current);
    if !home.is_empty() {
        push_entries(&format!("{home}/.local/bin:{home}/.cargo/bin"));
    }
    push_entries("/usr/local/bin:/usr/bin:/bin");

    merged.join(":")
}

fn find_resource(resource_dir: &Path, candidates: &[&str]) -> Option<PathBuf> {
    for rel in candidates {
        let p = resource_dir.join(rel);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn push_log(log_ring: &Mutex<VecDeque<String>>, log_file: &Mutex<Option<fs::File>>, line: &str) {
    let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
    if trimmed.is_empty() {
        return;
    }
    if let Ok(mut ring) = log_ring.lock() {
        if ring.len() >= MAX_RECENT_LOGS {
            ring.pop_front();
        }
        ring.push_back(trimmed.to_string());
    }
    if let Ok(mut guard) = log_file.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = writeln!(file, "{trimmed}");
        }
    }
}

fn collect_logs(log_ring: &Mutex<VecDeque<String>>) -> String {
    log_ring
        .lock()
        .map(|ring| ring.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn check_health_tcp(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(250),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let req = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    use std::io::Read as _;
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let text = String::from_utf8_lossy(&buf[..n]);
            text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn shutdown_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    if state.shutting_down.swap(true, Ordering::SeqCst) {
        return;
    }
    let child_opt = state.child.lock().ok().and_then(|mut g| g.take());
    let Some(mut child) = child_opt else {
        return;
    };

    // Signal graceful shutdown over stdin first, then SIGTERM as needed.
    let _ = child.write(b"__BLOMBRAIN_SHUTDOWN__\n");
    let pid = child.pid();
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();

    // Give Fastify/SQLite/MCP and any managed backend processes (llama-server, ollama, ...)
    // up to 8s to shut down before hard kill. The sidecar force-exits after 6s on its own.
    for _ in 0..80 {
        let alive = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !alive {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let _ = child.kill();
}

fn show_splash_error(app: &AppHandle, title: &str, msg: &str, logs: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let t = serde_json::to_string(title).unwrap_or_else(|_| "\"Startup failed\"".to_string());
        let m = serde_json::to_string(msg).unwrap_or_else(|_| "\"\"".to_string());
        let l = serde_json::to_string(logs).unwrap_or_else(|_| "\"\"".to_string());
        let script = format!("window.__blombrainShowError && window.__blombrainShowError({t}, {m}, {l});");
        let _ = window.eval(&script);
    }
}

fn is_allowed_app_origin(url: &tauri::Url, allowed_port: u16, is_dev: bool) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    let port = url.port_or_known_default();

    if scheme == "tauri" || (scheme == "http" && host == "tauri.localhost") {
        return true;
    }
    if scheme == "http" && (host == "127.0.0.1" || host == "localhost") {
        if port == Some(allowed_port) {
            return true;
        }
        if is_dev && port == Some(5173) {
            return true;
        }
    }
    false
}

fn decode_percent(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn sanitize_download_filename(name: &str) -> String {
    let leaf = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download")
        .trim();
    if leaf.is_empty() || leaf == "." || leaf == ".." {
        "download".to_string()
    } else {
        leaf.replace(['/', '\\', '\0'], "_")
    }
}

fn unique_download_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
    let ext = path.extension().and_then(|e| e.to_str());
    for idx in 1..10000u32 {
        let numbered = match ext {
            Some(e) if !e.is_empty() => format!("{stem} ({idx}).{e}"),
            _ => format!("{stem} ({idx})"),
        };
        let next = dir.join(numbered);
        if !next.exists() {
            return next;
        }
    }
    candidate
}

#[tauri::command]
async fn save_download_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let raw_name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .map(decode_percent)
        .unwrap_or_else(|| "download".to_string());
    let filename = sanitize_download_filename(&raw_name);

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(_) => return Err("Expected raw binary payload".to_string()),
    };

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_file_name(&filename)
        .save_file(move |chosen| {
            let path = chosen.and_then(|fp| fp.into_path().ok());
            let _ = tx.try_send(path);
        });

    let Some(chosen_path) = rx.recv().await.flatten() else {
        return Ok(false);
    };

    tauri::async_runtime::spawn_blocking(move || fs::write(&chosen_path, &bytes))
        .await
        .map_err(|e| format!("Save task failed: {e}"))?
        .map_err(|e| format!("Failed to write file: {e}"))?;

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![save_download_bytes]);

    let app = builder
        .setup(|app| {
            let is_dev = cfg!(debug_assertions) || std::env::var("BLOMBRAIN_DEV_EXTERNAL").is_ok();
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let port = if is_dev {
                4300
            } else {
                pick_stable_port(&app_data_dir)
            };

            let app_for_nav = app.handle().clone();
            let main_url = if is_dev {
                WebviewUrl::External("http://localhost:5173".parse()?)
            } else {
                WebviewUrl::App("index.html".into())
            };

            let app_for_dl = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", main_url)
                .title("Blombrain")
                .inner_size(1280.0, 840.0)
                .min_inner_size(720.0, 540.0)
                .resizable(true)
                .decorations(false)
                .transparent(true)
                .disable_drag_drop_handler()
                .on_permission_request(|_webview, kind| match kind {
                    tauri::webview::PermissionKind::Microphone => {
                        tauri::webview::PermissionResponse::Allow
                    }
                    _ => tauri::webview::PermissionResponse::Default,
                })
                .on_navigation(move |url| {
                    if is_allowed_app_origin(url, port, is_dev) {
                        return true;
                    }
                    let scheme = url.scheme();
                    if scheme == "http" || scheme == "https" || scheme == "mailto" {
                        let _ = app_for_nav.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .on_download(move |_webview, event| {
                    // Never block inside on_download on WebKitGTK; doing a synchronous dialog here deadlocks GTK.
                    if let tauri::webview::DownloadEvent::Requested { url: _, destination } = event {
                        if let Ok(download_dir) = app_for_dl.path().download_dir() {
                            let suggested = destination
                                .file_name()
                                .and_then(|n| n.to_str())
                                .map(sanitize_download_filename)
                                .unwrap_or_else(|| "download".to_string());
                            let _ = fs::create_dir_all(&download_dir);
                            *destination = unique_download_path(&download_dir, &suggested);
                        }
                    }
                    true
                })
                .build()?;

            #[cfg(target_os = "linux")]
            {
                let _ = window.with_webview(|platform_webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    let webview = platform_webview.inner();
                    if let Some(settings) = WebViewExt::settings(&webview) {
                        settings.set_enable_media_stream(true);
                    }
                });
            }

            if is_dev {
                return Ok(());
            }

            let log_dir = app.path().app_log_dir().unwrap_or_else(|_| app_data_dir.join("logs"));
            let _ = fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("backend.log");
            let file_handle = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&log_path)
                .ok();

            let log_ring = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_RECENT_LOGS)));
            let log_file = Arc::new(Mutex::new(file_handle));

            let resource_dir = app.path().resource_dir()?;
            let Some(frontend_dist) = find_resource(
                &resource_dir,
                &["resources/frontend", "frontend"],
            ) else {
                show_splash_error(
                    app.handle(),
                    "Missing packaged UI assets",
                    &format!("Could not locate bundled frontend assets inside {}", resource_dir.display()),
                    "",
                );
                return Ok(());
            };

            let Some(sqlite_binding) = find_resource(
                &resource_dir,
                &[
                    "resources/native/better_sqlite3.node",
                    "native/better_sqlite3.node",
                ],
            ) else {
                show_splash_error(
                    app.handle(),
                    "Missing SQLite native addon",
                    &format!("Could not locate better_sqlite3.node inside {}", resource_dir.display()),
                    "",
                );
                return Ok(());
            };

            let launch_secret = generate_launch_secret();
            let resolved_path = resolve_login_shell_path();

            let mut cmd = app.shell().sidecar("blombrain-backend")?
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("BLOMBRAIN_DESKTOP", "1")
                .env("BLOMBRAIN_DATA_DIR", app_data_dir.to_string_lossy().as_ref())
                .env("BLOMBRAIN_SQLITE_BINDING", sqlite_binding.to_string_lossy().as_ref())
                .env("FRONTEND_DIST", frontend_dist.to_string_lossy().as_ref())
                .env("BLOMBRAIN_LAUNCH_SECRET", &launch_secret)
                .env("BLOMBRAIN_PARENT_WATCH", "1")
                .env("PATH", &resolved_path);

            let legacy_migrate_dir = std::env::current_dir()
                .ok()
                .map(|cwd| cwd.join("backend").join("data"))
                .filter(|p| p.join("blombrain.db").exists())
                .or_else(|| {
                    option_env!("BLOMBRAIN_DEFAULT_MIGRATE_DIR")
                        .map(PathBuf::from)
                        .filter(|p| p.join("blombrain.db").exists())
                });

            if let Some(ref legacy_dir) = legacy_migrate_dir {
                cmd = cmd.env("BLOMBRAIN_MIGRATE_FROM", legacy_dir.to_string_lossy().as_ref());
            }

            let (mut rx, child) = cmd.spawn()?;
            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                shutting_down: AtomicBool::new(false),
            });

            let app_handle = app.handle().clone();
            let ready_flag = Arc::new(AtomicBool::new(false));
            let target_url = format!("http://127.0.0.1:{port}/?launch={launch_secret}");

            let ready_for_events = Arc::clone(&ready_flag);
            let logs_for_events = Arc::clone(&log_ring);
            let file_for_events = Arc::clone(&log_file);
            let app_for_events = app_handle.clone();
            let url_for_events = target_url.clone();

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            for line in text.lines() {
                                push_log(&logs_for_events, &file_for_events, line);
                                if line.contains(&format!("BLOMBRAIN_READY port={port}"))
                                    && !ready_for_events.swap(true, Ordering::SeqCst)
                                {
                                    if let Some(win) = app_for_events.get_webview_window("main") {
                                        if let Ok(parsed) = url_for_events.parse::<tauri::Url>() {
                                            let _ = win.navigate(parsed);
                                        }
                                    }
                                }
                            }
                        }
                        CommandEvent::Error(err) => {
                            push_log(&logs_for_events, &file_for_events, &format!("[sidecar error] {err}"));
                        }
                        CommandEvent::Terminated(payload) => {
                            push_log(
                                &logs_for_events,
                                &file_for_events,
                                &format!("[sidecar terminated code={:?} signal={:?}]", payload.code, payload.signal),
                            );
                            if !ready_for_events.swap(true, Ordering::SeqCst) {
                                let logs_text = collect_logs(&logs_for_events);
                                show_splash_error(
                                    &app_for_events,
                                    "Backend exited during startup",
                                    "The local Blombrain backend stopped before becoming ready.",
                                    &logs_text,
                                );
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Backup HTTP health poll and 30s timeout guard
            let ready_for_poll = Arc::clone(&ready_flag);
            let logs_for_poll = Arc::clone(&log_ring);
            tauri::async_runtime::spawn(async move {
                let deadline = Instant::now() + Duration::from_secs(30);
                while !ready_for_poll.load(Ordering::SeqCst) {
                    if Instant::now() >= deadline {
                        if !ready_for_poll.swap(true, Ordering::SeqCst) {
                            let logs_text = collect_logs(&logs_for_poll);
                            show_splash_error(
                                &app_handle,
                                "Backend startup timed out",
                                &format!("Timed out waiting 30s for http://127.0.0.1:{port}/api/health."),
                                &logs_text,
                            );
                        }
                        break;
                    }
                    if check_health_tcp(port) && !ready_for_poll.swap(true, Ordering::SeqCst) {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            if let Ok(parsed) = target_url.parse::<tauri::Url>() {
                                let _ = win.navigate(parsed);
                            }
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Blombrain desktop application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            shutdown_sidecar(app_handle);
        }
    });
}
