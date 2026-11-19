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
    tauri_build::build()
}
