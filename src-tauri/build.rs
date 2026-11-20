use std::path::PathBuf;

fn main() {
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest_dir)
            .join("..")
            .join("backend")
            .join("data");
        if let Ok(canon) = candidate.canonicalize() {
            println!(
                "cargo:rustc-env=BLOMBRAIN_DEFAULT_MIGRATE_DIR={}",
                canon.display()
            );
        }
    }
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "save_download_bytes",
                "read_dropped_files",
                "start_audio_recording",
                "stop_audio_recording",
                "open_external_url",
            ]),
        ),
    )
    .expect("error while running tauri build");
}
