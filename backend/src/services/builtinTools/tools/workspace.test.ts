import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmpTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blombrain-ws-test-"));
const testDataDir = path.join(tmpTestRoot, "data");
process.env.BLOMBRAIN_DATA_DIR = testDataDir;

// Use dynamic imports AFTER setting BLOMBRAIN_DATA_DIR because static ESM imports
// are hoisted and would otherwise open the real backend/data/blombrain.db.
const { default: db, DATA_DIR } = await import("../../../db.js");
assert.equal(
  path.resolve(DATA_DIR),
  path.resolve(testDataDir),
  "Tests must run against an isolated temporary BLOMBRAIN_DATA_DIR, never production data",
);

const {
  validateWorkspaceDirectory,
  resolveWorkspacePath,
  resolveEffectiveWorkspace,
  listWorkspaceEntries,
  isSensitiveWorkspacePath,
  revertWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  getWorkspaceGitStatus,
  getWorkspaceGitDiff,
} = await import("./workspaceUtils.js");
const {
  workspaceListToolDef,
  workspaceSearchToolDef,
  workspaceReadToolDef,
  workspaceEditToolDef,
  workspaceWriteToolDef,
  workspaceDeleteToolDef,
  workspaceRenameToolDef,
  workspaceRunToolDef,
} = await import("./workspaceTools.js");
const { builtInToolRegistry } = await import("../index.js");
const { resolveToolApproval } = await import("../../toolApproval.js");
const { routeToolsAndSkills } = await import("../../toolRouter.js");
const { getAllPromptTemplates } = await import("../../../routes/promptTemplates.js");

