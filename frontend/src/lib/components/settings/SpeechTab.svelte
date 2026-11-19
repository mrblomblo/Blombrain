<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    fetchSpeechStatus,
    ejectSpeechModelsApi,
    type SpeechProviderType,
    type SpeechDeviceType,
  } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
  import Dropdown, { type DropdownOption } from "../ui/Dropdown.svelte";
  import Button from "../ui/Button.svelte";
  import { Volume2, Mic, Cpu, PowerOff } from "@lucide/svelte";

  const queryClient = useQueryClient();

  const statusQuery = createQuery(() => ({
    queryKey: ["speechStatus"],
    queryFn: fetchSpeechStatus,
    refetchInterval: 5_000,
  }));

  const sttProviderOptions: DropdownOption[] = [
    { label: "Browser Web Speech API (Zero VRAM, built-in)", value: "browser" },
    {
      label: "OpenAI-Compatible Endpoint (Qwen3-ASR / llama-server / Whisper)",
      value: "openai_compatible",
    },
    {
      label: "Local CLI Subprocess (qwen-asr / whisper-cli)",
      value: "local_cli",
    },
  ];

  const ttsProviderOptions: DropdownOption[] = [
    { label: "Browser SpeechSynthesis (Zero VRAM, built-in)", value: "browser" },
    {
      label: "OpenAI-Compatible Endpoint (Qwen3-TTS / OuteTTS / FastAPI)",
      value: "openai_compatible",
    },
    {
      label: "Local CLI Subprocess (qwentts.cpp)",
      value: "local_cli",
    },
  ];

  const deviceOptions: DropdownOption[] = [
    { label: "CPU (Preserve GPU VRAM for LLM)", value: "cpu" },
    { label: "GPU / CUDA (Fastest inference)", value: "gpu" },
  ];

  let ejecting = $state(false);
  let statusMsg = $state<string | null>(null);

  async function handleEject(target: "stt" | "tts" | "all") {
    ejecting = true;
    statusMsg = null;
    try {
      await ejectSpeechModelsApi(target);
      await queryClient.invalidateQueries({ queryKey: ["speechStatus"] });
      statusMsg = `Unloaded ${target.toUpperCase()} speech resources.`;
    } catch (err: any) {
      statusMsg = err?.message || "Failed to eject speech models.";
    } finally {
      ejecting = false;
    }
  }
</script>

