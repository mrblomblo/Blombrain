<script lang="ts">
  import { FolderOpen, Lock, LockOpen, ShieldAlert, X } from "@lucide/svelte";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import { hasNativeWorkspacePicker, pickNativeWorkspaceDirectory } from "../api";
  import type { WorkspaceApprovalMode } from "../types";

  interface Props {
    isOpen: boolean;
    mode: "create" | "edit";
    name?: string;
    description?: string;
    workspacePath?: string;
    workspaceWriteEnabled?: boolean;
    workspaceApprovalMode?: WorkspaceApprovalMode;
    error?: string | null;
    isSaving?: boolean;
    onsubmit: (
      name: string,
      description: string,
      workspacePath: string | null,
      workspaceWriteEnabled: boolean,
      workspaceApprovalMode: WorkspaceApprovalMode,
    ) => void | Promise<void>;
    onclose: () => void;
  }

  let {
    isOpen,
    mode,
    name = $bindable(""),
    description = $bindable(""),
    workspacePath = $bindable(""),
    workspaceWriteEnabled = $bindable(false),
    workspaceApprovalMode = $bindable<WorkspaceApprovalMode>("auto"),
    error = null,
    isSaving = false,
    onsubmit,
    onclose,
  }: Props = $props();

  let pickerError = $state<string | null>(null);

  let activeModeKey = $derived<"ro" | "ask" | "rw">(
    !workspaceWriteEnabled ? "ro" : workspaceApprovalMode === "ask" ? "ask" : "rw",
  );

  function setAccessMode(m: "ro" | "ask" | "rw") {
    workspaceWriteEnabled = m !== "ro";
    workspaceApprovalMode = m === "ask" ? "ask" : "auto";
  }

  function focusAndSelect(node: HTMLInputElement) {
    requestAnimationFrame(() => {
      node.focus();
      node.select();
    });
  }

  async function handleBrowse() {
    pickerError = null;
    try {
      const chosen = await pickNativeWorkspaceDirectory();
      if (chosen) {
        workspacePath = chosen;
      }
    } catch (err) {
      pickerError = (err as Error).message || "Failed to open folder picker.";
    }
  }

  function handleSubmit(e?: SubmitEvent | MouseEvent) {
    e?.preventDefault();
    if (!name.trim() || isSaving) return;
    const cleanWs = workspacePath.trim() || null;
    void onsubmit(
      name.trim(),
      description.trim(),
      cleanWs,
      cleanWs ? workspaceWriteEnabled : false,
      cleanWs && workspaceWriteEnabled ? workspaceApprovalMode : "auto",
    );
  }
</script>

<Modal
  {isOpen}
  title={mode === "create" ? "Create Folder" : "Edit Folder"}
  {onclose}
  maxWidth="max-w-lg"
>
  <form onsubmit={handleSubmit} class="flex flex-col gap-3.5 pt-1">
    <div class="flex flex-col gap-1.5">
      <label for="folder-name-input" class="text-xs font-medium text-fg-muted">
        Folder Name
      </label>
      <input
        id="folder-name-input"
        use:focusAndSelect
        type="text"
        bind:value={name}
        placeholder="Enter folder name…"
        class="w-full rounded-lg border border-line bg-bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors"
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="folder-desc-input" class="text-xs font-medium text-fg-muted">
        Description
      </label>
      <textarea
        id="folder-desc-input"
        bind:value={description}
        rows={2}
        placeholder="Enter description"
        class="w-full resize-y rounded-lg border border-line bg-bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors min-h-16"
      ></textarea>
    </div>

    <!-- Folder Workspace Attachment -->
    <div class="flex flex-col gap-2 rounded-xl border border-line bg-bg-inset/50 p-3">
      <div class="flex items-center justify-between">
        <label
          for="folder-workspace-input"
          class="flex items-center gap-1.5 text-xs font-semibold text-fg"
        >
          <FolderOpen size={13} class="text-accent" />
          <span>Attached Project Workspace (Optional)</span>
        </label>
        {#if workspacePath.trim()}
          <button
            type="button"
            onclick={() => {
              workspacePath = "";
              workspaceWriteEnabled = false;
              workspaceApprovalMode = "auto";
            }}
            class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-danger/15 hover:text-danger transition-colors cursor-pointer"
          >
            <X size={11} />
            <span>Clear</span>
          </button>
        {/if}
      </div>

      <p class="text-[11px] text-fg-subtle leading-relaxed">
        All conversations inside this folder automatically inherit this local workspace unless overridden per-chat.
      </p>

      <div class="flex items-center gap-1.5">
        <input
          id="folder-workspace-input"
          type="text"
          bind:value={workspacePath}
          placeholder="/path/to/local/project"
          class="w-full rounded-lg border border-line bg-bg-inset px-3 py-1.5 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-colors"
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
      </div>

      {#if workspacePath.trim()}
        <div class="space-y-1.5 mt-0.5">
          <div class="grid grid-cols-3 gap-1 rounded-lg border border-line bg-bg-elevated p-1">
            <button
              type="button"
              onclick={() => setAccessMode("ro")}
              class="flex items-center justify-center gap-1 rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer {activeModeKey ===
              'ro'
                ? 'bg-bg-inset text-fg shadow-xs font-semibold'
                : 'text-fg-muted hover:text-fg'}"
            >
              <Lock size={11} />
              <span>Read-Only</span>
            </button>
            <button
              type="button"
              onclick={() => setAccessMode("ask")}
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
              onclick={() => setAccessMode("rw")}
              class="flex items-center justify-center gap-1 rounded-md py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer {activeModeKey ===
              'rw'
                ? 'bg-warning/15 text-warning shadow-xs font-semibold border border-warning/30'
                : 'text-fg-muted hover:text-fg'}"
            >
              <LockOpen size={11} />
              <span>Read-Write</span>
            </button>
          </div>
          <p class="text-[10px] text-fg-subtle">
            {activeModeKey === "ro"
              ? "Read-Only (default): chats can only list, search, and read files."
              : activeModeKey === "ask"
                ? "Ask First: chats show a diff preview and wait for user approval before editing files."
                : "Read-Write: chats can edit, create, rename, and delete workspace files automatically."}
          </p>
        </div>
      {/if}
    </div>

    {#if error || pickerError}
      <div class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        {error || pickerError}
      </div>
    {/if}
  </form>

  {#snippet footer()}
    <Button variant="ghost" outline onclick={onclose} disabled={isSaving}>
      Cancel
    </Button>
    <Button
      variant="accent"
      onclick={() => handleSubmit()}
      disabled={!name.trim() || isSaving}
    >
      {isSaving ? "Saving..." : "Save"}
    </Button>
  {/snippet}
</Modal>
