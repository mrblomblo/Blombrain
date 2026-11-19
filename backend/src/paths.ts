import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __filename: string | undefined;

function getModuleDir(): string {
  // In CJS bundles (including Node SEA), __filename is defined whereas import.meta.url is undefined.
  if (typeof __filename === "string" && __filename.length > 0) {
    return path.dirname(__filename);
  }
  try {
    if (import.meta?.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch { }
  return process.cwd();
}

const MODULE_DIR = getModuleDir();

/**
 * Resolves the root of the backend directory in dev/compiled ESM execution.
 */
export const BACKEND_ROOT = path.resolve(MODULE_DIR, "..");

/**
 * Primary persistent data directory (database, uploads, skills, backups).
 * Always prefers BLOMBRAIN_DATA_DIR when set (e.g., Tauri desktop app_data_dir).
 */
export const DATA_DIR =
  process.env.BLOMBRAIN_DATA_DIR ?? path.join(BACKEND_ROOT, "data");

/**
 * Optional directory from which an existing SQLite database and files are
 * migrated on first desktop launch if DATA_DIR does not yet contain a database.
 */
export const MIGRATE_FROM_DIR =
  process.env.BLOMBRAIN_MIGRATE_FROM &&
  existsSync(path.join(process.env.BLOMBRAIN_MIGRATE_FROM, "blombrain.db"))
    ? path.resolve(process.env.BLOMBRAIN_MIGRATE_FROM)
    : null;

/**
 * Path to the built frontend static directory.
 */
export const FRONTEND_DIST =
  process.env.FRONTEND_DIST ??
  path.resolve(BACKEND_ROOT, "..", "frontend", "dist");
