<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Check, Plus, Trash2, Pencil } from "@lucide/svelte";
  import {
    fetchModels,
    fetchModelConfigs,
    upsertModelConfig,
    deleteModelConfig,
  } from "../../api";

  const queryClient = useQueryClient();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  const configsQuery = createQuery(() => ({
    queryKey: ["modelConfigs"],
    queryFn: fetchModelConfigs,
  }));

  type FormMode = "idle" | "add" | "edit";
  let formMode = $state<FormMode>("idle");
  
  let selectedModelId = $state<string>("");
  let canImage = $state(false);
  let canAudio = $state(false);
  let canVideo = $state(false);

  let formBusy = $state(false);
  let formError = $state<string | null>(null);

  function startAdd() {
    formMode = "add";
    selectedModelId = "";
    canImage = false;
    canAudio = false;
    canVideo = false;
    formError = null;
  }

  function startEdit(modelId: string, caps: any) {
    formMode = "edit";
    selectedModelId = modelId;
    canImage = caps.canImage;
    canAudio = caps.canAudio;
    canVideo = caps.canVideo;
    formError = null;
  }

  function cancelForm() {
    formMode = "idle";
    formError = null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!selectedModelId) return;

    formBusy = true;
    formError = null;
    try {
      await upsertModelConfig(selectedModelId, {
        canImage,
        canAudio,
        canVideo,
      });
      await queryClient.invalidateQueries({ queryKey: ["modelConfigs"] });
      cancelForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : "Failed to save config";
    } finally {
      formBusy = false;
    }
  }

  async function handleDelete(modelId: string) {
    if (!confirm(`Remove capabilities config for ${modelId}?`)) return;
    try {
      await deleteModelConfig(modelId);
      await queryClient.invalidateQueries({ queryKey: ["modelConfigs"] });
    } catch (err) {
      alert("Failed to delete config");
    }
  }

</script>

<div class="flex h-full flex-col">
  {#if configsQuery.isLoading || modelsQuery.isLoading}
    <p class="text-sm text-fg-muted">Loading…</p>
  {:else if configsQuery.isError || modelsQuery.isError}
    <p class="text-sm text-danger">Failed to load capabilities config.</p>
  {:else}
    {@const configs = configsQuery.data ?? {}}
    {@const allModels = modelsQuery.data ?? []}
    {@const configEntries = Object.entries(configs)}

    {#if configEntries.length === 0 && formMode === "idle"}
      <p class="mb-4 rounded-lg border border-dashed border-line px-4 py-4 text-sm text-fg-muted">
        No model capability overrides configured.
      </p>
    {:else}
      <ul class="mb-4 flex flex-col gap-2">
        {#each configEntries as [mId, caps] (mId)}
          <li
            class="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm transition-colors"
            class:border-accent={formMode === "edit" && selectedModelId === mId}
            class:bg-bg-elevated={formMode === "edit" && selectedModelId === mId}
          >
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium text-fg">{mId}</p>
              <div class="flex gap-2 text-[11px] text-fg-subtle">
                <span class:text-accent={caps.canImage}>Image: {caps.canImage ? 'Yes' : 'No'}</span>
                <span class:text-accent={caps.canAudio}>Audio: {caps.canAudio ? 'Yes' : 'No'}</span>
                <span class:text-accent={caps.canVideo}>Video: {caps.canVideo ? 'Yes' : 'No'}</span>
              </div>
            </div>
            
            <div class="flex shrink-0 gap-1">
              <button
                onclick={() => startEdit(mId, caps)}
                disabled={formBusy}
                class="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg hover:text-fg disabled:opacity-40"
              >
                <Pencil size={13} />
              </button>
              <button
                onclick={() => handleDelete(mId)}
                disabled={formBusy}
                class="flex h-7 w-7 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg hover:text-danger disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if formMode !== "idle"}
      <div class="rounded-lg border border-accent/40 bg-bg-elevated p-4">
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          {formMode === "add" ? "Add Config" : "Edit Config"}
        </h3>
        <form onsubmit={handleSubmit} class="flex flex-col gap-3">
          {#if formMode === "add"}
            <div class="flex flex-col gap-1">
              <label for="mc-model" class="text-xs text-fg-muted">Select Model</label>
              <select
                id="mc-model"
                bind:value={selectedModelId}
                required
                class="h-8 rounded-md border border-line bg-bg px-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-accent"
              >
                <option value="" disabled selected>-- Select a model --</option>
                {#each allModels as m}
                  <option value={m.id}>{m.id}</option>
                {/each}
              </select>
            </div>
          {:else}
            <div class="flex flex-col gap-1">
              <span class="text-xs text-fg-muted">Model</span>
              <p class="h-8 py-1.5 px-3 text-sm text-fg bg-bg rounded-md border border-line opacity-70">
                {selectedModelId}
              </p>
            </div>
          {/if}

          <div class="flex flex-col gap-2 pt-2">
            <label class="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" bind:checked={canImage} class="accent-accent" />
              Supports Image Attachments
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" bind:checked={canAudio} class="accent-accent" />
              Supports Audio Attachments
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" bind:checked={canVideo} class="accent-accent" />
              Supports Video Attachments
            </label>
          </div>

          {#if formError}
            <p class="text-xs text-danger">{formError}</p>
          {/if}

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onclick={cancelForm}
              disabled={formBusy}
              class="h-8 rounded-md border border-line px-3 text-xs text-fg-muted transition-colors hover:bg-bg-elevated disabled:opacity-40"
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
    {:else}
      <button
        onclick={startAdd}
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent"
      >
        <Plus size={14} />
        Add model config
      </button>
    {/if}
  {/if}
</div>
