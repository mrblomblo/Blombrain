<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    fetchMemories,
    createMemoryApi,
    updateMemoryApi,
    deleteMemoryApi,
    clearAllMemoriesApi,
  } from "../../api";
  import type { MemoryInfo } from "../../types";
  import { settingsStore } from "../../stores/settings.svelte";
  import { confirmStore } from "../../stores/confirmStore.svelte";
  import Button from "../ui/Button.svelte";
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";
  import ModelDropdown from "../ui/ModelDropdown.svelte";
  import {
    Brain,
    Plus,
    Trash2,
    Pencil,
    Search,
    Check,
    X,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  const queryClient = useQueryClient();

  let searchQuery = $state("");
  let isAdding = $state(false);
  let editingId = $state<string | null>(null);

  let formContent = $state("");
  let formCategory = $state("general");
  let formTags = $state("");
  let formError = $state<string | null>(null);
  let formBusy = $state(false);

  const memoriesQuery = createQuery(() => ({
    queryKey: ["memories", searchQuery.trim()],
    queryFn: () => fetchMemories(searchQuery.trim() || undefined),
  }));

  function resetForm() {
    isAdding = false;
    editingId = null;
    formContent = "";
    formCategory = "general";
    formTags = "";
    formError = null;
    formBusy = false;
  }

  function startEdit(mem: MemoryInfo) {
    editingId = mem.id;
    formContent = mem.content;
    formCategory = mem.category || "general";
    formTags = (mem.tags || []).join(", ");
    isAdding = true;
    formError = null;
  }

  async function handleSave() {
    if (!formContent.trim()) {
      formError = "Memory content is required.";
      return;
    }
    formBusy = true;
    formError = null;
    const tags = formTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (editingId) {
        await updateMemoryApi(editingId, {
          content: formContent.trim(),
          category: formCategory.trim() || "general",
          tags,
        });
      } else {
        await createMemoryApi({
          content: formContent.trim(),
          category: formCategory.trim() || "general",
          tags,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
      resetForm();
    } catch (err: any) {
      formError = err?.message || "Failed to save memory.";
    } finally {
      formBusy = false;
    }
  }

  async function handleToggleEnabled(mem: MemoryInfo, checked: boolean) {
    try {
      await updateMemoryApi(mem.id, { isEnabled: checked });
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    } catch (err: any) {
      formError = err?.message || "Failed to update memory state.";
    }
  }

  async function handleDelete(mem: MemoryInfo) {
    const confirmed = await confirmStore.confirm({
      title: "Delete Memory",
      message: "Are you sure you want to delete this stored memory?",
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;

    try {
      await deleteMemoryApi(mem.id);
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    } catch (err: any) {
      formError = err?.message || "Failed to delete memory.";
    }
  }

  async function handleClearAll() {
    const confirmed = await confirmStore.confirm({
      title: "Clear All Memories",
      message: "Are you sure you want to permanently delete all stored user memories?",
      confirmText: "Clear All",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;

    try {
      await clearAllMemoriesApi();
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    } catch (err: any) {
      formError = err?.message || "Failed to clear memories.";
    }
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Memory & Recall Configuration -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <div class="border-b border-line pb-3">
      <h3 class="text-sm font-semibold text-fg">Memory &amp; Chat Recall</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Configure three-layer memory: conversation scratchpad, persistent user memory with semantic RAG, and cross-chat recall.
      </p>
    </div>

    <!-- Persistent User Memory Toggle -->
    <div class="flex items-center justify-between gap-4">
      <div>
        <h4 class="text-xs font-semibold text-fg">Persistent User Memory</h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Allow the assistant to remember and recall facts, preferences, and project notes across conversations. Can also be toggled per chat.
        </p>
      </div>
      <ToggleSwitch
        id="persistent-memory-enable-toggle"
        checked={settingsStore.memoryEnabled}
        onchange={(checked) => settingsStore.update({ memoryEnabled: checked })}
        label="Toggle persistent user memory"
      />
    </div>

    <div class="h-px bg-line/60"></div>

    <!-- Cross-Chat History Recall Toggle -->
    <div class="flex items-center justify-between gap-4">
      <div>
        <h4 class="text-xs font-semibold text-fg">Cross-Chat History Search</h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Allow the model to search messages from previous conversations via the <code class="font-mono text-accent">chat_history_search</code> tool.
        </p>
      </div>
      <ToggleSwitch
        id="cross-chat-recall-enable-toggle"
        checked={settingsStore.crossChatRecallEnabled}
        onchange={(checked) =>
          settingsStore.update({ crossChatRecallEnabled: checked })}
        label="Toggle cross-chat history search"
      />
    </div>

    {#if settingsStore.crossChatRecallEnabled}
      <div class="flex items-center justify-between gap-4 pl-3 border-l-2 border-line">
        <div>
          <h4 class="text-xs font-medium text-fg">Include Archived Chats in Recall</h4>
          <p class="text-[11px] text-fg-subtle mt-0.5">
            Permit <code class="font-mono text-accent">chat_history_search</code> to include conversations you have archived.
          </p>
        </div>
        <ToggleSwitch
          id="cross-chat-archived-toggle"
          checked={settingsStore.crossChatIncludeArchived}
          onchange={(checked) =>
            settingsStore.update({ crossChatIncludeArchived: checked })}
          label="Include archived chats in cross-chat search"
        />
      </div>
    {/if}

    <div class="h-px bg-line/60"></div>

    <!-- Optional Semantic Embedding Model -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <label for="memory-embedding-model" class="text-xs font-semibold text-fg">
          Semantic RAG Embedding Model (Optional)
        </label>
        {#if settingsStore.embeddingModel}
          <button
            type="button"
            onclick={() => settingsStore.update({ embeddingModel: null })}
            class="text-[11px] text-fg-subtle hover:text-fg underline cursor-pointer"
          >
            Clear (use BM25 only)
          </button>
        {/if}
      </div>
      <p class="text-[11px] text-fg-subtle">
        Select an embedding model (via <code class="font-mono">/v1/embeddings</code> or Ollama <code class="font-mono">/api/embed</code>) to combine vector cosine similarity with BM25 keyword ranking. When unset, fast local BM25 + lexical ranking is used automatically.
      </p>
      <ModelDropdown
        id="memory-embedding-model"
        filterPresets={true}
        value={settingsStore.embeddingModel ?? undefined}
        placeholder="None (Local BM25 + lexical ranking)"
        onchange={(val) =>
          settingsStore.update({ embeddingModel: val || null })}
      />
    </div>
  </div>

  <!-- Stored User Memories List & Editor -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h3 class="text-sm font-semibold text-fg">
          Stored Memories ({memoriesQuery.data?.length ?? 0})
        </h3>
        <p class="text-xs text-fg-subtle mt-0.5">
          Explicit facts and preferences available to the assistant.
        </p>
      </div>
      <div class="flex items-center gap-2">
        {#if (memoriesQuery.data?.length ?? 0) > 0 && !isAdding}
          <Button variant="danger" outline size="sm" onclick={handleClearAll}>
            <Trash2 size={13} />
            <span>Clear All</span>
          </Button>
        {/if}
        {#if !isAdding}
          <Button variant="accent" size="sm" onclick={() => (isAdding = true)}>
            <Plus size={13} />
            <span>Add Memory</span>
          </Button>
        {/if}
      </div>
    </div>

    {#if isAdding}
      <div
        transition:slide={{ duration: 200 }}
        class="rounded-lg border border-accent/40 bg-bg p-3.5 flex flex-col gap-3"
      >
        <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {editingId ? "Edit Memory" : "New Memory"}
        </h4>
        <div class="flex flex-col gap-1">
          <label for="mem-content" class="text-xs font-medium text-fg-muted">
            Fact or Preference
          </label>
          <textarea
            id="mem-content"
            bind:value={formContent}
            rows={3}
            placeholder="e.g. Prefers TypeScript with strict null checks and concise explanations."
            class="w-full rounded-md border border-line bg-bg-elevated p-2.5 text-xs text-fg focus:border-accent"
          ></textarea>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <label for="mem-category" class="text-xs font-medium text-fg-muted">
              Category
            </label>
            <input
              id="mem-category"
              type="text"
              bind:value={formCategory}
              placeholder="preference, profile, project, general"
              class="h-8 rounded-md border border-line bg-bg-elevated px-2.5 text-xs text-fg focus:border-accent"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="mem-tags" class="text-xs font-medium text-fg-muted">
              Tags (comma separated)
            </label>
            <input
              id="mem-tags"
              type="text"
              bind:value={formTags}
              placeholder="typescript, coding-style"
              class="h-8 rounded-md border border-line bg-bg-elevated px-2.5 text-xs text-fg focus:border-accent"
            />
          </div>
        </div>
        {#if formError}
          <p class="text-xs text-danger">{formError}</p>
        {/if}
        <div class="flex justify-end gap-2">
          <Button variant="ghost" outline size="sm" onclick={resetForm} disabled={formBusy}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onclick={handleSave} disabled={formBusy}>
            <Check size={13} />
            <span>{formBusy ? "Saving..." : "Save Memory"}</span>
          </Button>
        </div>
      </div>
    {/if}

    <!-- Search Memories -->
    <div class="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-1.5">
      <Search size={13} class="text-fg-subtle shrink-0" />
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search memories by keyword or topic…"
        aria-label="Search memories"
        class="w-full bg-transparent text-xs text-fg placeholder:text-fg-subtle"
      />
      {#if searchQuery}
        <button
          type="button"
          onclick={() => (searchQuery = "")}
          aria-label="Clear memory search"
          class="text-fg-subtle hover:text-fg cursor-pointer"
        >
          <X size={13} />
        </button>
      {/if}
    </div>

    {#if memoriesQuery.isLoading}
      <p class="text-xs text-fg-muted py-4 text-center">Loading memories…</p>
    {:else if (memoriesQuery.data ?? []).length === 0}
      <div class="rounded-lg border border-dashed border-line p-6 text-center text-fg-subtle">
        <Brain size={26} class="mx-auto mb-2 opacity-50" />
        <p class="text-xs font-medium text-fg">No memories stored yet</p>
        <p class="text-[11px] mt-1">
          Add memories manually above or ask the assistant to remember facts during chat.
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each memoriesQuery.data ?? [] as mem (mem.id)}
          <div
            class="flex items-start justify-between gap-3 rounded-lg border border-line bg-bg p-3 text-xs transition-opacity {mem.isEnabled
              ? ''
              : 'opacity-50'}"
          >
            <div class="min-w-0 flex-1 flex flex-col gap-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-mono text-accent font-medium">
                  {mem.category}
                </span>
                {#if mem.hasEmbedding}
                  <span class="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-mono text-success">
                    Vector
                  </span>
                {/if}
                {#each mem.tags as tag}
                  <span class="rounded bg-bg-elevated border border-line px-1.5 py-0.5 text-[10px] font-mono text-fg-subtle">
                    #{tag}
                  </span>
                {/each}
                {#if mem.score !== undefined && searchQuery.trim()}
                  <span class="text-[10px] font-mono text-fg-subtle">
                    score: {mem.score.toFixed(2)}
                  </span>
                {/if}
              </div>
              <p class="text-fg leading-relaxed break-words mt-0.5">{mem.content}</p>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <ToggleSwitch
                id="mem-enable-{mem.id}"
                checked={mem.isEnabled}
                onchange={(checked) => handleToggleEnabled(mem, checked)}
                label="Enable memory"
              />
              <button
                type="button"
                onclick={() => startEdit(mem)}
                aria-label="Edit memory"
                class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-fg cursor-pointer"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onclick={() => handleDelete(mem)}
                aria-label="Delete memory"
                class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-elevated hover:text-danger cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
