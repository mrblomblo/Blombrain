<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { X, Plus, Pencil, Trash2, Check, Sparkles, Layers } from "@lucide/svelte";
  import { fetchModels, createPreset, updateModelSettings, deleteModelSettings } from "../api";
  import type { ModelInfo } from "../types";

  interface Props {
    open: boolean;
    onClose: () => void;
  }
  const { open, onClose }: Props = $props();

  const queryClient = useQueryClient();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    enabled: open,
  }));

  type FormMode = "idle" | "add_preset" | "edit";
  let formMode = $state<FormMode>("idle");
  let selectedModelId = $state<string | null>(null);

  // Form Fields
  let formName = $state("");
  let formBaseModelId = $state("");
  let formSystemPrompt = $state("");
  let formTemperature = $state<number | undefined>(undefined);
  let formCanImage = $state(false);
  let formCanAudio = $state(false);
  let formCanVideo = $state(false);

  let formBusy = $state(false);
  let formError = $state<string | null>(null);

  function startAddPreset() {
    formMode = "add_preset";
    selectedModelId = null;
    formName = "";
    const allModels = modelsQuery.data ?? [];
    const baseModels = allModels.filter((m) => !m.isPreset);
    formBaseModelId = baseModels.length > 0 ? baseModels[0].id : "";
    formSystemPrompt = "";
    formTemperature = undefined;
    formCanImage = false;
    formCanAudio = false;
    formCanVideo = false;
    formError = null;
  }

  function startEdit(model: ModelInfo) {
    formMode = "edit";
    selectedModelId = model.id;
    formName = model.name ?? (model.isPreset ? model.id : "");
    formBaseModelId = model.baseModelId ?? model.id;
    formSystemPrompt = model.systemPrompt ?? "";
    formTemperature = model.temperature;
    formCanImage = Boolean(model.canImage);
    formCanAudio = Boolean(model.canAudio);
    formCanVideo = Boolean(model.canVideo);
    formError = null;
  }

  function cancelForm() {
    formMode = "idle";
    selectedModelId = null;
    formError = null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    formBusy = true;

    try {
      if (formMode === "add_preset") {
        if (!formName.trim() || !formBaseModelId) {
          throw new Error("Name and Base Model are required.");
        }
        await createPreset({
          name: formName.trim(),
          baseModelId: formBaseModelId,
          systemPrompt: formSystemPrompt.trim() || undefined,
          temperature: formTemperature !== undefined && !isNaN(formTemperature) ? formTemperature : undefined,
          canImage: formCanImage,
          canAudio: formCanAudio,
          canVideo: formCanVideo,
        });
      } else if (formMode === "edit" && selectedModelId) {
        const isPreset = modelsQuery.data?.find((m) => m.id === selectedModelId)?.isPreset;
        await updateModelSettings(selectedModelId, {
          isPreset,
          name: formName.trim() || undefined,
          baseModelId: isPreset ? formBaseModelId : undefined,
          systemPrompt: formSystemPrompt.trim() || undefined,
          temperature: formTemperature !== undefined && !isNaN(formTemperature) ? formTemperature : undefined,
          canImage: formCanImage,
          canAudio: formCanAudio,
          canVideo: formCanVideo,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["models"] });
      cancelForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : "An error occurred.";
    } finally {
      formBusy = false;
    }
  }

  async function handleDelete(model: ModelInfo) {
    const actionText = model.isPreset ? `Delete preset "${model.name || model.id}"?` : `Reset settings for "${model.id}" to defaults?`;
    if (!confirm(actionText)) return;

    formBusy = true;
    try {
      await deleteModelSettings(model.id);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      if (selectedModelId === model.id) cancelForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove settings.");
    } finally {
      formBusy = false;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Model Editor"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      class="relative flex w-full max-w-2xl flex-col rounded-xl border border-line bg-bg shadow-2xl"
      style="max-height: min(90vh, 720px); height: min(90vh, 720px);"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-line px-5 py-4">
        <div class="flex items-center gap-2">
          <Layers size={18} class="text-accent" />
          <h2 class="text-sm font-semibold">Model & Preset Management</h2>
        </div>
        <button
          onclick={onClose}
          aria-label="Close"
          class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-5">
        {#if modelsQuery.isLoading}
          <p class="text-sm text-fg-muted">Loading models…</p>
        {:else if modelsQuery.isError}
          <p class="text-sm text-danger">Failed to load models list.</p>
        {:else}
          {@const allModels = modelsQuery.data ?? []}
          {@const baseModels = allModels.filter((m) => !m.isPreset)}
          {@const presets = allModels.filter((m) => m.isPreset)}

          <!-- List View -->
          {#if formMode === "idle"}
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                Models ({allModels.length})
              </h3>
              <button
                onclick={startAddPreset}
                class="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Plus size={13} />
                Create Preset
              </button>
            </div>

            <!-- Presets Section -->
            {#if presets.length > 0}
              <div class="mb-5">
                <span class="mb-2 block text-xs font-medium text-fg-muted">Presets</span>
                <ul class="flex flex-col gap-2">
                  {#each presets as model (model.id)}
                    <li class="flex items-center justify-between rounded-lg border border-accent/40 bg-bg-elevated px-4 py-3 text-sm">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <Sparkles size={14} class="text-accent shrink-0" />
                          <span class="font-medium text-fg">{model.name || model.id}</span>
                          <span class="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-mono text-accent">Preset</span>
                        </div>
                        <p class="truncate text-xs text-fg-subtle mt-0.5">Base: {model.baseModelId}</p>
                      </div>

                      <div class="flex shrink-0 gap-1">
                        <button
                          onclick={() => startEdit(model)}
                          class="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg hover:text-fg"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onclick={() => handleDelete(model)}
                          class="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg hover:text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            <!-- Base Models Section -->
            <div>
              <span class="mb-2 block text-xs font-medium text-fg-muted">Base Models</span>
              <ul class="flex flex-col gap-2">
                {#each baseModels as model (model.id)}
                  <li class="flex items-center justify-between rounded-lg border border-line px-4 py-3 text-sm">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-fg">{model.name || model.id}</span>
                        <span class="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle ring-1 ring-line">
                          {model.backendName}
                        </span>
                      </div>
                      {#if model.systemPrompt}
                        <p class="truncate text-xs text-fg-subtle mt-0.5">Prompt: "{model.systemPrompt}"</p>
                      {/if}
                    </div>

                    <div class="flex shrink-0 gap-1">
                      <button
                        onclick={() => startEdit(model)}
                        class="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg hover:text-fg"
                        title="Edit model configuration"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {:else}
            <!-- Form View (Add Preset or Edit Model/Preset) -->
            <div class="rounded-lg border border-line bg-bg-elevated p-4">
              <h3 class="mb-4 text-sm font-semibold">
                {formMode === "add_preset" ? "Create Model Preset" : `Edit ${selectedModelId}`}
              </h3>

              <form onsubmit={handleSubmit} class="flex flex-col gap-4">
                <!-- Name -->
                <div class="flex flex-col gap-1">
                  <label for="me-name" class="text-xs font-medium text-fg-muted">
                    {formMode === "add_preset" ? "Preset Name" : "Custom Name (Optional)"}
                  </label>
                  <input
                    id="me-name"
                    bind:value={formName}
                    placeholder={formMode === "add_preset" ? "My Pirate Assistant" : "Custom display name"}
                    required={formMode === "add_preset"}
                    class="h-8 rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>

                <!-- Base Model Selection (for Preset creation/edit) -->
                {#if formMode === "add_preset" || (modelsQuery.data?.find(m => m.id === selectedModelId)?.isPreset)}
                  <div class="flex flex-col gap-1">
                    <label for="me-base" class="text-xs font-medium text-fg-muted">Parent Base Model</label>
                    <select
                      id="me-base"
                      bind:value={formBaseModelId}
                      required
                      class="h-8 rounded-md border border-line bg-bg px-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {#each baseModels as bm}
                        <option value={bm.id}>{bm.name || bm.id} ({bm.backendName})</option>
                      {/each}
                    </select>
                  </div>
                {/if}

                <!-- System Prompt -->
                <div class="flex flex-col gap-1">
                  <label for="me-prompt" class="text-xs font-medium text-fg-muted">System Prompt</label>
                  <textarea
                    id="me-prompt"
                    bind:value={formSystemPrompt}
                    rows="3"
                    placeholder="Instructions for the model..."
                    class="resize-y rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  ></textarea>
                </div>

                <!-- Temperature -->
                <div class="flex flex-col gap-1">
                  <label for="me-temp" class="text-xs font-medium text-fg-muted">Temperature (Optional)</label>
                  <input
                    id="me-temp"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    bind:value={formTemperature}
                    placeholder="Default (e.g. 0.7)"
                    class="h-8 w-36 rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>

                <!-- Capabilities -->
                <div class="flex flex-col gap-2 pt-2 border-t border-line">
                  <span class="text-xs font-medium text-fg-muted">Multimodal Capabilities</span>
                  <div class="flex flex-wrap gap-4">
                    <label class="flex cursor-pointer items-center gap-2 text-xs text-fg">
                      <input type="checkbox" bind:checked={formCanImage} class="accent-accent" />
                      Image Support
                    </label>
                    <label class="flex cursor-pointer items-center gap-2 text-xs text-fg">
                      <input type="checkbox" bind:checked={formCanAudio} class="accent-accent" />
                      Audio Support
                    </label>
                    <label class="flex cursor-pointer items-center gap-2 text-xs text-fg">
                      <input type="checkbox" bind:checked={formCanVideo} class="accent-accent" />
                      Video Support
                    </label>
                  </div>
                </div>

                {#if formError}
                  <p class="text-xs text-danger">{formError}</p>
                {/if}

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onclick={cancelForm}
                    disabled={formBusy}
                    class="h-8 rounded-md border border-line px-3 text-xs text-fg-muted transition-colors hover:bg-bg-elevated"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formBusy}
                    class="flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Check size={13} />
                    Save
                  </button>
                </div>
              </form>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