<div class="flex flex-col gap-6">
  <!-- STT (Speech-to-Text) Section -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <div class="flex items-center justify-between border-b border-line pb-3">
      <div class="flex items-center gap-2">
        <Mic size={16} class="text-accent" />
        <div>
          <h3 class="text-sm font-semibold text-fg">Speech-to-Text (STT)</h3>
          <p class="text-xs text-fg-subtle">
            Voice input transcription provider (planned default: Qwen3-ASR).
          </p>
        </div>
      </div>
      {#if statusQuery.data?.sttLoaded}
        <span class="rounded bg-success/15 px-2 py-0.5 text-[10px] font-mono text-success">
          Loaded
        </span>
      {/if}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="flex flex-col gap-1">
        <label for="stt-provider-select" class="text-xs font-medium text-fg-muted">
          STT Provider
        </label>
        <Dropdown
          id="stt-provider-select"
          value={settingsStore.sttProvider}
          options={sttProviderOptions}
          onchange={(val) =>
            settingsStore.update({ sttProvider: val as SpeechProviderType })}
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="stt-device-select" class="text-xs font-medium text-fg-muted">
          STT Compute Device
        </label>
        <Dropdown
          id="stt-device-select"
          value={settingsStore.sttDevice}
          options={deviceOptions}
          disabled={settingsStore.sttProvider === "browser"}
          onchange={(val) =>
            settingsStore.update({ sttDevice: val as SpeechDeviceType })}
        />
      </div>
    </div>

    {#if settingsStore.sttProvider !== "browser"}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label for="stt-endpoint-input" class="text-xs font-medium text-fg-muted">
            {settingsStore.sttProvider === "local_cli"
              ? "CLI Binary Path"
              : "Endpoint Base URL"}
          </label>
          <input
            id="stt-endpoint-input"
            type="text"
            value={settingsStore.sttEndpoint ?? ""}
            onchange={(e) =>
              settingsStore.update({
                sttEndpoint: (e.currentTarget as HTMLInputElement).value.trim() || null,
              })}
            placeholder={settingsStore.sttProvider === "local_cli"
              ? "qwen-asr or /usr/local/bin/whisper-cli"
              : "http://127.0.0.1:8080"}
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="stt-model-input" class="text-xs font-medium text-fg-muted">
            Model Identifier / Path
          </label>
          <input
            id="stt-model-input"
            type="text"
            value={settingsStore.sttModel ?? ""}
            onchange={(e) =>
              settingsStore.update({
                sttModel: (e.currentTarget as HTMLInputElement).value.trim() || null,
              })}
            placeholder="Qwen3-ASR"
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- TTS (Text-to-Speech) Section -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <div class="flex items-center justify-between border-b border-line pb-3">
      <div class="flex items-center gap-2">
        <Volume2 size={16} class="text-accent" />
        <div>
          <h3 class="text-sm font-semibold text-fg">Text-to-Speech (TTS)</h3>
          <p class="text-xs text-fg-subtle">
            Assistant response speech synthesis (planned default: Qwen3-TTS via qwentts.cpp).
          </p>
        </div>
      </div>
      {#if statusQuery.data?.ttsLoaded}
        <span class="rounded bg-success/15 px-2 py-0.5 text-[10px] font-mono text-success">
          Loaded
        </span>
      {/if}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="flex flex-col gap-1">
        <label for="tts-provider-select" class="text-xs font-medium text-fg-muted">
          TTS Provider
        </label>
        <Dropdown
          id="tts-provider-select"
          value={settingsStore.ttsProvider}
          options={ttsProviderOptions}
          onchange={(val) =>
            settingsStore.update({ ttsProvider: val as SpeechProviderType })}
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="tts-device-select" class="text-xs font-medium text-fg-muted">
          TTS Compute Device
        </label>
        <Dropdown
          id="tts-device-select"
          value={settingsStore.ttsDevice}
          options={deviceOptions}
          disabled={settingsStore.ttsProvider === "browser"}
          onchange={(val) =>
            settingsStore.update({ ttsDevice: val as SpeechDeviceType })}
        />
      </div>
    </div>

    {#if settingsStore.ttsProvider !== "browser"}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="flex flex-col gap-1">
          <label for="tts-endpoint-input" class="text-xs font-medium text-fg-muted">
            {settingsStore.ttsProvider === "local_cli"
              ? "qwentts.cpp Binary Path"
              : "Endpoint Base URL"}
          </label>
          <input
            id="tts-endpoint-input"
            type="text"
            value={settingsStore.ttsEndpoint ?? ""}
            onchange={(e) =>
              settingsStore.update({
                ttsEndpoint: (e.currentTarget as HTMLInputElement).value.trim() || null,
              })}
            placeholder={settingsStore.ttsProvider === "local_cli"
              ? "qwentts or /usr/local/bin/qwentts"
              : "http://127.0.0.1:8080"}
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="tts-model-input" class="text-xs font-medium text-fg-muted">
            Model Name / GGUF Path
          </label>
          <input
            id="tts-model-input"
            type="text"
            value={settingsStore.ttsModel ?? ""}
            onchange={(e) =>
              settingsStore.update({
                ttsModel: (e.currentTarget as HTMLInputElement).value.trim() || null,
              })}
            placeholder="Qwen3-TTS"
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="tts-voice-input" class="text-xs font-medium text-fg-muted">
            Voice / Speaker
          </label>
          <input
            id="tts-voice-input"
            type="text"
            value={settingsStore.ttsVoice ?? ""}
            onchange={(e) =>
              settingsStore.update({
                ttsVoice: (e.currentTarget as HTMLInputElement).value.trim() || null,
              })}
            placeholder="default"
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- VRAM & Speech Resource Manager -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <div class="flex items-center gap-2 border-b border-line pb-3">
      <Cpu size={16} class="text-accent" />
      <div>
        <h3 class="text-sm font-semibold text-fg">VRAM &amp; Speech Resource Manager</h3>
        <p class="text-xs text-fg-subtle">
          Automatically unload local STT and TTS models after idle timeout or eject them manually to free GPU memory.
        </p>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex flex-col gap-1">
        <label for="speech-idle-timeout" class="text-xs font-medium text-fg-muted">
          Auto-Unload Idle Timeout (seconds)
        </label>
        <input
          id="speech-idle-timeout"
          type="number"
          min="5"
          max="3600"
          value={settingsStore.speechIdleTimeoutSec}
          onchange={(e) =>
            settingsStore.update({
              speechIdleTimeoutSec: Number((e.currentTarget as HTMLInputElement).value) || 60,
            })}
          class="h-8 w-36 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus:border-accent"
        />
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <Button
          variant="default"
          size="sm"
          onclick={() => handleEject("stt")}
          disabled={ejecting}
        >
          <PowerOff size={13} />
          <span>Eject STT</span>
        </Button>
        <Button
          variant="default"
          size="sm"
          onclick={() => handleEject("tts")}
          disabled={ejecting}
        >
          <PowerOff size={13} />
          <span>Eject TTS</span>
        </Button>
        <Button
          variant="danger"
          outline
          size="sm"
          onclick={() => handleEject("all")}
          disabled={ejecting}
        >
          <PowerOff size={13} />
          <span>Eject All</span>
        </Button>
      </div>
    </div>

    {#if statusMsg}
      <p class="text-xs text-fg-muted font-mono">{statusMsg}</p>
    {/if}
  </div>
</div>
