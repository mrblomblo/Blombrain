import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { backendRegistry } from "../registry.js";
import type {
  SpeechProviderType,
  SpeechDeviceType,
  ResolvedBackend,
  ModelSettingRow,
} from "../types.js";

export interface SpeechConfig {
  sttProvider: SpeechProviderType;
  sttEndpoint: string | null;
  sttModel: string | null;
  sttDevice: SpeechDeviceType;
  ttsProvider: SpeechProviderType;
  ttsEndpoint: string | null;
  ttsModel: string | null;
  ttsVoice: string | null;
  ttsDevice: SpeechDeviceType;
  speechIdleTimeoutSec: number;
}

export function getSpeechConfig(): SpeechConfig {
  const row = db
    .prepare("SELECT * FROM global_settings WHERE id = 'default'")
    .get() as any;
  return {
    sttProvider: (row?.stt_provider as SpeechProviderType) || "browser",
    sttEndpoint: row?.stt_endpoint ?? null,
    sttModel: row?.stt_model ?? null,
    sttDevice: (row?.stt_device as SpeechDeviceType) || "cpu",
    ttsProvider: (row?.tts_provider as SpeechProviderType) || "browser",
    ttsEndpoint: row?.tts_endpoint ?? null,
    ttsModel: row?.tts_model ?? null,
    ttsVoice: row?.tts_voice ?? null,
    ttsDevice: (row?.tts_device as SpeechDeviceType) || "cpu",
    speechIdleTimeoutSec: row?.speech_idle_timeout_sec ?? 60,
  };
}

// ---------------------------------------------------------------------------
// Generic STT / TTS Provider Interfaces & VRAM Resource Manager
// ---------------------------------------------------------------------------

export interface SttProvider {
  transcribe(
    audioBuffer: Buffer,
    filename: string,
    mimeType: string,
    cfg: SpeechConfig,
    activeModelId?: string | null,
    signal?: AbortSignal
  ): Promise<{ text: string }>;
}

export interface TtsProvider {
  synthesize(
    text: string,
    cfg: SpeechConfig,
    signal?: AbortSignal
  ): Promise<{ audio: Buffer; contentType: string }>;
}

class SpeechResourceManager {
  private activeSttProcesses = new Set<ChildProcess>();
  private activeTtsProcesses = new Set<ChildProcess>();
  private sttLoaded = false;
  private ttsLoaded = false;
  private sttLastUsed = 0;
  private ttsLastUsed = 0;
  private sttIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsIdleTimer: ReturnType<typeof setTimeout> | null = null;

  public markSttUsed(idleTimeoutSec: number) {
    this.sttLoaded = true;
    this.sttLastUsed = Date.now();
    if (this.sttIdleTimer) clearTimeout(this.sttIdleTimer);
    this.sttIdleTimer = setTimeout(() => {
      this.eject("stt");
    }, Math.max(5, idleTimeoutSec) * 1000);
  }

  public markTtsUsed(idleTimeoutSec: number) {
    this.ttsLoaded = true;
    this.ttsLastUsed = Date.now();
    if (this.ttsIdleTimer) clearTimeout(this.ttsIdleTimer);
    this.ttsIdleTimer = setTimeout(() => {
      this.eject("tts");
    }, Math.max(5, idleTimeoutSec) * 1000);
  }

  public trackProcess(kind: "stt" | "tts", proc: ChildProcess) {
    const set = kind === "stt" ? this.activeSttProcesses : this.activeTtsProcesses;
    set.add(proc);
    proc.once("close", () => set.delete(proc));
    proc.once("error", () => set.delete(proc));
  }

