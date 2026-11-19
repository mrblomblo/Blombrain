import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const backend = spawn("npm", ["--prefix", "backend", "run", "dev"], {
  cwd: rootDir,
  stdio: "inherit",
});

const frontend = spawn("npm", ["--prefix", "frontend", "run", "dev"], {
  cwd: rootDir,
  stdio: "inherit",
});

function shutdown(code = 0) {
  try { backend.kill("SIGTERM"); } catch { }
  try { frontend.kill("SIGTERM"); } catch { }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

backend.on("exit", (code) => {
  if (code && code !== 0) shutdown(code);
});
frontend.on("exit", (code) => {
  if (code && code !== 0) shutdown(code);
});
