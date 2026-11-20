import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db.js";
import { backendRegistry } from "../registry.js";
import type { BackendProcessInfo } from "../types.js";

/**
 * Lifecycle management for the optional per-backend launch command
 * (e.g. `llama-server -m model.gguf --port 8080` or `ollama serve`).
 *
 * - Each command runs through the system shell in its OWN process group, so stopping
 *   it also stops anything the shell spawned (wrapper scripts, child workers).
 * - Commands must stay in the foreground. When the leading process exits, any
 *   stragglers in its group are cleaned up so nothing is leaked.
 * - Running pids are recorded on disk so that a crash / SIGKILL of Blombrain does not
 *   leave orphans forever: the next start reaps them.
 */

const MAX_LOG_LINES = 500;
const MAX_LOG_LINE_CHARS = 2000;
const DEFAULT_STOP_GRACE_MS = 4000;
const STRAGGLER_KILL_DELAY_MS = 3000;
const PID_FILE = path.join(DATA_DIR, "managed-processes.json");

interface ManagedProcess {
  child: ChildProcess | null;
  info: BackendProcessInfo;
  command: string;
  cwd: string | null;
  logs: string[];
  partial: { stdout: string; stderr: string };
  exited: Promise<void>;
  markExited: () => void;
}

interface PidRecord {
  pid: number;
  startTicks: string | null;
}

function emptyInfo(): BackendProcessInfo {
  return { state: "stopped", pid: null, startedAt: null, exitCode: null, signal: null, error: null };
}

/** Process start time in clock ticks since boot (field 22 of /proc/<pid>/stat), Linux only. */
function readStartTicks(pid: number): string | null {
  if (process.platform !== "linux") return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterComm[19] ?? null;
  } catch {
    return null;
  }
}

function readPidFile(): Record<string, PidRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(PID_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, PidRecord>) : {};
  } catch {
    return {};
  }
}

function writePidFile(records: Record<string, PidRecord>): void {
  try {
    if (Object.keys(records).length === 0) {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
      return;
    }
    fs.writeFileSync(PID_FILE, JSON.stringify(records));
  } catch (err) {
    console.error("[backend-process] failed to persist pid file:", err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
  } catch (err: any) {
    // EPERM means the group exists but is not ours; treat as alive to be safe.
    return err?.code === "EPERM";
  }
  if (process.platform === "linux") {
    try {
      const targetPgrp = String(pid);
      for (const entry of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const st = fs.readFileSync(`/proc/${entry}/stat`, "utf-8");
          const parts = st.slice(st.lastIndexOf(")") + 2).split(" ");
          const state = parts[0];
          const pgrp = parts[2];
          if (pgrp === targetPgrp && state !== "Z" && state !== "X") {
            return true;
          }
        } catch { }
      }
      return false;
    } catch { }
  }
  return true;
}

class BackendProcessManager {
  private procs = new Map<string, ManagedProcess>();

  // ---------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------

  getInfo(backendId: string): BackendProcessInfo {
    const m = this.procs.get(backendId);
    return m ? { ...m.info } : emptyInfo();
  }

  getLogs(backendId: string): string[] {
    return [...(this.procs.get(backendId)?.logs ?? [])];
  }

  isRunning(backendId: string): boolean {
    const state = this.procs.get(backendId)?.info.state;
    return state === "running" || state === "stopping";
  }