  public async eject(target: "stt" | "tts" | "all"): Promise<{ sttLoaded: boolean; ttsLoaded: boolean }> {
    const cfg = getSpeechConfig();

    if (target === "stt" || target === "all") {
      if (this.sttIdleTimer) {
        clearTimeout(this.sttIdleTimer);
        this.sttIdleTimer = null;
      }
      for (const proc of this.activeSttProcesses) {
        try { proc.kill("SIGTERM"); } catch { }
      }
      this.activeSttProcesses.clear();
      this.sttLoaded = false;

      if (cfg.sttProvider === "openai_compatible" && cfg.sttEndpoint) {
        try {
          const base = cfg.sttEndpoint.replace(/\/v1\/audio\/transcriptions\/?$/i, "").replace(/\/+$/, "");
          await fetch(`${base}/unload`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => null);
        } catch { }
      }
    }

    if (target === "tts" || target === "all") {
      if (this.ttsIdleTimer) {
        clearTimeout(this.ttsIdleTimer);
        this.ttsIdleTimer = null;
      }
      for (const proc of this.activeTtsProcesses) {
        try { proc.kill("SIGTERM"); } catch { }
      }
      this.activeTtsProcesses.clear();
      this.ttsLoaded = false;

      if (cfg.ttsProvider === "openai_compatible" && cfg.ttsEndpoint) {
        try {
          const base = cfg.ttsEndpoint.replace(/\/v1\/audio\/speech\/?$/i, "").replace(/\/+$/, "");
          await fetch(`${base}/unload`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => null);
        } catch { }
      }
    }

    return this.getStatus();
  }

  public getStatus() {
    return {
      sttLoaded: this.sttLoaded,
      ttsLoaded: this.ttsLoaded,
      sttLastUsed: this.sttLastUsed || null,
      ttsLastUsed: this.ttsLastUsed || null,
      activeSttProcesses: this.activeSttProcesses.size,
      activeTtsProcesses: this.activeTtsProcesses.size,
    };
  }
}

export const speechResourceManager = new SpeechResourceManager();

// ---------------------------------------------------------------------------
// Resolution Helpers for Audio-Capable Models & Configured Backends
// ---------------------------------------------------------------------------

interface ResolvedSttTarget {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  isMultimodalChatModel: boolean;
}

function resolveModelOrPreset(modelId: string): {
  resolved: { backend: ResolvedBackend; rawModelId: string };
  canAudio: boolean;
} | null {
  let targetId = modelId;
  const row = db
    .prepare("SELECT * FROM model_settings WHERE id = ?")
    .get(modelId) as ModelSettingRow | undefined;

  let canAudio = Boolean(row?.can_audio);
  if (row?.is_preset && row.base_model_id) {
    targetId = row.base_model_id;
    const baseRow = db
      .prepare("SELECT can_audio FROM model_settings WHERE id = ?")
      .get(targetId) as { can_audio?: number } | undefined;
    if (baseRow?.can_audio) canAudio = true;
  }

  const resolved = backendRegistry.resolveModelId(targetId);
  if (!resolved) return null;
  return { resolved, canAudio };
}

