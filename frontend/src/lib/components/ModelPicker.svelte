<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ChevronDown, Search, Star, Sparkles, Check } from "@lucide/svelte";
  import { fly, fade } from "svelte/transition";
  import { fetchModels } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import type { ModelInfo } from "../types";

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    refetchInterval: 10_000,
  }));

  let isOpen = $state(false);
  let searchQuery = $state("");

  // Visible (non-hidden, non-orphaned) models
  const visibleModels = $derived.by(() => {
    const models = modelsQuery.data ?? [];
    return models.filter((m) => !m.isHidden && !m.isOrphaned);
  });

  // Filtered by search query
  const filteredModels = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleModels;
    return visibleModels.filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(q)) ||
        m.id.toLowerCase().includes(q) ||
        m.rawId.toLowerCase().includes(q) ||
        m.backendName.toLowerCase().includes(q),
    );
  });

  // Auto-select default model when starting or if no model is selected
  $effect(() => {
    if (visibleModels.length > 0 && !chatStore.selectedModel) {
      const defaultModel = visibleModels.find((m) => m.isDefault);
      chatStore.setModel(defaultModel ? defaultModel.id : visibleModels[0].id);
    }
  });

  const selectedModel = $derived.by(() => {
    const models = modelsQuery.data ?? [];
    return models.find((m) => m.id === chatStore.selectedModel);
  });

  function selectModel(modelId: string) {
    chatStore.setModel(modelId);
    isOpen = false;
    searchQuery = "";
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".model-picker-container")) {
      isOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") isOpen = false;
  }

  function focusInput(node: HTMLInputElement) {
    setTimeout(() => node.focus(), 0);
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="model-picker-container relative">
  {#if modelsQuery.isLoading}
    <span class="text-xs text-fg-muted">Loading models…</span>
  {:else if modelsQuery.isError}
    <span class="text-xs text-danger font-medium">Failed to load models</span>
  {:else if visibleModels.length === 0}
    <span class="text-xs text-fg-muted">No models available</span>
  {:else}
    <!-- Trigger Button -->
    <button
      type="button"
      onclick={() => (isOpen = !isOpen)}
      class="flex h-8 items-center gap-2 rounded-lg border border-line bg-bg-elevated px-2.5 text-xs text-fg transition-colors hover:bg-bg-hover hover:border-line-strong focus:outline-none"
    >
      {#if selectedModel?.icon}
        <img
          src={selectedModel.icon}
          alt="Icon"
          class="h-4 w-4 rounded-xs object-cover"
        />
      {:else if selectedModel?.isPreset}
        <Sparkles size={13} class="text-accent" />
      {:else}
        <div
          class="flex h-4 w-4 items-center justify-center rounded-xs bg-bg-inset font-semibold text-[9px] text-fg-muted"
        >
          AI
        </div>
      {/if}

      <span class="font-medium truncate max-w-[180px] sm:max-w-[240px]">
        {selectedModel?.name || selectedModel?.id || "Select model"}
      </span>

      {#if selectedModel?.isDefault}
        <Star size={11} class="text-amber-400 fill-amber-400 shrink-0" />
      {/if}

      <ChevronDown size={13} class="text-fg-subtle shrink-0 ml-0.5" />
    </button>

    <!-- Popover Dropdown -->
    {#if isOpen}
      <div
        transition:fly={{ y: -6, duration: 150 }}
        class="absolute left-0 top-full z-50 mt-1 w-72 sm:w-80 rounded-xl border border-line bg-bg shadow-2xl overflow-hidden"
      >
        <!-- Search Bar (shown when visible models count > 10) -->
        {#if visibleModels.length > 10}
          <div
            class="flex items-center gap-2 border-b border-line bg-bg-inset px-3 py-2"
          >
            <Search size={13} class="text-fg-subtle shrink-0" />
            <input
              type="text"
              bind:value={searchQuery}
              placeholder="Search models…"
              class="w-full bg-transparent text-xs text-fg placeholder:text-fg-subtle outline-none"
              use:focusInput
            />
          </div>
        {/if}

        <!-- Model List -->
        <div class="max-h-64 overflow-y-auto p-1.5 space-y-1">
          {#if filteredModels.length === 0}
            <div class="px-3 py-4 text-center text-xs text-fg-subtle">
              No matching models found
            </div>
          {:else}
            {#each filteredModels as model (model.id)}
              <button
                type="button"
                onclick={() => selectModel(model.id)}
                class="w-full flex items-center justify-between gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors {model.id ===
                chatStore.selectedModel
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'hover:bg-bg-elevated text-fg'}"
              >
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                  {#if model.icon}
                    <img
                      src={model.icon}
                      alt="Icon"
                      class="h-5 w-5 rounded-md object-cover border border-line shrink-0"
                    />
                  {:else}
                    <div
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-bg-inset text-fg-subtle font-semibold text-[9px]"
                    >
                      AI
                    </div>
                  {/if}

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate">{model.name || model.id}</span>
                      {#if model.isPreset}
                        <span
                          class="rounded bg-accent/20 px-1 py-0.2 text-[9px] font-mono text-accent shrink-0"
                          >Preset</span
                        >
                      {/if}
                      {#if model.isDefault}
                        <Star
                          size={11}
                          class="text-amber-400 fill-amber-400 shrink-0"
                        />
                      {/if}
                    </div>
                    <span class="text-[10px] text-fg-subtle truncate block"
                      >{model.backendName}</span
                    >
                  </div>
                </div>

                {#if model.id === chatStore.selectedModel}
                  <Check size={14} class="text-accent shrink-0" />
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
