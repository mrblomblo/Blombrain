<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import { Plus, Pencil, Trash2, Check, X, FileText } from "@lucide/svelte";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import {
    fetchPromptTemplates,
    createPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
  } from "../api";
  import type { PromptTemplateInfo } from "../types";

  interface Props {
    isOpen: boolean;
    onclose: () => void;
    onselect?: (template: PromptTemplateInfo) => void;
  }

  let { isOpen, onclose, onselect }: Props = $props();

  const queryClient = useQueryClient();

  const templatesQuery = createQuery(() => ({
    queryKey: ["promptTemplates"],
    queryFn: fetchPromptTemplates,
  }));

  let editingId = $state<string | null>(null);
  let isCreating = $state(false);
  let formName = $state("");
  let formDesc = $state("");
  let formContent = $state("");
  let isSaving = $state(false);
  let errorMsg = $state<string | null>(null);

  function startCreate() {
    editingId = null;
    isCreating = true;
    formName = "";
    formDesc = "";
    formContent = "";
    errorMsg = null;
  }

  function startEdit(tpl: PromptTemplateInfo) {
    isCreating = false;
    editingId = tpl.id;
    formName = tpl.name;
    formDesc = tpl.description || "";
    formContent = tpl.content;
    errorMsg = null;
  }

  function cancelForm() {
    isCreating = false;
    editingId = null;
    errorMsg = null;
  }

  async function handleSave(e?: SubmitEvent) {
    e?.preventDefault();
    const cleanName = formName.trim().replace(/^\/+/, "");
    const cleanContent = formContent.trim();
    if (!cleanName || !cleanContent || isSaving) return;

    isSaving = true;
    errorMsg = null;
    try {
      if (isCreating) {
        await createPromptTemplate({
          name: cleanName,
          description: formDesc.trim(),
          content: cleanContent,
        });
      } else if (editingId) {
        await updatePromptTemplate(editingId, {
          name: cleanName,
          description: formDesc.trim(),
          content: cleanContent,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["promptTemplates"] });
      isCreating = false;
      editingId = null;
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to save prompt template.";
    } finally {
      isSaving = false;
    }
  }

  async function handleDelete(tpl: PromptTemplateInfo) {
    errorMsg = null;
    try {
      await deletePromptTemplate(tpl.id);
      if (editingId === tpl.id) {
        editingId = null;
      }
      await queryClient.invalidateQueries({ queryKey: ["promptTemplates"] });
    } catch (err) {
      errorMsg = (err as Error).message || "Failed to delete prompt template.";
    }
  }
</script>

<Modal
  {isOpen}
  title="Reusable Slash Prompt Templates"
  {onclose}
  maxWidth="max-w-xl"
>
  <div class="flex flex-col gap-3 pt-1 text-xs">
    <div class="flex items-center justify-between gap-2">
      <p class="text-fg-subtle leading-relaxed">
        Define reusable <code class="font-mono text-accent">/command</code> templates that can be triggered from the chat input <code class="font-mono">/</code> menu.
      </p>
      {#if !isCreating && !editingId}
        <Button
          variant="accent"
          onclick={startCreate}
          class="h-8 px-2.5! text-xs shrink-0"
        >
          <Plus size={13} />
          <span>New Template</span>
        </Button>
      {/if}
    </div>

    {#if errorMsg}
      <div class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        {errorMsg}
      </div>
    {/if}

    {#if isCreating || editingId}
      <form
        onsubmit={handleSave}
        class="rounded-xl border border-accent/40 bg-bg-inset p-3.5 space-y-3"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-fg">
            {isCreating ? "Create Prompt Template" : "Edit Prompt Template"}
          </span>
          <button
            type="button"
            onclick={cancelForm}
            class="text-fg-subtle hover:text-fg cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div class="flex flex-col gap-1">
            <label for="tpl-name-input" class="text-[11px] font-medium text-fg-muted">
              Slash Command Name
            </label>
            <div class="relative flex items-center">
              <span class="absolute left-2.5 font-mono text-fg-subtle">/</span>
              <input
                id="tpl-name-input"
                type="text"
                bind:value={formName}
                placeholder="review"
                class="h-8 w-full rounded-lg border border-line bg-bg-elevated pl-6 pr-2.5 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label for="tpl-desc-input" class="text-[11px] font-medium text-fg-muted">
              Short Summary
            </label>
            <input
              id="tpl-desc-input"
              type="text"
              bind:value={formDesc}
              placeholder="Briefly describe what this prompt does…"
              class="h-8 w-full rounded-lg border border-line bg-bg-elevated px-2.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label for="tpl-content-input" class="text-[11px] font-medium text-fg-muted">
            Prompt Instructions
          </label>
          <textarea
            id="tpl-content-input"
            rows={4}
            bind:value={formContent}
            placeholder="Instructions injected when /command is used…"
            class="w-full resize-y rounded-lg border border-line bg-bg-elevated p-2.5 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none min-h-24"
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" outline onclick={cancelForm} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="accent"
            onclick={() => handleSave()}
            disabled={isSaving || !formName.trim() || !formContent.trim()}
          >
            <Check size={13} />
            <span>{isSaving ? "Saving…" : "Save Template"}</span>
          </Button>
        </div>
      </form>
    {/if}

    <div class="max-h-72 overflow-y-auto rounded-xl border border-line bg-bg-inset p-1.5 space-y-1">
      {#if !templatesQuery.data || templatesQuery.data.length === 0}
        <div class="py-6 text-center text-fg-subtle">
          No prompt templates yet. Click "New Template" to create one.
        </div>
      {:else}
        {#each templatesQuery.data as tpl (tpl.id)}
          <div class="group flex items-start justify-between gap-2 rounded-lg border border-line/60 bg-bg-elevated p-2.5 hover:border-accent/40 transition-colors">
            <button
              type="button"
              onclick={() => {
                if (onselect) {
                  onselect(tpl);
                  onclose();
                } else {
                  startEdit(tpl);
                }
              }}
              class="flex-1 min-w-0 text-left cursor-pointer"
            >
              <div class="flex items-center gap-1.5">
                <FileText size={13} class="shrink-0 text-accent" />
                <span class="font-mono font-semibold text-fg">/{tpl.name}</span>
                {#if tpl.description}
                  <span class="truncate text-[11px] text-fg-muted">
                    -- {tpl.description}
                  </span>
                {/if}
              </div>
              <p class="mt-1 line-clamp-2 text-[11px] text-fg-subtle font-mono">
                {tpl.content}
              </p>
            </button>
            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onclick={() => startEdit(tpl)}
                title="Edit /{tpl.name}"
                aria-label="Edit /{tpl.name}"
                class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-fg transition-colors cursor-pointer"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onclick={() => handleDelete(tpl)}
                title="Delete /{tpl.name}"
                aria-label="Delete /{tpl.name}"
                class="rounded p-1 text-fg-subtle hover:bg-bg-inset hover:text-danger transition-colors cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" outline onclick={onclose}>
      Close
    </Button>
  {/snippet}
</Modal>
