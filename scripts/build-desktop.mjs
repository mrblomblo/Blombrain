import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };

// Avoid linuxdeploy strip failures on Arch/modern rolling distros with RELR ELF sections
if (!env.NO_STRIP) {
  env.NO_STRIP = "1";
}

// Reuse cached AppImage runtime if present (fixes static appimagetool curl cert issues on Arch)
const cachedRuntime = path.join(os.homedir(), ".cache", "tauri", "runtime-x86_64");
if (!env.LDAI_RUNTIME_FILE && fs.existsSync(cachedRuntime)) {
  env.LDAI_RUNTIME_FILE = cachedRuntime;
}

const tauriBin = path.join(rootDir, "node_modules", ".bin", "tauri");
const extraArgs = process.argv.slice(2);
const result = spawnSync(tauriBin, ["build", ...extraArgs], {
  cwd: rootDir,
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
