<script lang="ts">
  import {
    FolderOpen,
    Folder,
    ChevronRight,
    ChevronDown,
    GitBranch,
    GitCompare,
    Lock,
    LockOpen,
    ShieldAlert,
    RefreshCw,
    Unlink,
    Check,
    X,
    FileText,
    AtSign,
    Eye,
    RotateCcw,
    Search,
  } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { chatStore } from "../stores/chat.svelte";
  import { artifactStore } from "../stores/artifact.svelte";
  import { desktopWindow } from "../stores/window.svelte";
  import {
    hasNativeWorkspacePicker,
    pickNativeWorkspaceDirectory,
    fetchConversationWorkspaceFile,
    fetchWorkspaceFileByPath,
    fetchWorkspaceCheckpoints,
    fetchConversationGitDiff,
    fetchWorkspaceGitDiffByPath,
  } from "../api";
  import type { WorkspaceApprovalMode, WorkspaceCheckpointInfo } from "../types";
  import { formatTriggerToken } from "../utils/inputTriggers";
  import Button from "./ui/Button.svelte";

  const RECENT_WORKSPACES_KEY = "blombrain_recent_workspaces";

  let isOpen = $state(false);
  let activeTab = $state<"config" | "files" | "checkpoints">("config");
  let pathInput = $state("");
  let writeEnabledInput = $state(false);
  let approvalModeInput = $state<WorkspaceApprovalMode>("auto");
  let isSaving = $state(false);
  let errorMsg = $state<string | null>(null);
  let recentPaths = $state<string[]>([]);
  let fileFilterQuery = $state("");
  let checkpoints = $state<WorkspaceCheckpointInfo[]>([]);
  let isLoadingCheckpoints = $state(false);
  let revertingId = $state<string | null>(null);
  let expandedDirs = $state<Record<string, boolean>>({});
  let isLoadingGitDiff = $state(false);

  let gitStatus = $derived(chatStore.workspaceGitStatus);
  let gitFileMap = $derived.by(() => {
    const map = new Map<string, string>();
    if (gitStatus?.files) {
      for (const f of gitStatus.files) {
        map.set(f.path, f.code);
      }
    }
    return map;
  });

  interface TreeRow {
    kind: "dir" | "file";
    name: string;
    path: string;
    depth: number;
    fileCount?: number;
  }

  let visibleTreeRows = $derived.by<TreeRow[]>(() => {
    const files = chatStore.workspaceFiles;
    if (files.length === 0) return [];

    interface DirNode {
      name: string;
      path: string;
      dirs: Map<string, DirNode>;
      files: Array<{ name: string; path: string }>;
      totalFiles: number;
    }

    const root: DirNode = { name: "", path: "", dirs: new Map(), files: [], totalFiles: 0 };
    for (const rel of files) {
      const parts = rel.split("/").filter(Boolean);
      if (parts.length === 0) continue;
      let cur = root;
      cur.totalFiles++;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        const dirPath = cur.path ? `${cur.path}/${seg}` : seg;
        let next = cur.dirs.get(seg);
        if (!next) {
          next = { name: seg, path: dirPath, dirs: new Map(), files: [], totalFiles: 0 };
          cur.dirs.set(seg, next);
        }
        next.totalFiles++;
        cur = next;
      }
      cur.files.push({ name: parts[parts.length - 1], path: rel });
    }

    const rows: TreeRow[] = [];
    const walk = (node: DirNode, depth: number) => {
      const sortedDirs = Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
      for (const d of sortedDirs) {
        rows.push({ kind: "dir", name: d.name, path: d.path, depth, fileCount: d.totalFiles });
        if (expandedDirs[d.path]) {
          walk(d, depth + 1);
        }
      }
      const sortedFiles = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
      for (const f of sortedFiles) {
        rows.push({ kind: "file", name: f.name, path: f.path, depth });
      }
    };

    walk(root, 0);
    return rows.slice(0, 400);
  });

  function toggleDir(dirPath: string) {
    expandedDirs = {
      ...expandedDirs,
      [dirPath]: !expandedDirs[dirPath],
    };
  }

  async function handleReviewGitDiff() {
    if (!effectivePath || isLoadingGitDiff) return;
    isLoadingGitDiff = true;
    errorMsg = null;
    try {
      const res = chatStore.activeConversationId
        ? await fetchConversationGitDiff(chatStore.activeConversationId)
        : await fetchWorkspaceGitDiffByPath(effectivePath);
      if (!res.isGitRepo) {
        errorMsg = "This workspace is not a Git repository.";
        return;
      }
      if (!res.diff.trim()) {
        errorMsg = "No uncommitted git diff found in this workspace.";
        return;
      }
      const prompt = `Please review the following uncommitted git diff in this workspace for bugs, edge cases, security issues, and maintainability:\n\n\`\`\`diff\n${res.diff}\n\`\`\``;
      chatStore.draftText = chatStore.draftText.trim()
        ? `${chatStore.draftText.trim()}\n\n${prompt}`
        : prompt;
      isOpen = false;
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to load git diff.";
    } finally {
      isLoadingGitDiff = false;
    }
  }

  function loadRecentWorkspaces() {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(RECENT_WORKSPACES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        recentPaths = parsed
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .slice(0, 5);
      }
    } catch { }
  }

  function recordRecentWorkspace(dirPath: string) {
    if (typeof localStorage === "undefined" || !dirPath.trim()) return;
    try {
      const clean = dirPath.trim();
      const next = [clean, ...recentPaths.filter((p) => p !== clean)].slice(0, 5);
      recentPaths = next;
      localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
    } catch { }
  }

  function removeRecentWorkspace(dirPath: string) {
    recentPaths = recentPaths.filter((p) => p !== dirPath);
    if (typeof localStorage === "undefined") return;
    try {
      if (recentPaths.length === 0) {
        localStorage.removeItem(RECENT_WORKSPACES_KEY);
      } else {
        localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(recentPaths));
      }
    } catch { }
  }

  function clearRecentWorkspaces() {
    recentPaths = [];
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(RECENT_WORKSPACES_KEY);
    } catch { }
  }

  function getBasename(p: string | null): string {
    if (!p) return "";
    const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || normalized || "/";
  }

  let effectivePath = $derived(chatStore.effectiveWorkspacePath);
  let effectiveWrite = $derived(chatStore.effectiveWorkspaceWriteEnabled);
  let effectiveApproval = $derived(chatStore.effectiveWorkspaceApprovalMode);
  let source = $derived(chatStore.workspaceSource);
  let basename = $derived(getBasename(effectivePath));

  let activeModeKey = $derived<"ro" | "ask" | "rw">(
    !(effectivePath ? effectiveWrite : writeEnabledInput)
      ? "ro"
      : (effectivePath ? effectiveApproval : approvalModeInput) === "ask"
        ? "ask"
        : "rw",
  );

  let filteredWorkspaceFiles = $derived.by(() => {
    const q = fileFilterQuery.trim().toLowerCase();
    const all = chatStore.workspaceFiles;
    if (!q) return all.slice(0, 200);
    return all.filter((f) => f.toLowerCase().includes(q)).slice(0, 200);
  });

  async function refreshCheckpointsList() {
    if (!chatStore.activeConversationId) {
      checkpoints = [];
      return;
    }
    isLoadingCheckpoints = true;
    try {
      checkpoints = await fetchWorkspaceCheckpoints(chatStore.activeConversationId);
    } catch {
      checkpoints = [];
    } finally {
      isLoadingCheckpoints = false;
    }
  }

  function openPopover() {
    isOpen = !isOpen;
    if (isOpen) {
      loadRecentWorkspaces();
      pathInput = chatStore.conversationWorkspacePath ?? chatStore.effectiveWorkspacePath ?? "";
      writeEnabledInput = chatStore.effectiveWorkspaceWriteEnabled;
      approvalModeInput = chatStore.effectiveWorkspaceApprovalMode;
      errorMsg = null;
      fileFilterQuery = "";
      if (!effectivePath) {
        activeTab = "config";
      }
      if (chatStore.activeConversationId) {
        void refreshCheckpointsList();
      } else {
        checkpoints = [];
      }
    }
  }

  async function handleBrowse() {
    errorMsg = null;
    try {
      const chosen = await pickNativeWorkspaceDirectory();
      if (chosen) {
        pathInput = chosen;
        await applyWorkspace(chosen, writeEnabledInput, approvalModeInput);
      }
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to open folder picker.";
    }
  }

  async function applyWorkspace(
    targetPath: string,
    writeFlag: boolean,
    approvalFlag: WorkspaceApprovalMode = approvalModeInput,
  ) {
    const clean = targetPath.trim();
    if (!clean) {
      errorMsg = "Enter a local directory path.";
      return;
    }
    isSaving = true;
    errorMsg = null;
    try {
      await chatStore.setConversationWorkspace(clean, writeFlag, approvalFlag);
      pathInput = chatStore.effectiveWorkspacePath ?? clean;
      writeEnabledInput = chatStore.effectiveWorkspaceWriteEnabled;
      approvalModeInput = chatStore.effectiveWorkspaceApprovalMode;
      recordRecentWorkspace(chatStore.effectiveWorkspacePath ?? clean);
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to attach workspace.";
    } finally {
      isSaving = false;
    }
  }

  async function handleDetach() {
    isSaving = true;
    errorMsg = null;
    try {
      await chatStore.setConversationWorkspace(null, false, "auto");
      pathInput = chatStore.effectiveWorkspacePath ?? "";
      writeEnabledInput = chatStore.effectiveWorkspaceWriteEnabled;
      approvalModeInput = chatStore.effectiveWorkspaceApprovalMode;
      activeTab = "config";
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to detach workspace.";
    } finally {
      isSaving = false;
    }
  }

  async function selectAccessMode(mode: "ro" | "ask" | "rw") {
    const nextWrite = mode !== "ro";
    const nextApproval: WorkspaceApprovalMode = mode === "ask" ? "ask" : "auto";
    writeEnabledInput = nextWrite;
    approvalModeInput = nextApproval;
    if (!effectivePath) return;
    isSaving = true;
    errorMsg = null;
    try {
      await chatStore.setConversationWorkspaceWriteEnabled(nextWrite, nextApproval);
    } catch (err) {
      writeEnabledInput = effectiveWrite;
      approvalModeInput = effectiveApproval;
      errorMsg = (err as Error).message || "Failed to update access mode.";
    } finally {
      isSaving = false;
    }
  }

  async function handlePreviewFile(relPath: string) {
    if (!effectivePath) return;
    try {
      const convId = chatStore.activeConversationId;
      const preview = convId
        ? await fetchConversationWorkspaceFile(convId, relPath)
        : await fetchWorkspaceFileByPath(effectivePath, relPath);
      artifactStore.openArtifact(
        {
          id: `workspace:${preview.path}`,
          filename: preview.path,
          conversationId: convId ?? undefined,
          code: preview.content,
          language: preview.language || "text",
          title: preview.path,
        },
        false,
      );
      isOpen = false;
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to preview file.";
    }
  }

  function handleInsertMention(relPath: string) {
    const token = formatTriggerToken("@", relPath);
    const current = chatStore.draftText;
    const prefix = current && !/\s$/.test(current) ? " " : "";
    chatStore.draftText = `${current}${prefix}${token}`;
    isOpen = false;
  }

  async function handleRevertCheckpoint(cp: WorkspaceCheckpointInfo) {
    if (cp.isReverted || revertingId) return;
    revertingId = cp.id;
    errorMsg = null;
    try {
      await chatStore.revertCheckpoint(cp.id, cp.toolCallId);
      await refreshCheckpointsList();
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to revert checkpoint.";
    } finally {
      revertingId = null;
    }
  }