function resolveBestSttTarget(
  cfg: SpeechConfig,
  activeModelId?: string | null
): ResolvedSttTarget | null {
  // 1. If sttModel is a prefixed Blombrain model ID (e.g., "lmcpp:Gemma4-12B...")
  if (cfg.sttModel && cfg.sttModel.includes(":")) {
    const match = resolveModelOrPreset(cfg.sttModel);
    if (match) {
      return {
        baseUrl: cfg.sttEndpoint?.trim() || match.resolved.backend.baseUrl,
        apiKey: match.resolved.backend.apiKey,
        modelId: match.resolved.rawModelId,
        isMultimodalChatModel: match.canAudio,
      };
    }
  }

  // 2. If an explicit sttEndpoint URL is configured
  if (cfg.sttEndpoint && /^https?:\/\//i.test(cfg.sttEndpoint.trim())) {
    const cleanEndpoint = cfg.sttEndpoint.trim().replace(/\/+$/, "");
    const matchingBackend = backendRegistry
      .getAll()
      .find((b) => cleanEndpoint.startsWith(b.baseUrl.replace(/\/+$/, "")));

    return {
      baseUrl: cleanEndpoint,
      apiKey: matchingBackend?.apiKey,
      modelId: cfg.sttModel?.trim() || "Qwen3-ASR",
      isMultimodalChatModel: false,
    };
  }

  // 3. If the active chat model has Audio capability enabled (can_audio = 1)
  if (activeModelId) {
    const activeMatch = resolveModelOrPreset(activeModelId);
    if (activeMatch && activeMatch.canAudio) {
      return {
        baseUrl: activeMatch.resolved.backend.baseUrl,
        apiKey: activeMatch.resolved.backend.apiKey,
        modelId: activeMatch.resolved.rawModelId,
        isMultimodalChatModel: true,
      };
    }
  }

  // 4. Find any online model in cached_models that has can_audio = 1 in model_settings
  const onlineAudioModel = db
    .prepare(
      `SELECT cm.id, cm.raw_id, cm.backend_id
       FROM cached_models cm
       JOIN model_settings ms ON ms.id = cm.id
       WHERE cm.is_online = 1 AND ms.can_audio = 1
       ORDER BY ms.is_default DESC, ms.sort_order ASC
       LIMIT 1`
    )
    .get() as { id: string; raw_id: string; backend_id: string } | undefined;

  if (onlineAudioModel) {
    const backend = backendRegistry.getById(onlineAudioModel.backend_id);
    if (backend) {
      return {
        baseUrl: backend.baseUrl,
        apiKey: backend.apiKey,
        modelId: onlineAudioModel.raw_id,
        isMultimodalChatModel: true,
      };
    }
  }

  // 5. Fallback to the active chat model's backend or the first online backend
  if (activeModelId) {
    const activeMatch = resolveModelOrPreset(activeModelId);
    if (activeMatch) {
      return {
        baseUrl: activeMatch.resolved.backend.baseUrl,
        apiKey: activeMatch.resolved.backend.apiKey,
        modelId: cfg.sttModel?.trim() || activeMatch.resolved.rawModelId,
        isMultimodalChatModel: false,
      };
    }
  }

  const firstOnlineModel = db
    .prepare("SELECT id, raw_id, backend_id FROM cached_models WHERE is_online = 1 LIMIT 1")
    .get() as { id: string; raw_id: string; backend_id: string } | undefined;

  if (firstOnlineModel) {
    const backend = backendRegistry.getById(firstOnlineModel.backend_id);
    if (backend) {
      return {
        baseUrl: backend.baseUrl,
        apiKey: backend.apiKey,
        modelId: cfg.sttModel?.trim() || firstOnlineModel.raw_id,
        isMultimodalChatModel: false,
      };
    }
  }

  const allBackends = backendRegistry.getAll();
  if (allBackends.length > 0) {
    return {
      baseUrl: allBackends[0].baseUrl,
      apiKey: allBackends[0].apiKey,
      modelId: cfg.sttModel?.trim() || "Qwen3-ASR",
      isMultimodalChatModel: false,
    };
  }

  return null;
}

async function transcribeViaChatCompletions(
  target: ResolvedSttTarget,
  audioBuffer: Buffer,
  signal?: AbortSignal
): Promise<{ text: string }> {
  const rawBase = target.baseUrl
    .replace(/\/v1\/audio\/transcriptions\/?$/i, "")
    .replace(/\/v1\/chat\/completions\/?$/i, "")
    .replace(/\/+$/, "");
  const url = rawBase.endsWith("/v1")
    ? `${rawBase}/chat/completions`
    : `${rawBase}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (target.apiKey) {
    headers["Authorization"] = `Bearer ${target.apiKey}`;
  }

  const base64Audio = audioBuffer.toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: target.modelId,
      messages: [
        {
          role: "system",
          content:
            "You are a speech-to-text transcription engine. Transcribe the user's audio recording verbatim. Output ONLY the exact spoken words with no commentary, no introductory text, and no surrounding quotes. If the audio is silent or contains no speech, output nothing.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe the spoken words in this audio recording verbatim:",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: "wav",
              },
            },
          ],
        },
      ],
      temperature: 0,
      stream: false,
    }),
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Audio chat transcription failed (${res.status}): ${errBody || res.statusText}`);
  }

  const data = (await res.json()) as any;
  let content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  content = content
    .replace(/<(?:think|thought|reason|reasoning)>[\s\S]*?<\/(?:think|thought|reason|reasoning)>/gi, "")
    .trim();

  return { text: content };
}