describe("Workspace Attachment & Security Utilities", () => {
  let wsDirA: string;
  let wsDirB: string;
  let outsideDir: string;
  let outsideSecretFile: string;

  before(() => {
    wsDirA = path.join(tmpTestRoot, "project-a");
    wsDirB = path.join(tmpTestRoot, "project-b");
    outsideDir = path.join(tmpTestRoot, "outside");
    fs.mkdirSync(path.join(wsDirA, "src"), { recursive: true });
    fs.mkdirSync(path.join(wsDirA, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(wsDirA, ".git"), { recursive: true });
    fs.mkdirSync(wsDirB, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(
      path.join(wsDirA, "src", "main.ts"),
      "export function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(wsDirA, ".env"), "SECRET_API_KEY=supersecret\n", "utf-8");
    fs.writeFileSync(path.join(wsDirA, "example.env"), "SECRET_API_KEY=placeholder\n", "utf-8");
    fs.writeFileSync(path.join(wsDirA, ".env.example"), "PORT=4300\n", "utf-8");
    fs.writeFileSync(path.join(wsDirA, "id_rsa"), "PRIVATE KEY", "utf-8");
    fs.writeFileSync(path.join(wsDirA, ".git", "config"), "[core]\n", "utf-8");
    fs.writeFileSync(
      path.join(wsDirA, "node_modules", "pkg", "index.js"),
      "module.exports = {};\n",
      "utf-8",
    );

    outsideSecretFile = path.join(outsideDir, "outside-secret.txt");
    fs.writeFileSync(outsideSecretFile, "TOP SECRET OUTSIDE WORKSPACE\n", "utf-8");

    try {
      fs.symlinkSync(outsideSecretFile, path.join(wsDirA, "src", "escape-link.txt"));
      fs.symlinkSync(outsideDir, path.join(wsDirA, "outside-dir-link"));
    } catch {
      // Symlinks might require privileges on some Windows setups, always available on Linux/macOS
    }
  });

  after(() => {
    try {
      fs.rmSync(tmpTestRoot, { recursive: true, force: true });
    } catch { }
  });

  test("rejects blocked system roots and nonexistent directories", () => {
    for (const sysPath of ["/", "/etc", "/proc", "/usr", "/var"]) {
      if (fs.existsSync(sysPath)) {
        const res = validateWorkspaceDirectory(sysPath);
        assert.equal(res.ok, false, `Expected ${sysPath} to be rejected`);
      }
    }

    const missing = validateWorkspaceDirectory(path.join(tmpTestRoot, "does-not-exist"));
    assert.equal(missing.ok, false);

    const fileInsteadOfDir = validateWorkspaceDirectory(path.join(wsDirA, "src", "main.ts"));
    assert.equal(fileInsteadOfDir.ok, false);

    const valid = validateWorkspaceDirectory(wsDirA);
    assert.equal(valid.ok, true);
  });

  test("rejects lexical traversal and symlink escapes outside workspace root", () => {
    assert.throws(() => resolveWorkspacePath(wsDirA, "../outside/outside-secret.txt"), /Access denied/);
    assert.throws(() => resolveWorkspacePath(wsDirA, "/etc/passwd"), /Access denied/);
    assert.throws(() => resolveWorkspacePath(wsDirA, "src/\0main.ts"), /Invalid/);

    const symlinkPath = path.join(wsDirA, "src", "escape-link.txt");
    if (fs.existsSync(symlinkPath)) {
      assert.throws(
        () => resolveWorkspacePath(wsDirA, "src/escape-link.txt"),
        /Access denied.*outside the attached workspace/,
      );
    }
  });

  test("protects .env and credential files while allowing example.env / .env.example", () => {
    assert.equal(isSensitiveWorkspacePath(".env"), true);
    assert.equal(isSensitiveWorkspacePath(".env.local"), true);
    assert.equal(isSensitiveWorkspacePath("config/.env.production"), true);
    assert.equal(isSensitiveWorkspacePath("id_rsa"), true);
    assert.equal(isSensitiveWorkspacePath("certs/server.pem"), true);
    assert.equal(isSensitiveWorkspacePath(".git/config"), true);

    assert.equal(isSensitiveWorkspacePath("example.env"), false);
    assert.equal(isSensitiveWorkspacePath(".env.example"), false);

    assert.throws(() => resolveWorkspacePath(wsDirA, ".env"), /protected secret/);
    assert.throws(() => resolveWorkspacePath(wsDirA, "id_rsa"), /protected secret/);

    const exampleResolved = resolveWorkspacePath(wsDirA, "example.env");
    assert.equal(exampleResolved.relPath, "example.env");

    const { entries } = listWorkspaceEntries(wsDirA, { includeDirs: false });
    const paths = entries.map((e) => e.path);
    assert.ok(paths.includes("src/main.ts"));
    assert.ok(paths.includes("example.env"));
    assert.ok(paths.includes(".env.example"));
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes("id_rsa"));
    assert.ok(!paths.includes("src/escape-link.txt"));
    assert.ok(!paths.some((p) => p.startsWith("node_modules/")));
    assert.ok(!paths.some((p) => p.startsWith(".git/")));
  });

  test("enforces read-only mode vs read-write mode on built-in workspace tools", async () => {
    const readOnlyCtx = { workspacePath: wsDirA, workspaceWriteEnabled: false };
    const readOnlyTools = builtInToolRegistry
      .getAvailableTools(readOnlyCtx)
      .filter((t) => t.category === "workspace")
      .map((t) => t.name);

    assert.deepEqual(
      readOnlyTools.sort(),
      ["workspace_list", "workspace_read", "workspace_search"],
    );

    const deniedEdit = await workspaceEditToolDef.execute(
      { path: "src/main.ts", target: "Hello", replacement: "Hi" },
      readOnlyCtx,
    );
    assert.equal(deniedEdit.isError, true);
    assert.match(deniedEdit.content, /read-only mode/i);

    const deniedWrite = await workspaceWriteToolDef.execute(
      { path: "src/new.ts", content: "export const x = 1;\n" },
      readOnlyCtx,
    );
    assert.equal(deniedWrite.isError, true);
    assert.match(deniedWrite.content, /read-only mode/i);

    // Enable write mode
    const readWriteCtx = { workspacePath: wsDirA, workspaceWriteEnabled: true };
    const readWriteTools = builtInToolRegistry
      .getAvailableTools(readWriteCtx)
      .filter((t) => t.category === "workspace")
      .map((t) => t.name);

    assert.deepEqual(
      readWriteTools.sort(),
      [
        "workspace_delete",
        "workspace_edit",
        "workspace_list",
        "workspace_read",
        "workspace_rename",
        "workspace_run",
        "workspace_search",
        "workspace_write",
      ],
    );

    const writeRes = await workspaceWriteToolDef.execute(
      { path: "src/utils/helper.ts", content: "export const VERSION = '1.0.0';\n" },
      readWriteCtx,
    );
    assert.ok(!writeRes.isError, writeRes.content);
    assert.match(writeRes.content, /\+\+\+ b\/src\/utils\/helper\.ts/);
    assert.match(writeRes.content, /\+export const VERSION = '1\.0\.0';/);

    const editRes = await workspaceEditToolDef.execute(
      {
        path: "src/utils/helper.ts",
        target: "VERSION = '1.0.0'",
        replacement: "VERSION = '2.0.0'",
      },
      readWriteCtx,
    );
    assert.ok(!editRes.isError, editRes.content);
    assert.match(editRes.content, /--- a\/src\/utils\/helper\.ts/);
    assert.match(editRes.content, /-export const VERSION = '1\.0\.0';/);
    assert.match(editRes.content, /\+export const VERSION = '2\.0\.0';/);

    const readRes = await workspaceReadToolDef.execute(
      { path: "src/utils/helper.ts", start_line: 1, end_line: 5 },
      readWriteCtx,
    );
    assert.ok(!readRes.isError);
    assert.match(readRes.content, /VERSION = '2\.0\.0'/);

    const searchRes = await workspaceSearchToolDef.execute(
      { query: "VERSION", file_pattern: "*.ts" },
      readWriteCtx,
    );
    assert.ok(!searchRes.isError);
    assert.match(searchRes.content, /src\/utils\/helper\.ts:1:/);

    const listRes = await workspaceListToolDef.execute({ path: "src" }, readWriteCtx);
    assert.ok(!listRes.isError);
    assert.match(listRes.content, /main\.ts/);
  });

  test("resolves folder-to-conversation workspace inheritance and per-chat override", () => {
    const now = Date.now();
    const folderId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const realA = fs.realpathSync(wsDirA);
    const realB = fs.realpathSync(wsDirB);

    db.prepare(
      `INSERT INTO folders (id, name, description, is_expanded, workspace_path, workspace_write_enabled, created_at, updated_at)
       VALUES (?, 'Project A Folder', '', 1, ?, 0, ?, ?)`,
    ).run(folderId, realA, now, now);

    db.prepare(
      `INSERT INTO conversations (id, title, model, created_at, updated_at, folder_id, folder, workspace_path, workspace_write_enabled)
       VALUES (?, 'Chat in Folder', null, ?, ?, ?, 'Project A Folder', NULL, 0)`,
    ).run(convId, now, now, folderId);

    // 1. Inherits workspace from parent folder when conversation.workspace_path is NULL
    const inherited = resolveEffectiveWorkspace(convId);
    assert.equal(inherited.path, realA);
    assert.equal(inherited.writeEnabled, false);
    assert.equal(inherited.source, "folder");

    // 2. Per-conversation override takes precedence over folder workspace
    db.prepare(
      "UPDATE conversations SET workspace_path = ?, workspace_write_enabled = 1 WHERE id = ?",
    ).run(realB, convId);

    const overridden = resolveEffectiveWorkspace(convId);
    assert.equal(overridden.path, realB);
    assert.equal(overridden.writeEnabled, true);
    assert.equal(overridden.source, "conversation");

    // 3. Clearing conversation override falls back to parent folder workspace
    db.prepare(
      "UPDATE conversations SET workspace_path = NULL, workspace_write_enabled = 0 WHERE id = ?",
    ).run(convId);

    const reverted = resolveEffectiveWorkspace(convId);
    assert.equal(reverted.path, realA);
    assert.equal(reverted.writeEnabled, false);
    assert.equal(reverted.source, "folder");
  });

  test("respects .gitignore rules while keeping secret protections enforced", () => {
    const gitWs = path.join(tmpTestRoot, "gitignore-project");
    fs.mkdirSync(path.join(gitWs, "coverage"), { recursive: true });
    fs.mkdirSync(path.join(gitWs, "logs"), { recursive: true });
    fs.mkdirSync(path.join(gitWs, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(gitWs, ".gitignore"),
      "# ignore coverage and logs\ncoverage/\n*.log\n!important.log\n!.env\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(gitWs, "coverage", "report.html"), "<html></html>", "utf-8");
    fs.writeFileSync(path.join(gitWs, "logs", "debug.log"), "debug", "utf-8");
    fs.writeFileSync(path.join(gitWs, "logs", "important.log"), "keep", "utf-8");
    fs.writeFileSync(path.join(gitWs, "src", "app.ts"), "export const ok = true;\n", "utf-8");
    fs.writeFileSync(path.join(gitWs, ".env"), "API_KEY=secret\n", "utf-8");

    const { entries } = listWorkspaceEntries(gitWs, { includeDirs: false });
    const paths = entries.map((e) => e.path);

    assert.ok(paths.includes("src/app.ts"));
    assert.ok(paths.includes("logs/important.log"), "Negated !important.log should be visible");
    assert.ok(!paths.includes("logs/debug.log"), "*.log should be ignored");
    assert.ok(!paths.some((p) => p.startsWith("coverage/")), "coverage/ should be ignored");
    assert.ok(!paths.includes(".env"), "!.env in .gitignore must never bypass secret protection");
  });

  test("supports human-in-the-loop approval mode (ask), checkpoints, revert, delete, rename, and workspace_run", async () => {
    const now = Date.now();
    const convId = crypto.randomUUID();
    const realB = fs.realpathSync(wsDirB);

    db.prepare(
      `INSERT INTO conversations (id, title, model, created_at, updated_at, workspace_path, workspace_write_enabled, workspace_approval_mode)
       VALUES (?, 'Checkpoint & Approval Chat', null, ?, ?, ?, 1, 'ask')`,
    ).run(convId, now, now, realB);

    // 1. Test 'ask' mode rejection
    const rejectedEvents: any[] = [];
    const rejectCallId = "call_reject_1";
    const rejectPromise = workspaceWriteToolDef.execute(
      { path: "rejected.txt", content: "should not be written\n" },
      {
        conversationId: convId,
        callId: rejectCallId,
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "ask",
        emitEvent: (type, payload) => {
          rejectedEvents.push({ type, ...payload });
          if (payload.status === "awaiting_approval") {
            setImmediate(() => resolveToolApproval(rejectCallId, "rejected"));
          }
        },
      },
    );
    const rejectRes = await rejectPromise;
    assert.equal(rejectRes.isError, true);
    assert.equal(fs.existsSync(path.join(realB, "rejected.txt")), false);
    assert.ok(rejectedEvents.some((e) => e.status === "awaiting_approval" && e.diffPreview));

    // 2. Test 'ask' mode approval + checkpoint creation
    const approveCallId = "call_approve_1";
    const approveRes = await workspaceWriteToolDef.execute(
      { path: "notes.txt", content: "line 1\nline 2\n" },
      {
        conversationId: convId,
        callId: approveCallId,
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "ask",
        emitEvent: (_type, payload) => {
          if (payload.status === "awaiting_approval") {
            setImmediate(() => resolveToolApproval(approveCallId, "approved"));
          }
        },
      },
    );
    assert.ok(!approveRes.isError, approveRes.content);
    assert.ok(approveRes.checkpointId, "Expected checkpointId after approved write");
    assert.equal(fs.readFileSync(path.join(realB, "notes.txt"), "utf-8"), "line 1\nline 2\n");

    // 3. Test edit + revert edit checkpoint + artifact registration
    const artifactEvents: any[] = [];
    const editRes = await workspaceEditToolDef.execute(
      { path: "notes.txt", target: "line 2", replacement: "line 2 modified" },
      {
        conversationId: convId,
        callId: "call_edit_1",
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "auto",
        emitEvent: (type, payload) => {
          if (type === "artifact_created") artifactEvents.push(payload);
        },
      },
    );
    assert.ok(!editRes.isError);
    assert.ok(editRes.checkpointId);
    assert.equal(fs.readFileSync(path.join(realB, "notes.txt"), "utf-8"), "line 1\nline 2 modified\n");
    assert.equal(artifactEvents.length, 1);
    assert.equal(artifactEvents[0].filename, "notes.txt");
    const artAfterEdit = db
      .prepare<[string, string], { id: string; disk_path: string }>(
        "SELECT id, disk_path FROM artifacts WHERE conversation_id = ? AND filename = ?",
      )
      .get(convId, "notes.txt");
    assert.ok(artAfterEdit, "Expected edited workspace file to be registered in artifacts table");
    assert.equal(artAfterEdit.disk_path, path.join(realB, "notes.txt"));

    revertWorkspaceCheckpoint(convId, editRes.checkpointId!);
    assert.equal(fs.readFileSync(path.join(realB, "notes.txt"), "utf-8"), "line 1\nline 2\n");

    // 4. Test rename + revert rename checkpoint (updates artifact filename)
    const renameRes = await workspaceRenameToolDef.execute(
      { from_path: "notes.txt", to_path: "sub/notes-renamed.txt" },
      {
        conversationId: convId,
        callId: "call_rename_1",
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "auto",
      },
    );
    assert.ok(!renameRes.isError, renameRes.content);
    assert.equal(fs.existsSync(path.join(realB, "notes.txt")), false);
    assert.equal(fs.existsSync(path.join(realB, "sub", "notes-renamed.txt")), true);
    const artAfterRename = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM artifacts WHERE conversation_id = ? AND filename = ?",
      )
      .get(convId, "sub/notes-renamed.txt");
    assert.ok(artAfterRename, "Renamed workspace file should be registered under new path in artifacts");

    revertWorkspaceCheckpoint(convId, renameRes.checkpointId!);
    assert.equal(fs.existsSync(path.join(realB, "notes.txt")), true);
    assert.equal(fs.existsSync(path.join(realB, "sub", "notes-renamed.txt")), false);

    // 5. Test delete + revert delete checkpoint (removes and restores artifact row)
    const deleteRes = await workspaceDeleteToolDef.execute(
      { path: "notes.txt" },
      {
        conversationId: convId,
        callId: "call_delete_1",
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "auto",
      },
    );
    assert.ok(!deleteRes.isError, deleteRes.content);
    assert.equal(fs.existsSync(path.join(realB, "notes.txt")), false);
    const artAfterDelete = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM artifacts WHERE conversation_id = ? AND filename = ?",
      )
      .get(convId, "notes.txt");
    assert.equal(artAfterDelete, undefined, "Deleted workspace file should be removed from artifacts table");

    revertWorkspaceCheckpoint(convId, deleteRes.checkpointId!);
    assert.equal(fs.readFileSync(path.join(realB, "notes.txt"), "utf-8"), "line 1\nline 2\n");
    const artAfterRevertDelete = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM artifacts WHERE conversation_id = ? AND filename = ?",
      )
      .get(convId, "notes.txt");
    assert.ok(artAfterRevertDelete, "Reverting delete should re-register workspace file in artifacts table");

    const allCheckpoints = listWorkspaceCheckpoints(convId);
    assert.equal(allCheckpoints.length, 4);

    // 6. Test workspace_run with user approval
    const runCallId = "call_run_1";
    const runRes = await workspaceRunToolDef.execute(
      { command: "node -e \"console.log('WORKSPACE_RUN_OK')\"", cwd: "." },
      {
        conversationId: convId,
        callId: runCallId,
        workspacePath: realB,
        workspaceWriteEnabled: true,
        emitEvent: (_type, payload) => {
          if (payload.status === "awaiting_approval") {
            setImmediate(() => resolveToolApproval(runCallId, "approved"));
          }
        },
      },
    );
    assert.ok(!runRes.isError, runRes.content);
    assert.match(runRes.content, /Exit code: 0/);
    assert.match(runRes.content, /WORKSPACE_RUN_OK/);

    // 7. Verify default prompt templates are seeded
    const templates = getAllPromptTemplates();
    const names = templates.map((t) => t.name);
    assert.ok(names.includes("review"));
    assert.ok(names.includes("tests"));
    assert.ok(names.includes("explain"));

    // 8. Verify checkpoint diffPreview filtering by relPath
    const notesCheckpoints = listWorkspaceCheckpoints(convId, {
      relPath: "notes.txt",
      includeDiff: true,
    });
    assert.ok(notesCheckpoints.length >= 2);
    assert.ok(notesCheckpoints.some((cp) => cp.diffPreview && cp.diffPreview.includes("notes.txt")));

    // 9. Verify Approve All (Turn) bypasses subsequent file prompts in the same turn
    let turnApproved = false;
    let promptCount = 0;
    const callAll1 = "call_all_1";
    const writeAll1 = await workspaceWriteToolDef.execute(
      { path: "batch1.txt", content: "one\n" },
      {
        conversationId: convId,
        callId: callAll1,
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "ask",
        isTurnWriteApproved: () => turnApproved,
        markTurnWriteApproved: () => {
          turnApproved = true;
        },
        emitEvent: (_type, payload) => {
          if (payload.status === "awaiting_approval") {
            promptCount++;
            setImmediate(() => resolveToolApproval(callAll1, "approved_all_turn"));
          }
        },
      },
    );
    assert.ok(!writeAll1.isError, writeAll1.content);
    assert.equal(turnApproved, true);

    const writeAll2 = await workspaceWriteToolDef.execute(
      { path: "batch2.txt", content: "two\n" },
      {
        conversationId: convId,
        callId: "call_all_2",
        workspacePath: realB,
        workspaceWriteEnabled: true,
        workspaceApprovalMode: "ask",
        isTurnWriteApproved: () => turnApproved,
        markTurnWriteApproved: () => {
          turnApproved = true;
        },
        emitEvent: (_type, payload) => {
          if (payload.status === "awaiting_approval") {
            promptCount++;
          }
        },
      },
    );
    assert.ok(!writeAll2.isError, writeAll2.content);
    assert.equal(promptCount, 1, "Second file write in same turn should not prompt again");

    // 10. Verify Git status and diff helpers
    const gitDir = path.join(tmpTestRoot, "git-repo-test");
    fs.mkdirSync(gitDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: gitDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: gitDir, stdio: "ignore" });
    fs.writeFileSync(path.join(gitDir, "hello.txt"), "hello world\n", "utf-8");
    execFileSync("git", ["add", "hello.txt"], { cwd: gitDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: gitDir, stdio: "ignore" });
    fs.writeFileSync(path.join(gitDir, "hello.txt"), "hello blombrain\n", "utf-8");
    fs.writeFileSync(path.join(gitDir, "untracked.txt"), "new\n", "utf-8");

    const gs = getWorkspaceGitStatus(gitDir);
    assert.equal(gs.isGitRepo, true);
    assert.equal(gs.branch, "main");
    assert.ok(gs.files.some((f) => f.path === "hello.txt" && f.code === "M"));
    assert.ok(gs.files.some((f) => f.path === "untracked.txt" && f.code === "?"));

    const gd = getWorkspaceGitDiff(gitDir);
    assert.equal(gd.isGitRepo, true);
    assert.match(gd.diff, /-hello world/);
    assert.match(gd.diff, /\+hello blombrain/);

    // 11. Verify tool_routing_mode = 'off' strictly skips LLM pre-pass even with small contextLimit
    db.prepare("UPDATE global_settings SET tool_routing_mode = 'off' WHERE id = 'default'").run();
    let routingStarted = false;
    const routed = await routeToolsAndSkills(
      "inspect workspace files and edit notes.txt",
      [],
      [],
      [],
      "nonexistent:model",
      4096,
      undefined,
      undefined,
      undefined,
      true,
      realB,
      true,
      () => {
        routingStarted = true;
      },
    );
    assert.equal(routingStarted, false, "Pre-pass must not run when tool_routing_mode is 'off'");
    assert.ok(routed.selectedBuiltInTools.length > 0, "All available built-in tools should pass through directly");
  });
});
