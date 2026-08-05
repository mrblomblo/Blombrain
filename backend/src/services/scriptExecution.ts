import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { DATA_DIR } from "../db.js";
import { getSkillById } from "./skills.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 100_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExecuteSkillScriptContext {
  conversationId: string;
  activeSkillIds: string[];
  abortSignal?: AbortSignal;
}

export async function executeSkillScriptTool(
  args: any,
  ctx: ExecuteSkillScriptContext
): Promise<{ content: string; isError?: boolean }> {
  try {
    // 1. Validate conversationId
    if (!ctx.conversationId || !UUID_REGEX.test(ctx.conversationId)) {
      throw new Error(`Invalid conversationId: ${ctx.conversationId}`);
    }

    // 2. Validate args
    if (!args || typeof args !== "object") {
      throw new Error("Arguments must be an object.");
    }
    const skillId = typeof args.skill_id === "string" ? args.skill_id : (typeof args.skillId === "string" ? args.skillId : null);
    const skillName = typeof args.skill_name === "string" ? args.skill_name : (typeof args.skillName === "string" ? args.skillName : (typeof args.scriptId === "string" ? args.scriptId : null));
    let scriptName = typeof args.script_name === "string" ? args.script_name : (typeof args.scriptName === "string" ? args.scriptName : null);
    const argsCwd = typeof args.cwd === "string" ? args.cwd : null;
    let scriptArgs: string[] = [];

    if (Array.isArray(args.args)) {
      scriptArgs = args.args.map((a: any) => String(a));
    } else {
      // Fallback: If model passed named parameters like project_name or name instead of args array
      for (const [k, v] of Object.entries(args)) {
        if (["skill_id", "skillId", "skill_name", "skillName", "script_id", "scriptId", "script_name", "scriptName", "cwd"].includes(k)) continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          scriptArgs.push(String(v));
        }
      }
    }

    if (!scriptName) {
      throw new Error("Missing required parameter: script_name");
    }

    // 3. Resolve Skill
    let activeSkillId = skillId;
    if (!activeSkillId && skillName) {
      // Find skill id by name if skill_id wasn't provided directly
      for (const id of ctx.activeSkillIds) {
        const s = getSkillById(id);
        if (s && (s.name === skillName || s.id === skillName)) {
          activeSkillId = s.id;
          break;
        }
      }
    }

    if (!activeSkillId) {
      throw new Error(`Failed to resolve skill matching '${skillName ?? skillId}'. Active skills: ${ctx.activeSkillIds.join(", ")}`);
    }

    if (!ctx.activeSkillIds.includes(activeSkillId)) {
      throw new Error(`Skill ${activeSkillId} is not active in this conversation turn.`);
    }

    const skill = getSkillById(activeSkillId);
    if (!skill || !skill.dirPath) {
      throw new Error(`Failed to load skill directory for skill ${activeSkillId}.`);
    }

    // 4. Resolve and Validate Script Path
    const scriptsDir = path.resolve(path.join(skill.dirPath, "scripts"));
    
    // Normalize and prevent traversal
    const normalizedScriptName = path.normalize(scriptName);
    if (
      path.isAbsolute(normalizedScriptName) ||
      normalizedScriptName.startsWith("..") ||
      normalizedScriptName.includes("../") ||
      normalizedScriptName.includes("..\\")
    ) {
      throw new Error("Invalid script name: path traversal is not allowed.");
    }

    const scriptPath = path.resolve(scriptsDir, normalizedScriptName);
    const relative = path.relative(scriptsDir, scriptPath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Script path escapes the scripts directory.");
    }

    const stat = await fs.stat(scriptPath).catch(() => null);
    if (!stat) {
      throw new Error(`Script not found: ${normalizedScriptName}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Script is not a regular file: ${normalizedScriptName}`);
    }

    const lstat = await fs.lstat(scriptPath);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Script symlinks are not allowed.`);
    }

    // 5. Interpreter Routing
    const ext = path.extname(scriptPath).toLowerCase();
    let interpreter = "";
    let spawnArgs = [...scriptArgs];

    if (ext === ".sh" || ext === ".bash") {
      interpreter = "bash";
      spawnArgs.unshift(scriptPath);
    } else if (ext === ".py") {
      interpreter = "python3";
      spawnArgs.unshift(scriptPath);
    } else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      interpreter = process.execPath;
      spawnArgs.unshift(scriptPath);
    } else {
      throw new Error(`Unsupported script extension: ${ext}`);
    }

    // 6. Setup Workspace
    const workspaceDir = path.join(DATA_DIR, "uploads", ctx.conversationId);
    await fs.mkdir(workspaceDir, { recursive: true });

    let effectiveCwd = workspaceDir;
    let displayCwd = `data/uploads/${ctx.conversationId}`;
    if (argsCwd) {
      const normalizedCwd = path.normalize(argsCwd).replace(/^[/\\]+/, ""); // remove leading slashes
      if (normalizedCwd !== "" && normalizedCwd !== ".") {
        const resolvedCwd = path.resolve(workspaceDir, normalizedCwd);
        const rel = path.relative(workspaceDir, resolvedCwd);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new Error("Invalid cwd: path escapes the workspace directory.");
        }

        const stat = await fs.stat(resolvedCwd).catch(() => null);
        if (!stat) {
          throw new Error(`Working directory not found: ${argsCwd}`);
        }
        if (!stat.isDirectory()) {
          throw new Error(`Working directory is not a directory: ${argsCwd}`);
        }

        const realCwd = await fs.realpath(resolvedCwd);
        const realRel = path.relative(workspaceDir, realCwd);
        if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
          throw new Error("Invalid cwd: symlink escapes the workspace directory.");
        }

        effectiveCwd = realCwd;
        displayCwd = `data/uploads/${ctx.conversationId}/${normalizedCwd}`;
      }
    }

    // 7. Setup Environment
    const cleanEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin", // basic safe path
      HOME: workspaceDir,
      TMPDIR: path.join(workspaceDir, ".tmp"),
      CONVERSATION_ID: ctx.conversationId,
      SKILL_ID: skill.id,
      SKILL_NAME: skill.name,
      SCRIPT_NAME: normalizedScriptName,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    };

    // Ensure tmp exists
    await fs.mkdir(cleanEnv.TMPDIR!, { recursive: true });

    // 8. Execute
    return new Promise((resolve) => {
      let stdoutStr = "";
      let stderrStr = "";
      let truncated = false;
      let timedOut = false;

      const child = spawn(interpreter, spawnArgs, {
        cwd: effectiveCwd,
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true, // Used for process group killing on POSIX
      });

      function killChildGroup(signal: NodeJS.Signals) {
        if (child.pid) {
          try {
            process.kill(-child.pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {}
          }
        }
      }

      const handleData = (chunk: Buffer, isErr: boolean) => {
        if (truncated) return;
        const text = chunk.toString("utf8");
        const currentLen = stdoutStr.length + stderrStr.length;
        if (currentLen + text.length > MAX_OUTPUT_BYTES) {
          truncated = true;
          killChildGroup("SIGTERM");
          if (isErr) stderrStr += text.substring(0, MAX_OUTPUT_BYTES - currentLen) + "\n\n[TRUNCATED: Exceeded 100KB limit]";
          else stdoutStr += text.substring(0, MAX_OUTPUT_BYTES - currentLen) + "\n\n[TRUNCATED: Exceeded 100KB limit]";
        } else {
          if (isErr) stderrStr += text;
          else stdoutStr += text;
        }
      };

      child.stdout.on("data", (chunk) => handleData(chunk, false));
      child.stderr.on("data", (chunk) => handleData(chunk, true));

      const timer = setTimeout(() => {
        timedOut = true;
        killChildGroup("SIGTERM");
        setTimeout(() => killChildGroup("SIGKILL"), 5000).unref();
      }, DEFAULT_TIMEOUT_MS);

      const abortHandler = () => {
        killChildGroup("SIGTERM");
        setTimeout(() => killChildGroup("SIGKILL"), 5000).unref();
      };
      
      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener("abort", abortHandler);
      }

      child.on("close", (code) => {
        clearTimeout(timer);
        if (ctx.abortSignal) {
          ctx.abortSignal.removeEventListener("abort", abortHandler);
        }

        const isError = timedOut || (code !== 0 && code !== null);
        
        const resultJson = JSON.stringify({
          ok: !isError,
          exitCode: code,
          timedOut,
          truncated,
          workspaceDir: displayCwd,
          stdout: stdoutStr.trim(),
          stderr: stderrStr.trim(),
        }, null, 2);

        resolve({
          content: resultJson,
          isError: isError,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (ctx.abortSignal) {
          ctx.abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve({
          content: JSON.stringify({
            ok: false,
            error: err.message,
            workspaceDir: displayCwd,
          }, null, 2),
          isError: true,
        });
      });
    });

  } catch (err: any) {
    return {
      content: JSON.stringify({
        ok: false,
        error: err.message,
      }, null, 2),
      isError: true,
    };
  }
}