  /** The command/cwd the live process was started with, if any. */
  getRunningSpec(backendId: string): { command: string; cwd: string | null } | null {
    const m = this.procs.get(backendId);
    if (!m || !this.isRunning(backendId)) return null;
    return { command: m.command, cwd: m.cwd };
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** Starts the backend's launch command. No-op if it is already running. */
  async start(backendId: string): Promise<BackendProcessInfo> {
    const backend = backendRegistry.getById(backendId);
    if (!backend) throw new Error(`Backend "${backendId}" not found.`);
    if (!backend.isEnabled) throw new Error(`Backend "${backend.name}" is disabled. Enable it first.`);
    if (!backend.launchCommand) throw new Error(`Backend "${backend.name}" has no launch command configured.`);

    const existing = this.procs.get(backendId);
    if (existing?.info.state === "stopping") {
      await existing.exited;
    } else if (existing?.info.state === "running") {
      return { ...existing.info };
    }

    const command = backend.launchCommand;
    const cwd = backend.launchCwd;

    let markExited: () => void = () => { };
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const managed: ManagedProcess = {
      child: null,
      info: { ...emptyInfo(), state: "running", startedAt: Date.now() },
      command,
      cwd,
      logs: [],
      partial: { stdout: "", stderr: "" },
      exited,
      markExited,
    };
    this.procs.set(backendId, managed);
    this.pushLog(managed, `$ ${command}`);

    let child: ChildProcess;
    try {
      child = spawn(command, {
        shell: true,
        cwd: cwd ?? undefined,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      this.fail(backendId, managed, err);
      return { ...managed.info };
    }

    managed.child = child;
    managed.info.pid = child.pid ?? null;
    if (child.pid) this.recordPid(backendId, child.pid);

    child.stdout?.on("data", (chunk: Buffer) => this.onData(managed, "stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.onData(managed, "stderr", chunk));

    child.on("error", (err) => this.fail(backendId, managed, err));

    child.on("exit", (code, signal) => {
      if (managed.info.state === "failed") return;
      const wasStopping = managed.info.state === "stopping";
      managed.info.state = wasStopping ? "stopped" : "exited";
      managed.info.exitCode = code;
      managed.info.signal = signal;
      this.flushPartial(managed);
      this.pushLog(
        managed,
        wasStopping
          ? "[blombrain] stopped"
          : `[blombrain] exited (code ${code ?? "none"}${signal ? `, signal ${signal}` : ""})`,
      );
      this.reapGroupStragglers(managed);
      this.clearPid(backendId);
      managed.markExited();
    });

    console.log(`[backend-process] started "${backend.name}" (pid ${child.pid ?? "?"}): ${command}`);
    return { ...managed.info };
  }

  /** Stops the backend's launch command (SIGTERM, then SIGKILL after `graceMs`). */
  async stop(backendId: string, graceMs: number = DEFAULT_STOP_GRACE_MS): Promise<void> {
    const m = this.procs.get(backendId);
    if (!m || !m.child) return;
    if (m.info.state !== "running" && m.info.state !== "stopping") return;

    if (m.info.state === "running") {
      m.info.state = "stopping";
      this.signalGroup(m, "SIGTERM");
    }

    const deadline = Date.now() + graceMs;
    const settled = await Promise.race([
      m.exited.then(() => true),
      sleep(graceMs).then(() => false),
    ]);
    if (!settled) {
      this.pushLog(m, `[blombrain] did not exit within ${graceMs}ms, sending SIGKILL`);
      this.signalGroup(m, "SIGKILL");
      await Promise.race([m.exited, sleep(2000)]);
    } else if (m.info.pid && process.platform !== "win32" && groupAlive(m.info.pid)) {
      while (Date.now() < deadline && groupAlive(m.info.pid)) {
        await sleep(50);
      }
      if (groupAlive(m.info.pid)) {
        this.pushLog(m, `[blombrain] group stragglers still alive after ${graceMs}ms, sending SIGKILL`);
        this.signalGroup(m, "SIGKILL");
      }
    }
  }

  async restart(backendId: string): Promise<BackendProcessInfo> {
    await this.stop(backendId);
    return this.start(backendId);
  }

  /**
   * Stops processes whose backend no longer exists, is disabled, or no longer has a launch
   * command. Never starts anything.
   */
  async reconcile(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const id of Array.from(this.procs.keys())) {
      if (!this.isRunning(id)) continue;
      const backend = backendRegistry.getById(id);
      if (!backend || !backend.isEnabled || !backend.launchCommand) {
        stops.push(this.stop(id));
      }
    }
    await Promise.allSettled(stops);
  }

  async stopAll(graceMs: number = DEFAULT_STOP_GRACE_MS): Promise<void> {
    const stops = Array.from(this.procs.keys()).map((id) => this.stop(id, graceMs));
    await Promise.allSettled(stops);
  }

  /** App startup: reap orphans from a previous crashed run, then start every enabled backend's command. */
  async init(): Promise<void> {
    await this.reapStale();
    const starts = backendRegistry
      .getAll()
      .filter((b) => b.isEnabled && b.launchCommand)
      .map(async (b) => {
        try {
          await this.start(b.id);
        } catch (err) {
          console.error(`[backend-process] failed to start "${b.name}":`, err);
        }
      });
    await Promise.allSettled(starts);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private fail(backendId: string, managed: ManagedProcess, err: unknown): void {
    if (managed.info.state === "failed") return;
    const message = err instanceof Error ? err.message : String(err);
    managed.info.state = "failed";
    managed.info.error = message;
    this.pushLog(managed, `[blombrain] failed to start: ${message}`);
    console.error(`[backend-process] "${backendId}" failed:`, message);
    this.clearPid(backendId);
    managed.markExited();
  }

  private signalGroup(m: ManagedProcess, signal: NodeJS.Signals): void {
    const pid = m.info.pid;
    if (!pid) return;
    try {
      if (process.platform === "win32") {
        m.child?.kill(signal);
      } else {
        process.kill(-pid, signal);
      }
    } catch {
      // Already gone.
    }
  }

  private reapGroupStragglers(m: ManagedProcess): void {
    const pid = m.info.pid;
    if (!pid || process.platform === "win32") return;
    if (!groupAlive(pid)) return;
    this.signalGroup(m, "SIGTERM");
    const timer = setTimeout(() => this.signalGroup(m, "SIGKILL"), STRAGGLER_KILL_DELAY_MS);
    timer.unref?.();
  }

  private onData(m: ManagedProcess, stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = m.partial[stream] + chunk.toString("utf-8");
    const lines = text.split(/\r?\n/);
    m.partial[stream] = lines.pop() ?? "";
    // A pathological no-newline stream must not grow without bound.
    if (m.partial[stream].length > MAX_LOG_LINE_CHARS) {
      lines.push(m.partial[stream]);
      m.partial[stream] = "";
    }
    for (const line of lines) {
      if (line.length > 0) this.pushLog(m, line);
    }
  }

  private flushPartial(m: ManagedProcess): void {
    for (const stream of ["stdout", "stderr"] as const) {
      if (m.partial[stream]) this.pushLog(m, m.partial[stream]);
      m.partial[stream] = "";
    }
  }

  private pushLog(m: ManagedProcess, line: string): void {
    m.logs.push(line.length > MAX_LOG_LINE_CHARS ? line.slice(0, MAX_LOG_LINE_CHARS) + "..." : line);
    if (m.logs.length > MAX_LOG_LINES) m.logs.splice(0, m.logs.length - MAX_LOG_LINES);
  }

  private recordPid(backendId: string, pid: number): void {
    const records = readPidFile();
    records[backendId] = { pid, startTicks: readStartTicks(pid) };
    writePidFile(records);
  }

  private clearPid(backendId: string): void {
    const records = readPidFile();
    if (backendId in records) {
      delete records[backendId];
      writePidFile(records);
    }
  }

  /** Kills process groups left behind by a previous Blombrain run that did not shut down cleanly. */
  private async reapStale(): Promise<void> {
    if (process.platform !== "linux") {
      writePidFile({});
      return;
    }
    const records = readPidFile();
    const stale: number[] = [];
    for (const [id, rec] of Object.entries(records)) {
      if (!rec || typeof rec.pid !== "number") continue;
      const ticks = readStartTicks(rec.pid);
      // Only trust the record if it is still the very same process (guards against pid reuse).
      if (ticks !== null && rec.startTicks !== null && ticks === rec.startTicks) {
        console.warn(`[backend-process] reaping orphaned process for "${id}" (pid ${rec.pid}) from a previous run`);
        stale.push(rec.pid);
      }
    }
    for (const pid of stale) {
      try { process.kill(-pid, "SIGTERM"); } catch { }
    }
    if (stale.length > 0) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && stale.some((pid) => groupAlive(pid))) {
        await sleep(100);
      }
      for (const pid of stale) {
        if (groupAlive(pid)) {
          try { process.kill(-pid, "SIGKILL"); } catch { }
        }
      }
    }
    writePidFile({});
  }
}

export const backendProcessManager = new BackendProcessManager();
