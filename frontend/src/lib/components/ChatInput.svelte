<script lang="ts">
  import { onMount } from "svelte";
  import {
    Send,
    Square,
    Paperclip,
    X,
    Mic,
    FileText,
    Wrench,
    Sparkles,
    Server,
    Clock,
    Pencil,
  } from "@lucide/svelte";
  import { fade } from "svelte/transition";
  import { chatStore } from "../stores/chat.svelte";
  import { artifactStore } from "../stores/artifact.svelte";
  import { settingsStore } from "../stores/settings.svelte";
  import { triggerCatalogStore } from "../stores/triggerCatalog.svelte";
  import { desktopWindow } from "../stores/window.svelte";
  import Button from "./ui/Button.svelte";
  import {
    serveUploadUrl,
    fetchModels,
    transcribeAudioBlob,
    fetchBuiltInTools,
    fetchMcpServers,
    fetchMcpTools,
    fetchSkills,
    fetchPromptTemplates,
  } from "../api";
  import { encodeToWav } from "../audio";
  import { createQuery } from "@tanstack/svelte-query";
  import type {
    PromptTemplateInfo,
    SessionFileItem,
    SlashToolSelection,
  } from "../types";
  import {
    extractPrefixTokens,
    formatTriggerToken,
  } from "../utils/inputTriggers";

  import MarkdownInput, { type EditorTriggerState } from "./MarkdownInput.svelte";
  import ToolsPopover from "./ToolsPopover.svelte";
  import PromptTemplatesModal from "./PromptTemplatesModal.svelte";

  let promptTemplatesModalOpen = $state(false);

  let fileInput: HTMLInputElement | undefined = $state();
  let isUploading = $derived(chatStore.isUploadingDraft);
  let markdownInputRef:
    | {
        focus: () => void;
        replaceRange: (from: number, to: number, text: string) => void;
      }
    | undefined = $state();

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest(
        "button, input, select, textarea, a, label, [role='button'], .markdown-input-editor",
      )
    ) {
      return;
    }
    markdownInputRef?.focus();
  }

  interface Props {
    floating?: boolean;
  }

  let { floating = false }: Props = $props();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  const builtInToolsQuery = createQuery(() => ({
    queryKey: ["builtinTools"],
    queryFn: fetchBuiltInTools,
  }));

  const mcpServersQuery = createQuery(() => ({
    queryKey: ["mcpServers"],
    queryFn: fetchMcpServers,
  }));

  const mcpToolsQuery = createQuery(() => ({
    queryKey: ["mcpTools"],
    queryFn: fetchMcpTools,
    refetchInterval: 15000,
  }));

  const skillsQuery = createQuery(() => ({
    queryKey: ["skills"],
    queryFn: fetchSkills,
  }));

  const promptTemplatesQuery = createQuery(() => ({
    queryKey: ["promptTemplates"],
    queryFn: fetchPromptTemplates,
  }));

  type SlashCatalogItem = {
    key: string;
    kind: SlashToolSelection["kind"];
    id: string;
    name: string;
    badge: string;
    description: string;
    isDisabled: boolean;
  };

  let sessionFiles = $derived(triggerCatalogStore.sessionFiles);

  let slashCatalog = $derived.by((): SlashCatalogItem[] => {
    const items: SlashCatalogItem[] = [];
    const disabledBuiltIn = new Set(settingsStore.disabledBuiltInTools);

    for (const tpl of promptTemplatesQuery.data ?? []) {
      items.push({
        key: `prompt:${tpl.id}`,
        kind: "prompt_template",
        id: tpl.id,
        name: tpl.name,
        badge: "Prompt",
        description: tpl.description || tpl.content,
        isDisabled: false,
      });
    }

    for (const t of builtInToolsQuery.data ?? []) {
      items.push({
        key: `builtin:${t.name}`,
        kind: "builtin_tool",
        id: t.name,
        name: t.name,
        badge: "Tool",
        description: t.description,
        isDisabled:
          !chatStore.conversationToolsEnabled ||
          disabledBuiltIn.has(t.name) ||
          (t.requiresNetwork && !settingsStore.networkToolsEnabled),
      });
    }

    for (const s of skillsQuery.data ?? []) {
      const isExcluded = chatStore.conversationExcludedSkills.includes(s.id);
      items.push({
        key: `skill:${s.id}`,
        kind: "skill",
        id: s.id,
        name: s.name,
        badge: "Skill",
        description: s.summary || s.description || "Skill instructions",
        isDisabled:
          !chatStore.conversationToolsEnabled || !s.isEnabled || isExcluded,
      });
    }

    const serverMap = new Map<string, boolean>();
    for (const srv of mcpServersQuery.data ?? []) {
      const isExcluded = chatStore.conversationExcludedMcps.includes(srv.id);
      const isSrvDisabled =
        !chatStore.conversationToolsEnabled || !srv.isEnabled || isExcluded;
      serverMap.set(srv.id, isSrvDisabled);
      items.push({
        key: `mcp:${srv.id}`,
        kind: "mcp_server",
        id: srv.id,
        name: srv.name,
        badge: "MCP",
        description: srv.summary || srv.commandOrUrl,
        isDisabled: isSrvDisabled,
      });
    }

    for (const mt of mcpToolsQuery.data ?? []) {
      items.push({
        key: `mcptool:${mt.name}`,
        kind: "mcp_tool",
        id: mt.name,
        name: mt.name,
        badge: mt.serverName,
        description: mt.description || `MCP tool on ${mt.serverName}`,
        isDisabled: serverMap.get(mt.serverId) ?? !chatStore.conversationToolsEnabled,
      });
    }

    return items;
  });

  $effect(() => {
    triggerCatalogStore.setSlashNames(slashCatalog.map((s) => s.name));
  });

  let activeTrigger = $state.raw<EditorTriggerState | null>(null);
  let lastTriggerKey: string | null = null;
  let dismissedTriggerKey = $state<string | null>(null);
  let highlightedIndex = $state(0);
  let popoverListEl: HTMLDivElement | undefined = $state();
  let prevDraftKey = chatStore.currentDraftKey;

  $effect(() => {
    const nextKey = chatStore.currentDraftKey;
    if (nextKey !== prevDraftKey) {
      prevDraftKey = nextKey;
      activeTrigger = null;
      lastTriggerKey = null;
      dismissedTriggerKey = null;
      highlightedIndex = 0;
      uploadError = null;
    }
  });

  function triggerKeyOf(t: EditorTriggerState | null): string | null {
    return t ? `${t.from}:${t.type}:${t.query}:${t.quoted}` : null;
  }

  let isTriggerVisible = $derived(
    Boolean(activeTrigger) && triggerKeyOf(activeTrigger) !== dismissedTriggerKey,
  );

  let filteredAtItems = $derived.by(() => {
    if (!activeTrigger || activeTrigger.type !== "@") return [];
    const q = activeTrigger.query.trim().toLowerCase();
    if (!q) return sessionFiles.slice(0, 80);
    return sessionFiles
      .filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.subtitle.toLowerCase().includes(q),
      )
      .slice(0, 80);
  });

  let filteredSlashItems = $derived.by(() => {
    if (!activeTrigger || activeTrigger.type !== "/") return [];
    const q = activeTrigger.query.trim().toLowerCase();
    if (!q) return slashCatalog;
    return slashCatalog.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  });

  let currentItemCount = $derived(
    activeTrigger?.type === "@"
      ? filteredAtItems.length
      : activeTrigger?.type === "/"
        ? filteredSlashItems.length
        : 0,
  );

  $effect(() => {
    // Keep highlight index in bounds whenever results change
    if (currentItemCount <= 0) {
      highlightedIndex = 0;
    } else if (highlightedIndex >= currentItemCount) {
      highlightedIndex = 0;
    }
  });

  function scrollHighlightedIntoView() {
    if (!popoverListEl) return;
    const el = popoverListEl.querySelector<HTMLElement>(
      `[data-trigger-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }

  let activeInjectedTools = $derived.by((): SlashToolSelection[] => {
    const tokens = extractPrefixTokens(chatStore.draftText, "/");
    const tokenSet = new Set(tokens.map((t) => t.toLowerCase()));
    const result: SlashToolSelection[] = [];
    const seen = new Set<string>();

    for (const sel of chatStore.draftSlashTools) {
      if (tokenSet.has(sel.name.toLowerCase())) {
        const key = `${sel.kind}:${sel.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(sel);
        }
      }
    }

    for (const tok of tokens) {
      const lower = tok.toLowerCase();
      const match = slashCatalog.find((item) => item.name.toLowerCase() === lower);
      if (match) {
        const key = `${match.kind}:${match.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ kind: match.kind, id: match.id, name: match.name });
        }
      }
    }

    return result;
  });

  function handleTriggerChange(trigger: EditorTriggerState | null) {
    const nextKey = triggerKeyOf(trigger);
    // Plain (non-reactive) bookkeeping so this handler can never become a
    // dependency of, or re-trigger, an effect.
    if (nextKey === lastTriggerKey) {
      // Same logical trigger; only the (unused) object identity changed.
      return;
    }
    lastTriggerKey = nextKey;
    activeTrigger = trigger;
    highlightedIndex = 0;
    if (dismissedTriggerKey !== null && nextKey !== dismissedTriggerKey) {
      dismissedTriggerKey = null;
    }
  }

  function selectAtItem(item: SessionFileItem) {
    if (!activeTrigger) return;
    const formatted = formatTriggerToken("@", item.name);
    markdownInputRef?.replaceRange(activeTrigger.from, activeTrigger.to, formatted);
    activeTrigger = null;
    lastTriggerKey = null;
  }

  function selectSlashItem(item: SlashCatalogItem) {
    if (!activeTrigger) return;
    const formatted = formatTriggerToken("/", item.name);
    markdownInputRef?.replaceRange(activeTrigger.from, activeTrigger.to, formatted);
    if (
      !chatStore.draftSlashTools.some(
        (s) => s.kind === item.kind && s.id === item.id,
      )
    ) {
      chatStore.draftSlashTools = [
        ...chatStore.draftSlashTools,
        { kind: item.kind, id: item.id, name: item.name },
      ];
    }
    activeTrigger = null;
    lastTriggerKey = null;
  }

  function removeSlashSelection(sel: SlashToolSelection) {
    chatStore.draftSlashTools = chatStore.draftSlashTools.filter(
      (s) => !(s.kind === sel.kind && s.id === sel.id),
    );
    const escaped = sel.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quotedRe = new RegExp(`(^|\\s)\\/"${escaped}"\\s?`, "gi");
    const plainRe = new RegExp(`(^|\\s)\\/${escaped}(?=\\s|$)\\s?`, "gi");
    chatStore.draftText = chatStore.draftText
      .replace(quotedRe, "$1")
      .replace(plainRe, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trimStart();
  }

  function handleTriggerKeydown(key: string): boolean {
    if (!isTriggerVisible || !activeTrigger) return false;

    if (key === "Escape") {
      dismissedTriggerKey = triggerKeyOf(activeTrigger);
      return true;
    }

    if (currentItemCount === 0) {
      return false;
    }

    if (key === "ArrowDown") {
      highlightedIndex = (highlightedIndex + 1) % currentItemCount;
      queueMicrotask(scrollHighlightedIntoView);
      return true;
    }

    if (key === "ArrowUp") {
      highlightedIndex = (highlightedIndex - 1 + currentItemCount) % currentItemCount;
      queueMicrotask(scrollHighlightedIntoView);
      return true;
    }

    if (key === "Enter" || key === "Tab") {
      if (activeTrigger.type === "@") {
        const item = filteredAtItems[highlightedIndex];
        if (item) selectAtItem(item);
      } else if (activeTrigger.type === "/") {
        const item = filteredSlashItems[highlightedIndex];
        if (item) selectSlashItem(item);
      }
      return true;
    }

    return false;
  }

  let selectedModelInfo = $derived(
    chatStore.selectedModel && modelsQuery.data
      ? modelsQuery.data.find((m) => m.id === chatStore.selectedModel)
      : undefined,
  );

  let allowedAccepts = $derived.by(() => {
    const types: string[] = [
      ".txt",
      ".md",
      ".pdf",
      ".py",
      ".ts",
      ".js",
      ".svelte",
      ".html",
      ".css",
      ".json",
      ".csv",
      ".c",
      ".cpp",
      ".rs",
      ".go",
      ".java",
      ".sh",
      ".yaml",
      ".yml",
      ".xml",
      ".doc",
      ".docx",
    ];
    if (selectedModelInfo?.canImage) types.push("image/*");
    if (selectedModelInfo?.canAudio) types.push("audio/*");
    if (selectedModelInfo?.canVideo) types.push("video/*");
    return types.join(",");
  });

  async function handleSend() {
    if (
      (!chatStore.draftText.trim() && chatStore.pendingAttachments.length === 0) ||
      isUploading
    )
      return;
    const toSend = chatStore.draftText;
    const injected =
      activeInjectedTools.length > 0 ? [...activeInjectedTools] : undefined;
    activeTrigger = null;
    lastTriggerKey = null;
    dismissedTriggerKey = null;
    if (chatStore.isStreaming || chatStore.activeEditingQueuedItem) {
      chatStore.enqueueMessage(toSend, injected);
      return;
    }
    await chatStore.send(toSend, injected);
  }

  let isDragging = $state(false);
  let dragCounter = 0;
  let uploadError = $state<string | null>(null);

  function getFileRejectionReason(file: File): string {
    const mimeType = file.type.toLowerCase();
    if (mimeType.startsWith("image/") && !selectedModelInfo?.canImage) {
      return `"${file.name}" rejected (image input is not enabled for the selected model).`;
    }
    if (mimeType.startsWith("audio/") && !selectedModelInfo?.canAudio) {
      return `"${file.name}" rejected (audio input is not enabled for the selected model).`;
    }
    if (mimeType.startsWith("video/") && !selectedModelInfo?.canVideo) {
      return `"${file.name}" rejected (video input is not enabled for the selected model).`;
    }
    return `"${file.name}" has an unsupported file type.`;
  }

  function isFileAllowed(file: File): boolean {
    if (!allowedAccepts) return false;
    const rules = allowedAccepts.split(",").map((r) => r.trim().toLowerCase());
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();

    return rules.some((rule) => {
      if (rule.endsWith("/*")) {
        const prefix = rule.slice(0, -1);
        return mimeType.startsWith(prefix);
      } else if (rule.startsWith(".")) {
        return fileName.endsWith(rule);
      } else {
        return mimeType === rule;
      }
    });
  }

  function isFileDragEvent(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes("Files");
  }

  function handleDragEnter(e: DragEvent) {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    if (isUploading) return;
    dragCounter++;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    isDragging = true;
  }

  function handleDragOver(e: DragEvent) {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    if (isUploading) return;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(e: DragEvent) {
    if (!isDragging && dragCounter === 0) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragging = false;
    }
  }

  async function processFilesForUpload(allFiles: File[]) {
    if (allFiles.length === 0 || isUploading) return;
    const allowed: File[] = [];
    const rejectedReasons: string[] = [];
    for (const file of allFiles) {
      if (isFileAllowed(file)) {
        allowed.push(file);
      } else {
        rejectedReasons.push(getFileRejectionReason(file));
      }
    }

    if (rejectedReasons.length > 0) {
      uploadError = rejectedReasons.join(" ");
    } else {
      uploadError = null;
    }

    if (allowed.length === 0) return;

    const targetKey = chatStore.currentDraftKey;
    const targetConvId = chatStore.activeConversationId;
    for (const file of allowed) {
      try {
        await chatStore.addAttachment(file, targetKey, targetConvId);
      } catch (err) {
        if (chatStore.currentDraftKey === targetKey) {
          uploadError = `Failed to upload "${file.name}": ${(err as Error).message || "Unknown error"}`;
        }
      }
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    isDragging = false;
    if (isUploading) return;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    await processFilesForUpload(Array.from(e.dataTransfer.files));
  }

  function decodeBase64ToUint8Array(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  onMount(() => {
    if (!desktopWindow.isTauri) return;
    const win = window as any;

    const onDragState = (state: "enter" | "leave") => {
      if (isUploading) return;
      isDragging = state === "enter";
      if (state === "leave") dragCounter = 0;
    };

    const onDragDrop = async (paths: string[]) => {
      dragCounter = 0;
      isDragging = false;
      if (!Array.isArray(paths) || paths.length === 0 || isUploading) return;
      const invoke = win.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return;
      try {
        const items = (await invoke("read_dropped_files", { paths })) as Array<{
          name: string;
          mimeType: string;
          base64: string;
        }>;
        const files = (items || []).map(
          (item) =>
            new File([decodeBase64ToUint8Array(item.base64) as BlobPart], item.name, {
              type: item.mimeType || "application/octet-stream",
            }),
        );
        await processFilesForUpload(files);
      } catch (err) {
        uploadError = `Failed to read dropped files: ${(err as Error)?.message || "Unknown error"}`;
      }
    };

    win.__blombrainDragState = onDragState;
    win.__blombrainDragDrop = onDragDrop;

    return () => {
      if (win.__blombrainDragState === onDragState) delete win.__blombrainDragState;
      if (win.__blombrainDragDrop === onDragDrop) delete win.__blombrainDragDrop;
    };
  });

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    await processFilesForUpload(Array.from(input.files));
    input.value = "";
  }

  // Voice recording (STT) state
  let isRecording = $state(false);
  let isTranscribing = $state(false);
  let activeRecorder: MediaRecorder | null = null;
  let activeStream: MediaStream | null = null;
  let activeBrowserRec: any = null;
  let nativeRecordingActive = false;
  let recordingDraftKey: string | null = null;

  async function toggleVoiceRecording() {
    if (isTranscribing) return;

    if (isRecording) {
      isRecording = false;
      if (nativeRecordingActive) {
        nativeRecordingActive = false;
        const targetKey = recordingDraftKey ?? chatStore.currentDraftKey;
        recordingDraftKey = null;
        isTranscribing = true;
        try {
          const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
          const b64 = (await invoke("stop_audio_recording", {})) as string;
          const wavBytes = decodeBase64ToUint8Array(b64);
          const wavFile = new File([wavBytes as BlobPart], "recording.wav", {
            type: "audio/wav",
          });
          const { text } = await transcribeAudioBlob(
            wavFile,
            wavFile.name,
            chatStore.selectedModel,
          );
          if (text.trim()) {
            chatStore.appendDraftText(targetKey, text);
          }
        } catch (err: any) {
          uploadError = `Voice recording failed: ${err?.message || "Check microphone and Speech settings."}`;
        } finally {
          isTranscribing = false;
        }
        return;
      }
      if (activeBrowserRec) {
        try { activeBrowserRec.stop(); } catch { }
        activeBrowserRec = null;
      }
      if (activeRecorder && activeRecorder.state !== "inactive") {
        activeRecorder.stop();
      }
      return;
    }

    uploadError = null;
    const SpeechRec =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (settingsStore.sttProvider === "browser" && !SpeechRec) {
      uploadError =
        "Browser Web Speech API is unavailable in this environment. Configure a Local CLI or OpenAI-compatible STT provider in Settings -> Speech.";
      return;
    }

    if (settingsStore.sttProvider === "browser" && SpeechRec) {
      try {
        const targetKey = chatStore.currentDraftKey;
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = false;
        rec.onresult = (event: any) => {
          let transcript = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              transcript += event.results[i][0].transcript + " ";
            }
          }
          if (transcript.trim()) {
            chatStore.appendDraftText(targetKey, transcript);
          }
        };
        rec.onerror = (ev: any) => {
          isRecording = false;
          activeBrowserRec = null;
          if (ev?.error && ev.error !== "aborted") {
            uploadError = `Voice input error: ${ev.error}`;
          }
        };
        rec.onend = () => {
          isRecording = false;
          activeBrowserRec = null;
        };
        activeBrowserRec = rec;
        isRecording = true;
        rec.start();
        return;
      } catch (err: any) {
        uploadError = `Browser speech recognition unavailable: ${err?.message || "Unknown error"}`;
        return;
      }
    }

    // In Tauri desktop on Linux, use native PipeWire/ALSA recording directly to 16kHz WAV
    // (avoids WebKitGTK's broken GStreamer getUserMedia constraints).
    if (desktopWindow.isTauri) {
      try {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
        recordingDraftKey = chatStore.currentDraftKey;
        await invoke("start_audio_recording", {});
        nativeRecordingActive = true;
        isRecording = true;
      } catch (err: any) {
        uploadError = `Microphone access denied or unavailable: ${err?.message || "Unknown error"}`;
        nativeRecordingActive = false;
        recordingDraftKey = null;
        isRecording = false;
      }
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      uploadError =
        "Microphone recording requires HTTPS or localhost (browsers disable navigator.mediaDevices on insecure HTTP origins).";
      return;
    }

    // MediaRecorder -> WAV -> Backend /api/speech/transcribe
    try {
      const targetKey = chatStore.currentDraftKey;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || "");
        if (firstErr?.name === "OverconstrainedError" || /invalid constraint/i.test(msg)) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: {} });
        } else {
          throw firstErr;
        }
      }
      activeStream = stream;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      activeRecorder = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        activeStream = null;
        activeRecorder = null;
        isRecording = false;

        if (chunks.length === 0) return;
        isTranscribing = true;
        try {
          const rawBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const rawFile = new File([rawBlob], "recording.webm", { type: rawBlob.type });
          const wavFile = await encodeToWav(rawFile);
          const { text } = await transcribeAudioBlob(
            wavFile,
            wavFile.name,
            chatStore.selectedModel,
          );
          if (text.trim()) {
            chatStore.appendDraftText(targetKey, text);
          }
        } catch (err: any) {
          uploadError = `Transcription failed: ${err?.message || "Check Speech settings."}`;
        } finally {
          isTranscribing = false;
        }
      };

      isRecording = true;
      recorder.start();
    } catch (err: any) {
      uploadError = `Microphone access denied or unavailable: ${err?.message || "Unknown error"}`;
      isRecording = false;
    }
  }
</script>

<div class="relative {floating ? 'w-full sm:px-6' : 'sm:px-6 sm:pb-3'}">
  {#if !floating}
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 top-20 z-0 bg-linear-to-t from-bg-inset via-bg-inset/85 to-transparent"
    ></div>
  {/if}
  <div
    class="relative z-10 mx-auto flex max-w-3xl lg:max-w-4xl xl:max-w-5xl flex-col gap-2"
  >
    {#if uploadError}
      <div
        role="alert"
        class="flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger"
      >
        <span>{uploadError}</span>
        <button
          type="button"
          onclick={() => (uploadError = null)}
          aria-label="Dismiss upload error"
          class="shrink-0 rounded-sm p-0.5 hover:bg-danger/20 cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>
    {/if}

    <!-- Queued Follow-Up Messages -->
    {#if chatStore.queuedMessages.length > 0}
      <div class="flex flex-col gap-1 px-1">
        {#if chatStore.queuedMessages.length > 2}
          <div class="flex items-center justify-between px-1 text-[10px] font-medium text-fg-subtle">
            <span>Queued follow-ups ({chatStore.queuedMessages.length})</span>
            <button
              type="button"
              onclick={() => chatStore.clearQueuedMessages()}
              class="text-fg-muted hover:text-danger transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
        {/if}
        <div class="flex max-h-32 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5">
          {#each chatStore.queuedMessages as qm, qIdx (qm.id)}
            <div
              transition:fade={{ duration: 120 }}
              class="flex shrink-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors {qm.isEditing
                ? 'border-accent bg-accent/20'
                : 'border-accent/35 bg-accent/10'}"
            >
              <div class="flex items-center gap-2 min-w-0">
                <Clock size={12} class="shrink-0 text-accent" />
                <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent">
                  {qm.isEditing ? "Editing" : "Queued"}{chatStore.queuedMessages.length > 1 ? ` #${qIdx + 1}` : ""}
                </span>
                <span class="truncate text-fg">
                  {qm.text || `${qm.attachments.length} attachment(s)`}
                </span>
                {#if qm.text && qm.attachments.length > 0}
                  <span class="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-fg-muted border border-line">
                    +{qm.attachments.length} file{qm.attachments.length === 1 ? "" : "s"}
                  </span>
                {/if}
              </div>
              <div class="flex items-center gap-1 shrink-0">
                {#if qm.isEditing}
                  <button
                    type="button"
                    onclick={() => chatStore.cancelEditQueuedMessage()}
                    aria-label="Cancel editing queued message"
                    title="Cancel edit"
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-muted hover:bg-bg-elevated hover:text-fg cursor-pointer"
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    type="button"
                    onclick={() => chatStore.editQueuedMessage(qm.id)}
                    aria-label="Edit queued message"
                    title="Edit queued message"
                    class="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg cursor-pointer"
                  >
                    <Pencil size={11} />
                  </button>
                {/if}
                <button
                  type="button"
                  onclick={() => chatStore.removeQueuedMessage(qm.id)}
                  aria-label="Cancel queued message"
                  title="Cancel queued message"
                  class="rounded p-1 text-fg-muted hover:bg-danger/15 hover:text-danger cursor-pointer"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Attachment Thumbnails -->
    {#if chatStore.pendingAttachments.length > 0 || isUploading}
      <div class="flex flex-wrap gap-2 px-1">
        {#each chatStore.pendingAttachments as att (att.id)}
          <div
            class="group relative flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated overflow-hidden shadow-xs"
          >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              onclick={() => (chatStore.selectedAttachment = att)}
              class="h-full w-full flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity"
            >
              {#if att.mimeType.startsWith("image/")}
                <img
                  src={serveUploadUrl(att.id)}
                  alt={att.originalName}
                  class="h-full w-full object-cover"
                />
              {:else if att.mimeType.startsWith("video/")}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  src={serveUploadUrl(att.id)}
                  class="h-full w-full object-cover pointer-events-none"
                  muted
                  preload="metadata"
                ></video>
              {:else if att.mimeType.startsWith("audio/")}
                <div class="text-[9px] text-fg-subtle font-mono">Audio</div>
              {:else}
                <div
                  class="text-[9px] text-fg-subtle truncate max-w-full px-1 font-mono"
                >
                  {att.originalName}
                </div>
              {/if}
            </div>
            <button
              type="button"
              onclick={(e) => {
                e.stopPropagation();
                chatStore.removeAttachment(att.id);
              }}
              class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-inset/90 text-fg opacity-0 transition-all duration-150 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-danger hover:text-danger-fg z-10 cursor-pointer shadow-xs"
              aria-label="Remove attachment"
              title="Remove attachment"
            >
              <X size={11} />
            </button>
          </div>
        {/each}
        {#if isUploading}
          <div
            class="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-elevated"
          >
            <span class="animate-spin text-fg-subtle text-xs">⟳</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Main Input Box -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      ondragenter={handleDragEnter}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      onclick={handleContainerClick}
      class="input-container relative flex flex-col {floating
        ? 'rounded-xl border'
        : 'sm:rounded-xl border-t sm:border'}
     bg-bg-elevated p-2.5 cursor-text hover:border-accent transition-all duration-150
     {isDragging ? 'border-accent!' : ''} {floating
        ? 'shadow-lg'
        : 'shadow-sm'}"
    >
      {#if isTriggerVisible && activeTrigger}
        <div
          bind:this={popoverListEl}
          class="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-bg-elevated p-1.5 shadow-xl"
          role="listbox"
          aria-label={activeTrigger.type === "@"
            ? "Session files"
            : "Tools, skills, and MCP servers"}
        >
          <div class="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            <span>
              {activeTrigger.type === "@"
                ? "Session Files"
                : "Prompts, Tools, Skills & MCPs"}
            </span>
            <div class="flex items-center gap-2">
              {#if activeTrigger.type === "/"}
                <button
                  type="button"
                  onmousedown={(e) => {
                    e.preventDefault();
                    promptTemplatesModalOpen = true;
                  }}
                  class="font-semibold normal-case text-accent hover:underline cursor-pointer"
                >
                  Manage Prompts
                </button>
              {/if}
              <span class="font-normal normal-case text-fg-subtle">
                {#if activeTrigger.quoted}
                  Quoted search (close with ")
                {:else}
                  Use {activeTrigger.type}"..." for spaces
                {/if}
              </span>
            </div>
          </div>

          {#if activeTrigger.type === "@"}
            {#if filteredAtItems.length === 0}
              <div class="px-2.5 py-2 text-xs text-fg-subtle">
                {sessionFiles.length === 0
                  ? "No files in this session yet."
                  : `No session files matching "${activeTrigger.query}"`}
              </div>
            {:else}
              {#each filteredAtItems as item, idx (item.id + ":" + item.name)}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlightedIndex}
                  data-trigger-index={idx}
                  onmousedown={(e) => {
                    e.preventDefault();
                    selectAtItem(item);
                  }}
                  onmouseenter={() => (highlightedIndex = idx)}
                  class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer {idx ===
                  highlightedIndex
                    ? 'bg-accent/15 text-fg'
                    : 'text-fg-muted hover:bg-bg-inset'}"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <FileText size={13} class="shrink-0 text-accent" />
                    <span class="truncate font-medium text-fg">{item.name}</span>
                  </div>
                  <span class="shrink-0 rounded-sm bg-bg-inset px-1.5 py-0.5 text-[10px] text-fg-subtle">
                    {item.subtitle}
                  </span>
                </button>
              {/each}
            {/if}
          {:else if activeTrigger.type === "/"}
            {#if filteredSlashItems.length === 0}
              <div class="px-2.5 py-2 text-xs text-fg-subtle">
                No tools, skills, or MCP servers matching "{activeTrigger.query}"
              </div>
            {:else}
              {#each filteredSlashItems as item, idx (item.key)}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlightedIndex}
                  data-trigger-index={idx}
                  onmousedown={(e) => {
                    e.preventDefault();
                    selectSlashItem(item);
                  }}
                  onmouseenter={() => (highlightedIndex = idx)}
                  class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer {idx ===
                  highlightedIndex
                    ? 'bg-accent/15 text-fg'
                    : 'text-fg-muted hover:bg-bg-inset'}"
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    {#if item.kind === "prompt_template"}
                      <FileText size={13} class="shrink-0 text-accent" />
                    {:else if item.kind === "skill"}
                      <Sparkles size={13} class="shrink-0 text-accent" />
                    {:else if item.kind === "mcp_server"}
                      <Server size={13} class="shrink-0 text-accent" />
                    {:else}
                      <Wrench size={13} class="shrink-0 text-accent" />
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate font-medium text-fg">{item.name}</span>
                        {#if item.isDisabled}
                          <span class="shrink-0 rounded-sm bg-bg-inset px-1 py-0.5 text-[9px] text-fg-subtle">
                            off - will force-inject
                          </span>
                        {/if}
                      </div>
                      {#if item.description}
                        <p class="truncate text-[10px] text-fg-subtle">
                          {item.description}
                        </p>
                      {/if}
                    </div>
                  </div>
                  <span class="shrink-0 rounded-sm bg-bg-inset px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                    {item.badge}
                  </span>
                </button>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}

      {#if activeInjectedTools.length > 0}
        <div class="mb-1.5 flex flex-wrap items-center gap-1 px-1">
          <span class="text-[10px] font-medium text-fg-subtle mr-0.5">
            Direct inject:
          </span>
          {#each activeInjectedTools as sel (sel.kind + ":" + sel.id)}
            <span class="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-fg">
              <span>/{sel.name}</span>
              <button
                type="button"
                onclick={(e) => {
                  e.stopPropagation();
                  removeSlashSelection(sel);
                }}
                aria-label="Remove {sel.name}"
                class="rounded-xs p-0.5 text-fg-subtle hover:bg-bg-inset hover:text-fg cursor-pointer"
              >
                <X size={10} />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      {#if isDragging}
        <div
          transition:fade={{ duration: 150 }}
          class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-accent bg-bg-elevated text-accent shadow-md"
        >
          <Paperclip size={22} class="animate-bounce" />
          <span class="text-xs font-semibold text-fg"
            >Drop file to add as an attachment</span
          >
        </div>
      {/if}
      {#if allowedAccepts}
        <input
          type="file"
          bind:this={fileInput}
          onchange={handleFileSelect}
          accept={desktopWindow.isTauri ? undefined : allowedAccepts}
          multiple
          class="hidden"
        />
      {/if}

      <!-- Textarea Row replaced with MarkdownInput -->
      <MarkdownInput
        bind:this={markdownInputRef}
        bind:value={chatStore.draftText}
        onSubmit={handleSend}
        onPasteFiles={processFilesForUpload}
        onTriggerChange={handleTriggerChange}
        onTriggerKeydown={handleTriggerKeydown}
        validAtNames={sessionFiles.map((f) => f.name)}
        validSlashNames={slashCatalog.map((s) => s.name)}
        disabled={isUploading}
        disableSubmit={false}
        placeholder={chatStore.isStreaming
          ? "Queue follow-up message… (Enter to queue)"
          : "Message Blombrain… (@ files, / tools)"}
      />

      <!-- Bottom Action Bar Row -->
      <div class="flex items-center justify-between pt-1.5">
        <!-- Left Side Tools (Attachments, MCP/Skills, Voice Input) -->
        <div class="flex items-center gap-1">
          {#if allowedAccepts}
            <Button
              variant="default"
              outline
              size="icon"
              onclick={() => fileInput?.click()}
              disabled={isUploading}
              aria-label="Add attachment"
              title="Add attachment"
            >
              <Paperclip size={16} />
            </Button>
          {/if}
          <ToolsPopover />
          <Button
            variant="default"
            outline
            size="icon"
            onclick={() => (promptTemplatesModalOpen = true)}
            aria-label="Prompt templates"
            title="Reusable slash prompt templates (/commands)"
          >
            <FileText size={15} />
          </Button>
          <Button
            variant={isRecording ? "danger" : "default"}
            outline={!isRecording}
            size="icon"
            onclick={toggleVoiceRecording}
            disabled={isTranscribing}
            aria-label={isRecording ? "Stop voice input" : "Start voice input (STT)"}
            title={isRecording
              ? "Stop voice recording"
              : isTranscribing
                ? "Transcribing voice input..."
                : "Voice input (STT)"}
          >
            {#if isTranscribing}
              <span class="animate-spin text-xs">⟳</span>
            {:else if isRecording}
              <Square size={13} />
            {:else}
              <Mic size={15} />
            {/if}
          </Button>
        </div>

        <!-- Right Side Actions (Queue / Send / Stop) -->
        <div class="flex items-center gap-2">
          {#if chatStore.activeEditingQueuedItem}
            {@const editingItem = chatStore.activeEditingQueuedItem}
            <Button
              variant="ghost"
              outline
              onclick={() => chatStore.cancelEditQueuedMessage()}
              class="px-2.5! py-1.5! h-8 text-xs font-medium"
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              onclick={handleSend}
              disabled={(!chatStore.draftText.trim() &&
                chatStore.pendingAttachments.length === 0) ||
                isUploading}
              aria-label="Save queued message"
              class="px-3! py-1.5! h-8 text-xs font-semibold"
            >
              Save #{editingItem.index + 1}
            </Button>
            {#if chatStore.isStreaming}
              <Button
                variant="danger"
                onclick={() => chatStore.stop()}
                aria-label="Stop generating"
                class="px-3! py-1.5! h-8 text-xs font-semibold"
              >
                <Square size={13} />
                Stop
              </Button>
            {/if}
          {:else if chatStore.isStreaming}
            {#if chatStore.draftText.trim() || chatStore.pendingAttachments.length > 0}
              <Button
                variant="default"
                outline
                onclick={handleSend}
                disabled={isUploading}
                aria-label="Queue follow-up message"
                title="Send automatically when current response finishes"
                class="px-2.5! py-1.5! h-8 text-xs font-medium"
              >
                <Clock size={12} />
                Queue
              </Button>
            {/if}
            <Button
              variant="danger"
              onclick={() => chatStore.stop()}
              aria-label="Stop generating"
              class="px-3! py-1.5! h-8 text-xs font-semibold"
            >
              <Square size={13} />
              Stop
            </Button>
          {:else}
            <Button
              variant="accent"
              onclick={handleSend}
              disabled={(!chatStore.draftText.trim() &&
                chatStore.pendingAttachments.length === 0) ||
                isUploading}
              aria-label="Send message"
              class="px-3! py-1.5! h-8 text-xs font-semibold"
            >
              <Send size={13} />
              Send
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<PromptTemplatesModal
  isOpen={promptTemplatesModalOpen}
  onclose={() => (promptTemplatesModalOpen = false)}
  onselect={(tpl: PromptTemplateInfo) => {
    const token = formatTriggerToken("/", tpl.name);
    const cur = chatStore.draftText;
    const prefix = cur && !/\s$/.test(cur) ? " " : "";
    chatStore.draftText = `${cur}${prefix}${token}`;
  }}
/>

<style>
  .input-container:focus-within,
  .input-container:focus-within:hover {
    border-color: var(--accent) !important;
    box-shadow: none !important;
  }
</style>