</script>

<div class="relative shrink-0">
  <button
    type="button"
    onclick={openPopover}
    aria-label="Project workspace settings"
    aria-expanded={isOpen}
    title={effectivePath
      ? `Workspace: ${effectivePath} (${!effectiveWrite ? "Read-Only" : effectiveApproval === "ask" ? "Ask Before Writing" : "Read-Write"}${source === "folder" ? ", inherited from folder" : ""})`
      : "Attach a local project directory as workspace"}
    class="flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors cursor-pointer {effectivePath ||
    isOpen
      ? 'border-accent text-accent bg-accent/10'
      : 'border-line bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-hover'}"
  >
    <FolderOpen size={13} class="shrink-0" />
    {#if effectivePath}
      <span class="hidden @[680px]:inline max-w-28 truncate font-medium">{basename}</span>
      {#if source === "folder"}
        <span
          class="hidden @[780px]:inline rounded bg-bg-inset px-1 py-0.2 font-mono text-[9px] text-fg-subtle border border-line"
        >
          Folder
        </span>
      {/if}
      <span
        class="hidden @[680px]:inline rounded px-1 py-0.2 font-mono text-[9px] font-semibold {!effectiveWrite
          ? 'bg-bg-inset text-fg-subtle'
          : effectiveApproval === 'ask'
            ? 'bg-accent/20 text-accent'
            : 'bg-warning/20 text-warning'}"
      >
        {!effectiveWrite ? "RO" : effectiveApproval === "ask" ? "ASK" : "RW"}
      </span>
    {:else}
      <span class="hidden @[680px]:inline">Workspace</span>
    {/if}
  </button>

  {#if isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
      class="fixed inset-0 z-40"
      onclick={() => (isOpen = false)}
    ></div>

    <div
      data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
      transition:fly={{ y: -6, duration: 150 }}
      class="absolute left-0 top-full mt-1.5 z-50 w-80 sm:w-[420px] rounded-xl border border-line bg-bg-elevated p-3.5 shadow-2xl space-y-3 text-xs"
    >
      <div class="flex items-center justify-between border-b border-line pb-2">
        <div class="flex items-center gap-1.5">
          <FolderOpen size={14} class="text-accent" />
          <span class="font-semibold text-fg">Project Workspace</span>
        </div>
        {#if effectivePath}
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={() => {
                void chatStore.refreshWorkspaceFiles();
                void refreshCheckpointsList();
              }}
              title="Refresh indexed workspace files"
              aria-label="Refresh workspace files"
              class="rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg transition-colors cursor-pointer"
            >
              <RefreshCw size={12} />
            </button>
            {#if source === "conversation"}
              <button
                type="button"
                onclick={handleDetach}
                disabled={isSaving}
                class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger/15 transition-colors cursor-pointer disabled:opacity-40"
              >
                <Unlink size={11} />
                <span>Detach</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if effectivePath}
        <!-- Navigation Tabs: Settings / File Explorer / Edit Checkpoints -->
        <div class="flex items-center gap-1 rounded-lg border border-line bg-bg-inset p-0.5">
          <button
            type="button"
            onclick={() => (activeTab = "config")}
            class="flex-1 rounded-md py-1 text-center text-[11px] font-medium transition-colors cursor-pointer {activeTab ===
            'config'
              ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
              : 'text-fg-muted hover:text-fg'}"
          >
            Settings
          </button>
          <button
            type="button"
            onclick={() => (activeTab = "files")}
            class="flex-1 rounded-md py-1 text-center text-[11px] font-medium transition-colors cursor-pointer {activeTab ===
            'files'
              ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
              : 'text-fg-muted hover:text-fg'}"
          >
            Files ({chatStore.workspaceFiles.length})
          </button>
          {#if chatStore.activeConversationId}
            <button
              type="button"
              onclick={() => {
                activeTab = "checkpoints";
                void refreshCheckpointsList();
              }}
              class="flex-1 rounded-md py-1 text-center text-[11px] font-medium transition-colors cursor-pointer {activeTab ===
              'checkpoints'
                ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
                : 'text-fg-muted hover:text-fg'}"
            >
              Edits ({checkpoints.length})
            </button>
          {/if}
        </div>
      {/if}

      {#if !effectivePath || activeTab === "config"}
        {#if effectivePath}
          <div class="rounded-lg border border-line bg-bg-inset p-2.5 space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                {source === "folder" ? "Inherited from Chat Folder" : "Active Conversation Workspace"}
              </span>
              <span class="font-mono text-[10px] text-fg-subtle">
                {chatStore.workspaceFiles.length} file{chatStore.workspaceFiles.length === 1 ? "" : "s"}
              </span>
            </div>
            <p class="font-mono text-[11px] text-fg break-all select-all">
              {effectivePath}
            </p>
            {#if gitStatus?.isGitRepo}
              <div class="flex items-center justify-between gap-2 pt-1 border-t border-line/60">
                <div class="flex items-center gap-1.5 min-w-0 font-mono text-[10px] text-fg-muted">
                  <GitBranch size={11} class="shrink-0 text-accent" />
                  <span class="truncate font-semibold text-fg">{gitStatus.branch || "HEAD"}</span>
                  {#if gitStatus.ahead > 0 || gitStatus.behind > 0}
                    <span class="text-fg-subtle">
                      {gitStatus.ahead > 0 ? `+${gitStatus.ahead}` : ""}{gitStatus.behind > 0 ? ` -${gitStatus.behind}` : ""}
                    </span>
                  {/if}
                  {#if gitStatus.files.length > 0}
                    <span class="rounded bg-warning/15 px-1 py-0.2 text-[9px] font-semibold text-warning">
                      {gitStatus.files.length} changed
                    </span>
                  {:else}
                    <span class="text-success text-[9px]">clean</span>
                  {/if}
                </div>
                {#if gitStatus.files.length > 0}
                  <button
                    type="button"
                    onclick={handleReviewGitDiff}
                    disabled={isLoadingGitDiff}
                    class="shrink-0 inline-flex items-center gap-1 rounded-md border border-line bg-bg-elevated px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <GitCompare size={10} />
                    <span>{isLoadingGitDiff ? "Loading..." : "Review diff"}</span>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <div class="flex flex-col gap-1.5">
          <label for="conv-workspace-path-input" class="text-[11px] font-medium text-fg-muted">
            {source === "folder" ? "Override Workspace Path for This Chat" : "Workspace Directory Path"}
          </label>
          <div class="flex items-center gap-1.5">
            <input
              id="conv-workspace-path-input"
              type="text"
              bind:value={pathInput}
              placeholder="/path/to/project/directory"
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void applyWorkspace(pathInput, writeEnabledInput, approvalModeInput);
                }
              }}
              class="h-8 flex-1 min-w-0 rounded-lg border border-line bg-bg-inset px-2.5 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
            {#if hasNativeWorkspacePicker()}
              <Button
                variant="default"
                outline
                onclick={handleBrowse}
                disabled={isSaving}
                class="h-8 px-2.5! text-xs shrink-0"
              >
                Browse
              </Button>
            {/if}
            <Button
              variant="accent"
              onclick={() => applyWorkspace(pathInput, writeEnabledInput, approvalModeInput)}
              disabled={isSaving || !pathInput.trim()}
              class="h-8 px-2.5! text-xs shrink-0"
            >
              <Check size={13} />
              <span>Apply</span>
            </Button>
          </div>
        </div>

        <!-- 3-Way Access Mode Selector: Read-Only / Ask Before Editing / Auto Read-Write -->
        <div class="space-y-1.5">
          <span class="text-[11px] font-medium text-fg-muted">Access & Write Mode</span>
          <div
            id="conv-workspace-write-toggle"
            class="grid grid-cols-3 gap-1 rounded-lg border border-line bg-bg-inset p-1"
          >
            <button
              type="button"
              onclick={() => selectAccessMode("ro")}
              disabled={isSaving}
              class="flex items-center justify-center gap-1 rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer {activeModeKey ===
              'ro'
                ? 'bg-bg-elevated text-fg shadow-xs font-semibold'
                : 'text-fg-muted hover:text-fg'}"
            >
              <Lock size={11} />
              <span>Read-Only</span>
            </button>
            <button
              type="button"
              onclick={() => selectAccessMode("ask")}
              disabled={isSaving}
              class="flex items-center justify-center gap-1 rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer {activeModeKey ===
              'ask'
                ? 'bg-accent/15 text-accent shadow-xs font-semibold border border-accent/30'
                : 'text-fg-muted hover:text-fg'}"
            >
              <ShieldAlert size={11} />
              <span>Ask First</span>
            </button>
            <button
              type="button"
              onclick={() => selectAccessMode("rw")}
              disabled={isSaving}
              class="flex items-center justify-center gap-1 rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer {activeModeKey ===
              'rw'
                ? 'bg-warning/15 text-warning shadow-xs font-semibold border border-warning/30'
                : 'text-fg-muted hover:text-fg'}"
            >
              <LockOpen size={11} />
              <span>Read-Write</span>
            </button>
          </div>
          <p class="text-[10px] text-fg-subtle px-0.5">
            {#if activeModeKey === "ro"}
              Read-Only (default): assistant can only list, search, and read files.
            {:else if activeModeKey === "ask"}
              Ask First: assistant shows a diff preview and waits for your approval before editing files or running commands.
            {:else}
              Auto Read-Write: assistant can edit, create, rename, and delete workspace files automatically (shell commands still ask for approval).
            {/if}
          </p>
        </div>

        {#if recentPaths.length > 0}
          <div class="space-y-1 pt-0.5">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Recent Workspaces
              </span>
              <button
                type="button"
                onclick={clearRecentWorkspaces}
                class="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle hover:bg-danger/15 hover:text-danger transition-colors cursor-pointer"
              >
                Clear all
              </button>
            </div>
            <div class="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
              {#each recentPaths as recent (recent)}
                <div class="group flex items-center gap-1 rounded-md hover:bg-bg-inset transition-colors">
                  <button
                    type="button"
                    onclick={() => {
                      pathInput = recent;
                      void applyWorkspace(recent, writeEnabledInput, approvalModeInput);
                    }}
                    class="flex flex-1 min-w-0 items-center justify-between gap-2 px-2 py-1 text-left font-mono text-[11px] text-fg-muted group-hover:text-fg cursor-pointer"
                  >
                    <span class="truncate">{recent}</span>
                    <span class="shrink-0 text-[10px] text-accent">{getBasename(recent)}</span>
                  </button>
                  <button
                    type="button"
                    onclick={(e) => {
                      e.stopPropagation();
                      removeRecentWorkspace(recent);
                    }}
                    aria-label="Remove {recent} from recent workspaces"
                    title="Remove from recent workspaces"
                    class="shrink-0 rounded p-1 mr-0.5 text-fg-subtle opacity-60 hover:opacity-100 hover:text-danger transition-opacity cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else if activeTab === "files"}
        <!-- Workspace File Explorer -->
        <div class="space-y-2">
          <div class="relative flex items-center">
            <Search size={12} class="absolute left-2.5 text-fg-subtle pointer-events-none" />
            <input
              type="text"
              bind:value={fileFilterQuery}
              placeholder="Filter workspace files…"
              class="h-7 w-full rounded-lg border border-line bg-bg-inset pl-7 pr-2.5 font-mono text-[11px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
          </div>

          <div class="max-h-60 overflow-y-auto rounded-lg border border-line bg-bg-inset p-1 space-y-0.5">
            {#if fileFilterQuery.trim()}
              {#if filteredWorkspaceFiles.length === 0}
                <div class="py-4 text-center text-[11px] text-fg-subtle">
                  No files matching "{fileFilterQuery}"
                </div>
              {:else}
                {#each filteredWorkspaceFiles as relFile (relFile)}
                  {@const gitCode = gitFileMap.get(relFile)}
                  <div class="group flex items-center justify-between gap-1.5 rounded-md px-2 py-1 hover:bg-bg-elevated transition-colors">
                    <button
                      type="button"
                      onclick={() => handlePreviewFile(relFile)}
                      title="Preview {relFile} in side panel"
                      class="flex flex-1 min-w-0 items-center gap-1.5 text-left font-mono text-[11px] text-fg-muted group-hover:text-fg cursor-pointer"
                    >
                      <FileText size={12} class="shrink-0 text-accent/80" />
                      <span class="truncate">{relFile}</span>
                    </button>
                    {#if gitCode}
                      <span
                        title="Git status: {gitCode}"
                        class="shrink-0 rounded px-1 py-0.2 font-mono text-[9px] font-bold {gitCode === 'A' || gitCode === '?'
                          ? 'bg-success/15 text-success'
                          : gitCode === 'D'
                            ? 'bg-danger/15 text-danger'
                            : 'bg-warning/15 text-warning'}"
                      >
                        {gitCode}
                      </span>
                    {/if}
                    <div class="flex items-center gap-0.5 shrink-0 opacity-75 group-hover:opacity-100">
                      <button
                        type="button"
                        onclick={() => handleInsertMention(relFile)}
                        title="Insert @{relFile} into chat input"
                        aria-label="Mention {relFile}"
                        class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-accent cursor-pointer"
                      >
                        <AtSign size={11} />
                      </button>
                      <button
                        type="button"
                        onclick={() => handlePreviewFile(relFile)}
                        title="Preview file"
                        aria-label="Preview {relFile}"
                        class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-fg cursor-pointer"
                      >
                        <Eye size={11} />
                      </button>
                    </div>
                  </div>
                {/each}
              {/if}
            {:else if visibleTreeRows.length === 0}
              <div class="py-4 text-center text-[11px] text-fg-subtle">
                No visible files found in this workspace.
              </div>
            {:else}
              {#each visibleTreeRows as row (`${row.kind}:${row.path}`)}
                {#if row.kind === "dir"}
                  <div
                    style="padding-left: {row.depth * 12 + 6}px"
                    class="group flex items-center justify-between gap-1 rounded-md pr-1.5 py-1 hover:bg-bg-elevated transition-colors"
                  >
                    <button
                      type="button"
                      onclick={() => toggleDir(row.path)}
                      class="flex flex-1 min-w-0 items-center gap-1.5 text-left font-mono text-[11px] text-fg-muted group-hover:text-fg cursor-pointer"
                    >
                      {#if expandedDirs[row.path]}
                        <ChevronDown size={11} class="shrink-0 text-fg-subtle" />
                        <FolderOpen size={12} class="shrink-0 text-accent" />
                      {:else}
                        <ChevronRight size={11} class="shrink-0 text-fg-subtle" />
                        <Folder size={12} class="shrink-0 text-accent/80" />
                      {/if}
                      <span class="truncate font-medium">{row.name}/</span>
                      {#if row.fileCount !== undefined}
                        <span class="text-[9px] text-fg-subtle shrink-0">({row.fileCount})</span>
                      {/if}
                    </button>
                    <button
                      type="button"
                      onclick={() => handleInsertMention(`${row.path}/`)}
                      title="Mention folder @{row.path}/ in chat input"
                      aria-label="Mention folder {row.path}/"
                      class="shrink-0 rounded p-1 text-fg-subtle opacity-60 group-hover:opacity-100 hover:bg-bg-inset hover:text-accent cursor-pointer"
                    >
                      <AtSign size={11} />
                    </button>
                  </div>
                {:else}
                  {@const gitCode = gitFileMap.get(row.path)}
                  <div
                    style="padding-left: {row.depth * 12 + 18}px"
                    class="group flex items-center justify-between gap-1.5 rounded-md pr-1.5 py-1 hover:bg-bg-elevated transition-colors"
                  >
                    <button
                      type="button"
                      onclick={() => handlePreviewFile(row.path)}
                      title="Preview {row.path} in side panel"
                      class="flex flex-1 min-w-0 items-center gap-1.5 text-left font-mono text-[11px] text-fg-muted group-hover:text-fg cursor-pointer"
                    >
                      <FileText size={12} class="shrink-0 text-accent/80" />
                      <span class="truncate">{row.name}</span>
                    </button>
                    {#if gitCode}
                      <span
                        title="Git status: {gitCode}"
                        class="shrink-0 rounded px-1 py-0.2 font-mono text-[9px] font-bold {gitCode === 'A' || gitCode === '?'
                          ? 'bg-success/15 text-success'
                          : gitCode === 'D'
                            ? 'bg-danger/15 text-danger'
                            : 'bg-warning/15 text-warning'}"
                      >
                        {gitCode}
                      </span>
                    {/if}
                    <div class="flex items-center gap-0.5 shrink-0 opacity-75 group-hover:opacity-100">
                      <button
                        type="button"
                        onclick={() => handleInsertMention(row.path)}
                        title="Insert @{row.path} into chat input"
                        aria-label="Mention {row.path}"
                        class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-accent cursor-pointer"
                      >
                        <AtSign size={11} />
                      </button>
                      <button
                        type="button"
                        onclick={() => handlePreviewFile(row.path)}
                        title="Preview file"
                        aria-label="Preview {row.path}"
                        class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-fg cursor-pointer"
                      >
                        <Eye size={11} />
                      </button>
                    </div>
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
      {:else if activeTab === "checkpoints"}
        <!-- Edit Checkpoints & One-Click Undo -->
        <div class="max-h-64 overflow-y-auto rounded-lg border border-line bg-bg-inset p-1.5 space-y-1">
          {#if isLoadingCheckpoints}
            <div class="py-4 text-center text-[11px] text-fg-subtle">Loading checkpoints…</div>
          {:else if checkpoints.length === 0}
            <div class="py-4 text-center text-[11px] text-fg-subtle">
              No workspace file edits recorded in this conversation yet.
            </div>
          {:else}
            {#each checkpoints as cp (cp.id)}
              <div class="flex items-center justify-between gap-2 rounded-md border border-line/60 bg-bg-elevated px-2.5 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="rounded bg-accent/15 px-1 py-0.2 font-mono text-[9px] font-semibold uppercase text-accent">
                      {cp.action}
                    </span>
                    <span class="truncate font-mono text-[11px] text-fg">
                      {cp.relPath}{cp.destRelPath ? ` -> ${cp.destRelPath}` : ""}
                    </span>
                  </div>
                  <span class="text-[10px] text-fg-subtle">
                    {new Date(cp.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {#if cp.isReverted}
                  <span class="shrink-0 rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                    Reverted
                  </span>
                {:else}
                  <button
                    type="button"
                    onclick={() => handleRevertCheckpoint(cp)}
                    disabled={revertingId === cp.id}
                    class="shrink-0 inline-flex items-center gap-1 rounded border border-line bg-bg-inset px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <RotateCcw size={10} />
                    <span>{revertingId === cp.id ? "Reverting…" : "Revert"}</span>
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      {#if errorMsg}
        <div class="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {errorMsg}
        </div>
      {/if}
    </div>
  {/if}
</div>
