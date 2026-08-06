import db from "../src/db.js";

console.log("[blombrain] Resetting password...");

try {
  db.prepare("UPDATE global_settings SET password_hash = NULL WHERE id = 'default'").run();
  db.prepare("DELETE FROM auth_sessions").run();
  console.log("[blombrain] Password has been successfully reset and all sessions cleared.");
  console.log("[blombrain] Authentication is now disabled.");
} catch (err) {
  console.error("[blombrain] Failed to reset password:", err);
  process.exit(1);
}
