import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const backendEntry = path.join(rootDir, "backend", "dist", "server.js");
const bundleOut = path.join(rootDir, "backend", "dist", "bundle.cjs");
const seaConfigPath = path.join(rootDir, "backend", "dist", "sea-config.json");
const seaBlobPath = path.join(rootDir, "backend", "dist", "sea-prep.blob");

const tauriDir = path.join(rootDir, "src-tauri");
const binariesDir = path.join(tauriDir, "binaries");
const nativeResDir = path.join(tauriDir, "resources", "native");
const frontendResDir = path.join(tauriDir, "resources", "frontend");
const frontendDistDir = path.join(rootDir, "frontend", "dist");

function getLinuxTriple() {
  if (process.platform !== "linux") {
    throw new Error(`This desktop build currently targets Linux only (got ${process.platform})`);
  }
  if (process.arch === "x64") return "x86_64-unknown-linux-gnu";
  if (process.arch === "arm64") return "aarch64-unknown-linux-gnu";
  throw new Error(`Unsupported Linux architecture: ${process.arch}`);
}

/**
 * Finds a portable Node 24 binary (official nodejs.org build) for SEA injection.
 * System-packaged Node binaries (like Arch /usr/bin/node) are often stripped and
 * dynamically linked against distro-specific shared libraries, which breaks postject
 * and portability across distros.
 */
function resolvePortableNode24() {
  if (process.env.BLOMBRAIN_NODE_BIN && fs.existsSync(process.env.BLOMBRAIN_NODE_BIN)) {
    return process.env.BLOMBRAIN_NODE_BIN;
  }

  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  const nvmVersions = path.join(nvmDir, "versions", "node");
  if (fs.existsSync(nvmVersions)) {
    const candidates = fs
      .readdirSync(nvmVersions)
      .filter((d) => /^v24\./.test(d))
      .sort()
      .reverse();
    for (const dir of candidates) {
      const bin = path.join(nvmVersions, dir, "bin", "node");
      if (fs.existsSync(bin)) {
        return bin;
      }
    }
  }

  return process.execPath;
}

async function main() {
  if (!fs.existsSync(backendEntry)) {
    throw new Error(`Missing ${backendEntry}. Run 'npm run build:backend' first.`);
  }
  if (!fs.existsSync(path.join(frontendDistDir, "index.html"))) {
    throw new Error(`Missing ${frontendDistDir}/index.html. Run 'npm run build:frontend' first.`);
  }

  console.log("[sidecar] Bundling backend with esbuild -> CJS...");
  await build({
    entryPoints: [backendEntry],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    outfile: bundleOut,
    // sqlite-vec is loaded dynamically when available, falling back to pure-TS ranking.
    external: ["sqlite-vec"],
    define: {
      "import.meta.url": "undefined",
    },
    logLevel: "warning",
  });

  const nodeBin = resolvePortableNode24();
  console.log(`[sidecar] Using Node runtime for SEA: ${nodeBin}`);

  console.log("[sidecar] Generating Node SEA prep blob...");
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundleOut,
        output: seaBlobPath,
        disableExperimentalSEAWarning: true,
      },
      null,
      2
    )
  );
  execFileSync(nodeBin, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
  });

  const triple = getLinuxTriple();
  const sidecarPath = path.join(binariesDir, `blombrain-backend-${triple}`);
  fs.mkdirSync(binariesDir, { recursive: true });
  fs.copyFileSync(nodeBin, sidecarPath);
  fs.chmodSync(sidecarPath, 0o755);

  console.log(`[sidecar] Injecting SEA blob into ${path.relative(rootDir, sidecarPath)}...`);
  const postjectBin = path.join(rootDir, "node_modules", ".bin", "postject");
  execFileSync(
    postjectBin,
    [
      sidecarPath,
      "NODE_SEA_BLOB",
      seaBlobPath,
      "--sentinel-fuse",
      "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ],
    { stdio: "inherit" }
  );

  // Copy native better_sqlite3 addon into bundled Tauri resources
  const sqliteAddonSrc = path.join(
    rootDir,
    "backend",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(sqliteAddonSrc)) {
    throw new Error(`Missing native SQLite binding at ${sqliteAddonSrc}`);
  }
  fs.mkdirSync(nativeResDir, { recursive: true });
  fs.copyFileSync(sqliteAddonSrc, path.join(nativeResDir, "better_sqlite3.node"));

  // Sync built Svelte frontend assets into Tauri resources/frontend
  console.log("[sidecar] Copying frontend/dist into src-tauri/resources/frontend...");
  fs.rmSync(frontendResDir, { recursive: true, force: true });
  fs.mkdirSync(frontendResDir, { recursive: true });
  fs.cpSync(frontendDistDir, frontendResDir, { recursive: true });

  // Copy third-party license notices into bundled resources
  const licensesSrc = path.join(rootDir, "LICENSES.md");
  if (fs.existsSync(licensesSrc)) {
    fs.copyFileSync(licensesSrc, path.join(tauriDir, "resources", "LICENSES.md"));
  }

  console.log("[sidecar] Desktop sidecar and resource bundle ready.");
}

main().catch((err) => {
  console.error("[sidecar] Build failed:", err);
  process.exit(1);
});