async function transcribeViaAudioTranscriptionsEndpoint(
  target: ResolvedSttTarget,
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
  signal?: AbortSignal
): Promise<{ text: string }> {
  const rawBase = target.baseUrl.replace(/\/+$/, "");
  const url = rawBase.endsWith("/audio/transcriptions")
    ? rawBase
    : rawBase.endsWith("/v1")
      ? `${rawBase}/audio/transcriptions`
      : `${rawBase}/v1/audio/transcriptions`;

  const headers: Record<string, string> = {};
  if (target.apiKey) {
    headers["Authorization"] = `Bearer ${target.apiKey}`;
  }

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType || "audio/wav" });
  formData.append("file", blob, filename || "recording.wav");
  formData.append("model", target.modelId || "Qwen3-ASR");

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(
      `STT endpoint error (${res.status} at ${url}): ${errBody || res.statusText}`
    );
    (err as any).status = res.status;
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as any;
    return { text: String(data?.text ?? "").trim() };
  }
  const rawText = await res.text();
  return { text: rawText.trim() };
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible & Local CLI Providers
// ---------------------------------------------------------------------------

const openAiSttProvider: SttProvider = {
  async transcribe(audioBuffer, filename, mimeType, cfg, activeModelId, signal) {
    const target = resolveBestSttTarget(cfg, activeModelId);
    if (!target) {
      throw new Error(
        "No STT endpoint or audio-capable model is configured. Configure an STT endpoint in Settings > Speech, or enable Audio support on a model in Settings > Models & Presets."
      );
    }

    speechResourceManager.markSttUsed(cfg.speechIdleTimeoutSec);

    // If the resolved target is an audio-capable multimodal chat model (e.g. Gemma 4 12B on llama.cpp)
    // and the user did not explicitly point sttEndpoint at /audio/transcriptions, use /v1/chat/completions with input_audio.
    const explicitlyAudioTranscriptions =
      cfg.sttEndpoint && cfg.sttEndpoint.toLowerCase().includes("/audio/transcriptions");

    if (target.isMultimodalChatModel && !explicitlyAudioTranscriptions) {
      return transcribeViaChatCompletions(target, audioBuffer, signal);
    }

    try {
      return await transcribeViaAudioTranscriptionsEndpoint(
        target,
        audioBuffer,
        filename,
        mimeType,
        signal
      );
    } catch (err: any) {
      // If /v1/audio/transcriptions is not implemented on this backend (e.g. llama-server returning 404/405/501/400),
      // fall back to /v1/chat/completions with input_audio.
      const status = err?.status;
      if (status === 404 || status === 405 || status === 501 || status === 400) {
        try {
          return await transcribeViaChatCompletions(target, audioBuffer, signal);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  },
};

const localCliSttProvider: SttProvider = {
  async transcribe(audioBuffer, filename, _mimeType, cfg, _activeModelId, signal) {
    const binary = (cfg.sttEndpoint || "qwen-asr").trim();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blombrain-stt-"));
    const inputPath = path.join(tmpDir, filename || `input-${randomUUID()}.wav`);
    fs.writeFileSync(inputPath, audioBuffer);

    speechResourceManager.markSttUsed(cfg.speechIdleTimeoutSec);

    try {
      const args: string[] = [];
      if (cfg.sttModel) {
        args.push("--model", cfg.sttModel);
      }
      args.push("--device", cfg.sttDevice === "gpu" ? "cuda" : "cpu");
      args.push("--file", inputPath);

      const text = await new Promise<string>((resolve, reject) => {
        const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        speechResourceManager.trackProcess("stt", proc);

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf-8"); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });

        if (signal) {
          signal.addEventListener("abort", () => {
            try { proc.kill("SIGTERM"); } catch { }
            reject(new Error("STT operation aborted"));
          }, { once: true });
        }

        proc.on("error", (err) =>
          reject(new Error(`Failed to spawn local STT binary "${binary}": ${err.message}`))
        );
        proc.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`Local STT exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
          }
        });
      });

      return { text };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    }
  },
};

const openAiTtsProvider: TtsProvider = {
  async synthesize(text, cfg, signal) {
    let rawEndpoint = (cfg.ttsEndpoint || "").trim().replace(/\/+$/, "");
    let apiKey: string | undefined;

    if (!rawEndpoint) {
      const firstBackend = backendRegistry.getAll()[0];
      if (firstBackend) {
        rawEndpoint = firstBackend.baseUrl.replace(/\/+$/, "");
        apiKey = firstBackend.apiKey;
      } else {
        throw new Error(
          "No TTS endpoint configured. Configure a TTS endpoint in Settings > Speech or select Browser SpeechSynthesis."
        );
      }
    }

    const url = rawEndpoint.endsWith("/audio/speech")
      ? rawEndpoint
      : rawEndpoint.endsWith("/v1")
        ? `${rawEndpoint}/audio/speech`
        : `${rawEndpoint}/v1/audio/speech`;

    speechResourceManager.markTtsUsed(cfg.speechIdleTimeoutSec);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.ttsModel || "Qwen3-TTS",
        input: text,
        voice: cfg.ttsVoice || "default",
        response_format: "wav",
      }),
      signal: signal ?? AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`TTS endpoint error (${res.status}): ${errBody || res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "audio/wav";
    return {
      audio: Buffer.from(arrayBuf),
      contentType,
    };
  },
};

const localCliTtsProvider: TtsProvider = {
  async synthesize(text, cfg, signal) {
    const binary = (cfg.ttsEndpoint || "qwentts").trim();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blombrain-tts-"));
    const outPath = path.join(tmpDir, `output-${randomUUID()}.wav`);

    speechResourceManager.markTtsUsed(cfg.speechIdleTimeoutSec);

    try {
      const args: string[] = [];
      if (cfg.ttsModel) {
        args.push("--model", cfg.ttsModel);
      }
      if (cfg.ttsVoice) {
        args.push("--voice", cfg.ttsVoice);
      }
      args.push("--device", cfg.ttsDevice === "gpu" ? "cuda" : "cpu");
      args.push("--text", text);
      args.push("--output", outPath);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        speechResourceManager.trackProcess("tts", proc);

        let stderr = "";
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });

        if (signal) {
          signal.addEventListener("abort", () => {
            try { proc.kill("SIGTERM"); } catch { }
            reject(new Error("TTS operation aborted"));
          }, { once: true });
        }

        proc.on("error", (err) =>
          reject(new Error(`Failed to spawn local TTS binary "${binary}": ${err.message}`))
        );
        proc.on("close", (code) => {
          if (code === 0 && fs.existsSync(outPath)) {
            resolve();
          } else {
            reject(new Error(`Local TTS (${binary}) exited with code ${code}: ${stderr.trim()}`));
          }
        });
      });

      const audio = fs.readFileSync(outPath);
      return {
        audio,
        contentType: "audio/wav",
      };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    }
  },
};

export async function transcribeSpeech(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
  activeModelId?: string | null,
  signal?: AbortSignal
): Promise<{ text: string }> {
  const cfg = getSpeechConfig();
  if (cfg.sttProvider === "local_cli") {
    return localCliSttProvider.transcribe(audioBuffer, filename, mimeType, cfg, activeModelId, signal);
  }
  return openAiSttProvider.transcribe(audioBuffer, filename, mimeType, cfg, activeModelId, signal);
}

export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal
): Promise<{ audio: Buffer; contentType: string }> {
  const cfg = getSpeechConfig();
  if (cfg.ttsProvider === "local_cli") {
    return localCliTtsProvider.synthesize(text, cfg, signal);
  }
  return openAiTtsProvider.synthesize(text, cfg, signal);
}
