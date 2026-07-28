<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { X, Plus, Pencil, Trash2, Check, ChevronDown } from "@lucide/svelte";
  import {
    fetchBackends,
    createBackend,
    updateBackend,
    deleteBackend,
  } from "../../api";
  import type { BackendInfo } from "../../types";
  import { flip } from "svelte/animate";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";
  import Button from "../ui/Button.svelte";

  const queryClient = useQueryClient();

  const backendsQuery = createQuery(() => ({
    queryKey: ["backends"],
    queryFn: fetchBackends,
  }));

  type FormMode = "idle" | "add" | "edit";
  let formMode = $state<FormMode>("idle");
  let editingId = $state<string | null>(null);

  let formId = $state("");
  let formName = $state("");
  let formBaseUrl = $state("");
  let formPrefix = $state("");
  let formApiKey = $state("");
  let formClearKey = $state(false);

  let formError = $state<string | null>(null);
  let formBusy = $state(false);
  let deletingId = $state<string | null>(null);

  function startAdd() {
    formMode = "add";
    editingId = null;
    formId = "";
    formName = "";
    formBaseUrl = "";
    formPrefix = "";
    formApiKey = "";
    formClearKey = false;
    formError = null;
  }

  function startEdit(b: BackendInfo) {
    formMode = "edit";
    editingId = b.id;
    formId = b.id;
    formName = b.name;
    formBaseUrl = b.baseUrl;
    formPrefix = b.prefix;
    formApiKey = "";
    formClearKey = false;
    formError = null;
  }

  function cancelForm() {
    formMode = "idle";
    editingId = null;
    formError = null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    formBusy = true;

    try {
      if (formMode === "add") {
        await createBackend({
          id: formId.trim(),
          name: formName.trim(),
          baseUrl: formBaseUrl.trim(),
          prefix: formPrefix.trim(),
          apiKey: formApiKey.trim() || undefined,
        });
      } else if (formMode === "edit" && editingId) {
        await updateBackend(editingId, {
          name: formName.trim(),
          baseUrl: formBaseUrl.trim(),
          prefix: formPrefix.trim(),
          apiKey: formClearKey ? "" : formApiKey.trim() || undefined,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["backends"] });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      cancelForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : "An error occurred.";
    } finally {
      formBusy = false;
    }
  }

  import { confirmStore } from "../../stores/confirmStore.svelte";

  async function handleDelete(b: BackendInfo) {
    const confirmed = await confirmStore.confirm({
      title: "Delete Backend",
      message: `Are you sure you want to delete backend "${b.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;
    deletingId = b.id;
    try {
      await deleteBackend(b.id);
      await queryClient.invalidateQueries({ queryKey: ["backends"] });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      if (editingId === b.id) cancelForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete backend.");
    } finally {
      deletingId = null;
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Existing backends list -->
  {#if backendsQuery.isLoading}
    <p class="text-sm text-fg-muted">Loading…</p>
  {:else if backendsQuery.isError}
    <p class="text-sm text-danger">Could not load backends.</p>
  {:else}
    {@const backends = backendsQuery.data ?? []}
    {#if backends.length === 0 && formMode === "idle"}
      <p
        class="mb-4 rounded-lg border border-dashed border-line px-4 py-4 text-sm text-fg-muted"
      >
        No backends configured yet. Add one to get started.
      </p>
    {:else}
      <ul class="mb-4 flex flex-col gap-2">
        {#each backends as b (b.id)}
          <li
            animate:flip={{ duration: 300, easing: quintOut }}
            out:slide={{ duration: 250, easing: quintOut }}
            class="flex items-center gap-3 rounded-lg border bg-bg-elevated px-4 py-3 text-sm transition-colors"
            class:border-accent={editingId === b.id}
            class:border-line={editingId !== b.id}
          >
            <!-- Status dot -->
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              class:bg-success={b.status === "online"}
              class:bg-danger={b.status === "offline"}
              class:bg-fg-subtle={b.status === "unknown"}
              aria-hidden="true"
            ></span>
            <!-- Info -->
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium text-fg">{b.name}</p>
              <p class="truncate font-mono text-[11px] text-fg-subtle">
                {b.baseUrl}
              </p>
            </div>
            <span
              class="shrink-0 rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle1"
            >
              {b.prefix}:
            </span>
            <!-- Actions -->
            <div class="flex shrink-0 gap-1">
              <button
                type="button"
                onclick={() => startEdit(b)}
                disabled={formBusy}
                aria-label="Edit {b.name}"
                class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-fg disabled:pointer-events-none disabled:opacity-40"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onclick={() => handleDelete(b)}
                disabled={deletingId === b.id || formBusy}
                aria-label="Delete {b.name}"
                class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-danger disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <!-- Add / Edit form -->
  {#if formMode !== "idle"}
    <div
      transition:slide={{ duration: 300 }}
      class="rounded-lg border border-accent/40 bg-bg-elevated p-4"
    >
      <h3
        class="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
      >
        {formMode === "add" ? "Add Backend" : "Edit Backend"}
      </h3>
      <form onsubmit={handleSubmit} class="flex flex-col gap-3">
        {#if formMode === "add"}
          <div class="flex flex-col gap-1">
            <label for="be-id" class="text-xs text-fg-muted"
              >ID (unique slug)</label
            >
            <input
              id="be-id"
              bind:value={formId}
              required
              placeholder="local"
              class="h-8 rounded-md border border-line bg-bg px-3 text-sm text-fg focus-visible:border-accent transition-colors duration-200"
            />
          </div>
        {/if}

        <div class="flex gap-3">
          <div class="flex flex-1 flex-col gap-1">
            <label for="be-name" class="text-xs text-fg-muted"
              >Display name</label
            >
            <input
              id="be-name"
              bind:value={formName}
              required
              placeholder="Local llama-server"
              class="h-8 rounded-md border border-line bg-bg px-3 text-sm text-fg focus-visible:border-accent transition-colors duration-200"
            />
          </div>
          <div class="flex w-28 flex-col gap-1">
            <label for="be-prefix" class="text-xs text-fg-muted">Prefix</label>
            <input
              id="be-prefix"
              bind:value={formPrefix}
              required
              placeholder="local"
              class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg focus-visible:border-accent transition-colors duration-200"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label for="be-url" class="text-xs text-fg-muted">Base URL</label>
          <input
            id="be-url"
            bind:value={formBaseUrl}
            required
            type="url"
            placeholder="http://127.0.0.1:8080"
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg focus-visible:border-accent transition-colors duration-200"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="be-key" class="text-xs text-fg-muted">
            API key
            <span class="text-fg-subtle">(optional)</span>
          </label>
          <input
            id="be-key"
            bind:value={formApiKey}
            type="password"
            placeholder={formMode === "edit"
              ? "Leave blank to keep existing key"
              : "sk-…"}
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg focus-visible:border-accent transition-colors duration-200"
          />
          {#if formMode === "edit"}
            <div class="flex items-center gap-2 pt-1">
              <ToggleSwitch id="be-clearkey" bind:checked={formClearKey} />
              <label
                for="be-clearkey"
                class="cursor-pointer text-xs text-fg-muted"
              >
                Clear existing API key
              </label>
            </div>
          {/if}
        </div>

        {#if formError}
          <p class="text-xs text-danger">{formError}</p>
        {/if}

        <div class="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            outline
            size="sm"
            type="button"
            onclick={cancelForm}
            disabled={formBusy}
          >
            Cancel
          </Button>
          <Button variant="accent" size="sm" type="submit" disabled={formBusy}>
            {#if formBusy}
              <span class="animate-spin">⟳</span> Saving…
            {:else}
              <Check size={13} />
              {formMode === "add" ? "Add" : "Save"}
            {/if}
          </Button>
        </div>
      </form>
    </div>
  {:else}
    <div transition:slide={{ duration: 300 }}>
      <button
        onclick={startAdd}
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2.5 text-sm text-fg-muted transition-colors hover:border-accent hover:text-accent cursor-pointer hover:bg-bg-hover"
      >
        <Plus size={14} />
        Add backend
      </button>
    </div>
  {/if}
</div>
