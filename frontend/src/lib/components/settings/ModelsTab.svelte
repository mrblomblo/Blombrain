<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    Plus,
    Pencil,
    Trash2,
    Check,
    Upload,
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    Star,
    Copy,
    ArrowUpDown,
  } from "@lucide/svelte";
  import {
    fetchModels,
    createPreset,
    updateModelSettings,
    deleteModelSettings,
    uploadFile,
    serveUploadUrl,
  } from "../../api";
  import type { ModelInfo, ModelSettingWriteBody } from "../../types";
  import ModelReorderModal from "./ModelReorderModal.svelte";
  import { flip } from "svelte/animate";
  import { slide, fade } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import Dropdown from "../ui/Dropdown.svelte";
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";
  import Button from "../ui/Button.svelte";

  const queryClient = useQueryClient();

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
  }));

  type FormMode = "idle" | "add_preset" | "edit";
  let formMode = $state<FormMode>("idle");
  let selectedModelId = $state<string | null>(null);
  let reorderModalOpen = $state(false);

  // Core Form Fields
  let formName = $state("");
  let formBaseModelId = $state("");
  let formSystemPrompt = $state("");
  let formTemperature = $state<number | undefined>(undefined);
  let formCanImage = $state(false);
  let formCanAudio = $state(false);
  let formCanVideo = $state(false);
  let formIcon = $state<string | undefined>(undefined);

  // Advanced Sampling & Generation Fields
  let formSeed = $state<number | undefined>(undefined);
  let formReasoningEffort = $state<string | undefined>(undefined);
  let formMaxTokens = $state<number | undefined>(undefined);
  let formTopK = $state<number | undefined>(undefined);
  let formTopP = $state<number | undefined>(undefined);
  let formMinP = $state<number | undefined>(undefined);
  let formPresencePenalty = $state<number | undefined>(undefined);
  let formFrequencyPenalty = $state<number | undefined>(undefined);
  let formRepeatPenalty = $state<number | undefined>(undefined);
  let formCtxLength = $state<number | undefined>(undefined);

  let showAdvanced = $state(false);
  let formBusy = $state(false);
  let formError = $state<string | null>(null);
  let imageUploading = $state(false);

  function resetForm() {
    formName = "";
    formBaseModelId = "";
    formSystemPrompt = "";
    formTemperature = undefined;
    formCanImage = false;
    formCanAudio = false;
    formCanVideo = false;
    formIcon = undefined;
    formSeed = undefined;
    formReasoningEffort = undefined;
    formMaxTokens = undefined;
    formTopK = undefined;
    formTopP = undefined;
    formMinP = undefined;
    formPresencePenalty = undefined;
    formFrequencyPenalty = undefined;
    formRepeatPenalty = undefined;
    formCtxLength = undefined;
    showAdvanced = false;
    formError = null;
  }

  function populateFromBaseModel(baseModelId: string) {
    const allModels = modelsQuery.data ?? [];
    const baseModel = allModels.find((m) => m.id === baseModelId);
    if (!baseModel) return;

    formSystemPrompt = baseModel.systemPrompt ?? "";
    formTemperature = baseModel.temperature;
    formCanImage = Boolean(baseModel.canImage);
    formCanAudio = Boolean(baseModel.canAudio);
    formCanVideo = Boolean(baseModel.canVideo);
    formIcon = baseModel.icon;
    formSeed = baseModel.seed;
    formReasoningEffort = baseModel.reasoningEffort;
    formMaxTokens = baseModel.maxTokens;
    formTopK = baseModel.topK;
    formTopP = baseModel.topP;
    formMinP = baseModel.minP;
    formPresencePenalty = baseModel.presencePenalty;
    formFrequencyPenalty = baseModel.frequencyPenalty;
    formRepeatPenalty = baseModel.repeatPenalty;
    formCtxLength = baseModel.ctxLength;
  }

  function startAddPreset() {
    formMode = "add_preset";
    selectedModelId = null;
    resetForm();

    const allModels = modelsQuery.data ?? [];
    const baseModels = allModels.filter((m) => !m.isPreset && !m.isHidden);
    formBaseModelId = baseModels.length > 0 ? baseModels[0].id : "";
    if (formBaseModelId) {
      populateFromBaseModel(formBaseModelId);
    }
  }

  function startEdit(model: ModelInfo) {
    formMode = "edit";
    selectedModelId = model.id;
    resetForm();

    formName = model.name ?? (model.isPreset ? model.id : "");
    formBaseModelId = model.baseModelId ?? model.id;
    formSystemPrompt = model.systemPrompt ?? "";
    formTemperature = model.temperature;
    formCanImage = Boolean(model.canImage);
    formCanAudio = Boolean(model.canAudio);
    formCanVideo = Boolean(model.canVideo);
    formIcon = model.icon;
    formSeed = model.seed;
    formReasoningEffort = model.reasoningEffort;
    formMaxTokens = model.maxTokens;
    formTopK = model.topK;
    formTopP = model.topP;
    formMinP = model.minP;
    formPresencePenalty = model.presencePenalty;
    formFrequencyPenalty = model.frequencyPenalty;
    formRepeatPenalty = model.repeatPenalty;
    formCtxLength = model.ctxLength;
  }

  function cancelForm() {
    formMode = "idle";
    selectedModelId = null;
    formError = null;
  }

  async function handleToggleHide(model: ModelInfo) {
    try {
      await updateModelSettings(model.id, {
        isPreset: model.isPreset,
        baseModelId: model.baseModelId,
        isHidden: !model.isHidden,
      });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to toggle hide state.",
      );
    }
  }

  async function handleToggleDefault(model: ModelInfo) {
    if (model.isHidden && !model.isDefault) {
      alert("A hidden model cannot be set as default.");
      return;
    }
    try {
      await updateModelSettings(model.id, {
        isPreset: model.isPreset,
        baseModelId: model.baseModelId,
        isDefault: !model.isDefault,
      });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to set default model.",
      );
    }
  }

  async function handleDuplicatePreset(model: ModelInfo) {
    try {
      const copyName = `${model.name || model.id} - Copy`;
      await createPreset({
        name: copyName,
        baseModelId: model.baseModelId ?? model.id,
        systemPrompt: model.systemPrompt,
        canImage: model.canImage,
        canAudio: model.canAudio,
        canVideo: model.canVideo,
        temperature: model.temperature,
        icon: model.icon,
        seed: model.seed,
        reasoningEffort: model.reasoningEffort,
        maxTokens: model.maxTokens,
        topK: model.topK,
        topP: model.topP,
        minP: model.minP,
        presencePenalty: model.presencePenalty,
        frequencyPenalty: model.frequencyPenalty,
        repeatPenalty: model.repeatPenalty,
        ctxLength: model.ctxLength,
      });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to duplicate preset.");
    }
  }

  async function handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    imageUploading = true;
    formError = null;

    try {
      const upload = await uploadFile(file);
      formIcon = serveUploadUrl(upload.id);
    } catch (err) {
      formError = err instanceof Error ? err.message : "Failed to upload icon.";
    } finally {
      imageUploading = false;
      input.value = "";
    }
  }

  async function handleRemoveIcon() {
    const confirmed = await confirmStore.confirm({
      title: "Remove Icon",
      message: "Are you sure you want to remove this model icon?",
      confirmText: "Remove",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (confirmed) {
      formIcon = undefined;
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    formBusy = true;

    const payload: ModelSettingWriteBody = {
      name: formName.trim() || undefined,
      systemPrompt: formSystemPrompt.trim() || null,
      temperature:
        formTemperature !== undefined && !isNaN(formTemperature)
          ? formTemperature
          : null,
      canImage: formCanImage,
      canAudio: formCanAudio,
      canVideo: formCanVideo,
      icon: formIcon || null,
      seed: formSeed !== undefined && !isNaN(formSeed) ? formSeed : null,
      reasoningEffort: formReasoningEffort || null,
      maxTokens:
        formMaxTokens !== undefined && !isNaN(formMaxTokens)
          ? formMaxTokens
          : null,
      topK: formTopK !== undefined && !isNaN(formTopK) ? formTopK : null,
      topP: formTopP !== undefined && !isNaN(formTopP) ? formTopP : null,
      minP: formMinP !== undefined && !isNaN(formMinP) ? formMinP : null,
      presencePenalty:
        formPresencePenalty !== undefined && !isNaN(formPresencePenalty)
          ? formPresencePenalty
          : null,
      frequencyPenalty:
        formFrequencyPenalty !== undefined && !isNaN(formFrequencyPenalty)
          ? formFrequencyPenalty
          : null,
      repeatPenalty:
        formRepeatPenalty !== undefined && !isNaN(formRepeatPenalty)
          ? formRepeatPenalty
          : null,
      ctxLength:
        formCtxLength !== undefined && !isNaN(formCtxLength)
          ? formCtxLength
          : null,
    };

    try {
      if (formMode === "add_preset") {
        if (!formName.trim() || !formBaseModelId) {
          throw new Error(
            "Name and Base Model are required for creating a preset.",
          );
        }
        await createPreset({
          ...payload,
          name: formName.trim(),
          baseModelId: formBaseModelId,
        });
      } else if (formMode === "edit" && selectedModelId) {
        const isPreset = modelsQuery.data?.find(
          (m) => m.id === selectedModelId,
        )?.isPreset;
        await updateModelSettings(selectedModelId, {
          ...payload,
          isPreset,
          baseModelId: isPreset ? formBaseModelId : undefined,
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

  import { confirmStore } from "../../stores/confirmStore.svelte";

  async function handleDelete(model: ModelInfo) {
    const isPreset = model.isPreset;
    const actionTitle = isPreset ? "Delete Preset" : "Reset Model Settings";
    const actionText = isPreset
      ? `Are you sure you want to delete preset "${model.name || model.id}"?`
      : `Are you sure you want to reset settings for "${model.id}" to defaults?`;

    const confirmed = await confirmStore.confirm({
      title: actionTitle,
      message: actionText,
      confirmText: isPreset ? "Delete" : "Reset",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;

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
</script>

<div>
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
      <div>
        <div class="mb-4 flex items-center justify-between">
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-fg-subtle"
          >
            Models ({allModels.length})
          </h3>
          <div class="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onclick={() => (reorderModalOpen = true)}
              title="Reorder models & presets"
            >
              <ArrowUpDown size={13} />
              <span>Sort Order</span>
            </Button>
            <Button variant="accent" size="sm" onclick={startAddPreset}>
              <Plus size={13} />
              <span>Create Preset</span>
            </Button>
          </div>
        </div>

        <!-- Presets Section -->
        {#if presets.length > 0}
          <div class="mb-5">
            <span class="mb-2 block text-xs font-medium text-fg-muted"
              >Presets</span
            >
            <ul class="flex flex-col gap-2">
              {#each presets as model (model.id)}
                <li
                  animate:flip={{ duration: 300, easing: quintOut }}
                  out:slide={{ duration: 250, easing: quintOut }}
                  class="flex items-center justify-between rounded-lg border border-accent/40 bg-bg-elevated px-4 py-3 text-sm transition-colors {model.isHidden ||
                  model.isOrphaned
                    ? 'opacity-50'
                    : ''}"
                >
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    {#if model.icon}
                      <img
                        src={model.icon}
                        alt="Icon"
                        class="h-7 w-7 rounded-md object-cover border border-line"
                      />
                    {:else}
                      <div
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/20 text-accent font-semibold text-xs"
                      >
                        AI
                      </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-fg"
                          >{model.name || model.id}</span
                        >
                        <span
                          class="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-mono text-accent"
                          >Preset</span
                        >
                        {#if model.isOrphaned}
                          <span
                            transition:slide={{ axis: "x", duration: 250 }}
                            class="rounded bg-danger/20 text-danger px-1.5 py-0.5 text-[10px] font-semibold inline-block whitespace-nowrap"
                            >No Model</span
                          >
                        {:else if model.isDefault}
                          <span
                            transition:slide={{ axis: "x", duration: 250 }}
                            class="rounded bg-amber-500/20 text-amber-500 px-1.5 py-0.5 text-[10px] font-semibold inline-block whitespace-nowrap"
                            >Default</span
                          >
                        {/if}
                        {#if model.isHidden}
                          <span
                            transition:slide={{ axis: "x", duration: 250 }}
                            class="rounded bg-bg-inset text-fg-subtle px-1.5 py-0.5 text-[10px] inline-block whitespace-nowrap"
                            >Hidden</span
                          >
                        {/if}
                      </div>
                      <p class="truncate text-xs text-fg-subtle mt-0.5">
                        Base: {model.baseModelId || "None"}
                      </p>
                    </div>
                  </div>

                  <div class="flex shrink-0 gap-1">
                    <!-- Star / Set Default -->
                    <button
                      type="button"
                      onclick={() => handleToggleDefault(model)}
                      class="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 cursor-pointer {model.isDefault
                        ? 'text-amber-400'
                        : 'text-fg-muted hover:bg-bg hover:text-amber-400'}"
                      title={model.isDefault
                        ? "Current Default Model"
                        : "Set as Default Model"}
                    >
                      <Star
                        size={13}
                        class="transition-colors duration-300 {model.isDefault
                          ? 'fill-amber-400 text-amber-400'
                          : ''}"
                      />
                    </button>
                    <!-- Copy / Duplicate Preset -->
                    <button
                      type="button"
                      onclick={() => handleDuplicatePreset(model)}
                      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-fg"
                      title="Duplicate Preset"
                    >
                      <Copy size={13} />
                    </button>
                    <!-- Edit -->
                    <button
                      type="button"
                      onclick={() => startEdit(model)}
                      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-fg"
                      title="Edit preset"
                    >
                      <Pencil size={13} />
                    </button>
                    <!-- Delete -->
                    <button
                      type="button"
                      onclick={() => handleDelete(model)}
                      class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-danger"
                      title="Delete preset"
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
          <span class="mb-2 block text-xs font-medium text-fg-muted"
            >Base Models</span
          >
          <ul class="flex flex-col gap-2">
            {#each baseModels as model (model.id)}
              <li
                animate:flip={{ duration: 300, easing: quintOut }}
                out:slide={{ duration: 250, easing: quintOut }}
                class="flex items-center justify-between rounded-lg border border-line bg-bg-elevated px-4 py-3 text-sm transition-colors {model.isHidden
                  ? 'opacity-50 bg-bg-elevated/50'
                  : ''}"
              >
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  {#if model.icon}
                    <img
                      src={model.icon}
                      alt="Icon"
                      class="h-7 w-7 rounded-md object-cover border border-line"
                    />
                  {:else}
                    <div
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-inset text-fg-muted font-semibold text-xs"
                    >
                      AI
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-medium text-fg"
                        >{model.name || model.id}</span
                      >
                      <span
                        class="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle"
                      >
                        {model.backendName}
                      </span>
                      {#if model.isDefault}
                        <span
                          transition:slide={{ axis: "x", duration: 250 }}
                          class="rounded bg-amber-500/20 text-amber-500 px-1.5 py-0.5 text-[10px] font-semibold inline-block whitespace-nowrap"
                          >Default</span
                        >
                      {/if}
                      {#if model.isHidden}
                        <span
                          transition:slide={{ axis: "x", duration: 250 }}
                          class="rounded bg-bg-inset text-fg-subtle px-1.5 py-0.5 text-[10px] inline-block whitespace-nowrap"
                          >Hidden</span
                        >
                      {/if}
                    </div>
                    {#if model.systemPrompt}
                      <p class="truncate text-xs text-fg-subtle mt-0.5">
                        Prompt: "{model.systemPrompt}"
                      </p>
                    {/if}
                  </div>
                </div>

                <div class="flex shrink-0 gap-1">
                  <!-- Star / Set Default -->
                  <button
                    type="button"
                    onclick={() => handleToggleDefault(model)}
                    disabled={model.isHidden && !model.isDefault}
                    class="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 cursor-pointer {model.isDefault
                      ? 'text-amber-400'
                      : 'text-fg-muted hover:bg-bg hover:text-amber-400'} disabled:opacity-30 disabled:pointer-events-none"
                    title={model.isHidden && !model.isDefault
                      ? "Hidden models cannot be set as default"
                      : model.isDefault
                        ? "Current Default Model"
                        : "Set as Default Model"}
                  >
                    <Star
                      size={13}
                      class="transition-colors duration-300 {model.isDefault
                        ? 'fill-amber-400 text-amber-400'
                        : ''}"
                    />
                  </button>
                  <!-- Hide / Show Eye Icon -->
                  <button
                    type="button"
                    onclick={() => handleToggleHide(model)}
                    class="flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer {model.isHidden
                      ? 'text-accent'
                      : 'text-fg-muted hover:bg-bg hover:text-fg'}"
                    title={model.isHidden
                      ? "Unhide model"
                      : "Hide model from picker"}
                  >
                    {#if model.isHidden}
                      <EyeOff size={13} />
                    {:else}
                      <Eye size={13} />
                    {/if}
                  </button>
                  <!-- Edit -->
                  <button
                    type="button"
                    onclick={() => startEdit(model)}
                    class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-fg"
                    title="Edit model configuration"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      </div>
    {:else}
      <!-- Form View (Add Preset or Edit Model/Preset) -->
      <div
        transition:slide={{ duration: 300 }}
        class="rounded-lg border border-line bg-bg-elevated p-4"
      >
        <h3 class="mb-4 text-sm font-semibold">
          {formMode === "add_preset"
            ? "Create Model Preset"
            : `Edit ${selectedModelId}`}
        </h3>

        <form onsubmit={handleSubmit} class="flex flex-col gap-4">
          <!-- Avatar / Icon Upload -->
          <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-fg-muted"
              >Model Icon / Avatar</span
            >
            <div class="flex items-center gap-3">
              {#if formIcon}
                <img
                  src={formIcon}
                  alt="Avatar Preview"
                  class="h-10 w-10 rounded-lg object-cover border border-line bg-bg"
                />
              {:else}
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-bg font-semibold text-xs text-fg-muted"
                >
                  AI
                </div>
              {/if}

              <div class="flex items-center gap-2">
                <label
                  class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors hover:bg-bg-elevated"
                >
                  <Upload size={13} />
                  <span>{imageUploading ? "Uploading..." : "Upload Image"}</span
                  >
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onchange={handleImageUpload}
                    disabled={imageUploading}
                  />
                </label>
                {#if formIcon}
                  <Button
                    variant="danger"
                    size="sm"
                    outline
                    type="button"
                    onclick={handleRemoveIcon}
                  >
                    Remove
                  </Button>
                {/if}
              </div>
            </div>
          </div>

          <!-- Name -->
          <div class="flex flex-col gap-1">
            <label for="me-name" class="text-xs font-medium text-fg-muted">
              {formMode === "add_preset"
                ? "Preset Name"
                : "Custom Name (Optional)"}
            </label>
            <input
              id="me-name"
              bind:value={formName}
              placeholder={formMode === "add_preset"
                ? "My Custom Assistant"
                : "Custom display name"}
              required={formMode === "add_preset"}
              class="h-8 rounded-md border border-line bg-bg px-3 text-sm text-fg focus-visible:border-accent transition-colors duration-200"
            />
          </div>

          <!-- Base Model Selection (for Preset creation/edit) -->
          {#if formMode === "add_preset" || modelsQuery.data?.find((m) => m.id === selectedModelId)?.isPreset}
            <div class="flex flex-col gap-1">
              <label for="me-base" class="text-xs font-medium text-fg-muted"
                >Parent Base Model</label
              >
              <Dropdown
                id="me-base"
                value={formBaseModelId}
                onchange={(val) => {
                  formBaseModelId = val;
                  if (formMode === "add_preset") {
                    populateFromBaseModel(val);
                  }
                }}
                options={baseModels
                  .filter((bm) => !bm.isHidden || bm.id === formBaseModelId)
                  .map((bm) => ({
                    label: `${bm.name || bm.id} (${bm.backendName})`,
                    value: bm.id,
                  }))}
                placeholder="Select parent base model"
              />
            </div>
          {/if}

          <!-- System Prompt -->
          <div class="flex flex-col gap-1">
            <label for="me-prompt" class="text-xs font-medium text-fg-muted"
              >System Prompt</label
            >
            <textarea
              id="me-prompt"
              bind:value={formSystemPrompt}
              rows="3"
              placeholder="Instructions for the model..."
              class="resize-y rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg focus-visible:border-accent transition-colors duration-200"
            ></textarea>
          </div>

          <!-- Capabilities -->
          <div class="flex flex-col gap-2 pt-2 border-t border-line">
            <span class="text-xs font-medium text-fg-muted"
              >Multimodal Capabilities</span
            >
            <div class="flex flex-wrap gap-5">
              <div class="flex items-center gap-2">
                <ToggleSwitch id="cap-img" bind:checked={formCanImage} />
                <label for="cap-img" class="cursor-pointer text-xs text-fg"
                  >Image Support</label
                >
              </div>
              <div class="flex items-center gap-2">
                <ToggleSwitch id="cap-aud" bind:checked={formCanAudio} />
                <label for="cap-aud" class="cursor-pointer text-xs text-fg"
                  >Audio Support</label
                >
              </div>
              <div class="flex items-center gap-2">
                <ToggleSwitch id="cap-vid" bind:checked={formCanVideo} />
                <label for="cap-vid" class="cursor-pointer text-xs text-fg"
                  >Video Support</label
                >
              </div>
            </div>
          </div>

          <!-- Advanced Sampling Accordion -->
          <div class="border-t border-line pt-2">
            <button
              type="button"
              onclick={() => (showAdvanced = !showAdvanced)}
              class="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-accent hover:underline"
            >
              {#if showAdvanced}
                <ChevronDown size={14} />
              {:else}
                <ChevronRight size={14} />
              {/if}
              <span>Advanced Generation & Sampling Options</span>
            </button>

            {#if showAdvanced}
              <div
                transition:slide={{ duration: 250 }}
                class="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-bg p-3 border border-line"
              >
                <!-- Temperature -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-temp"
                    class="text-[11px] font-medium text-fg-muted"
                    >Temperature</label
                  >
                  <input
                    id="me-temp"
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    bind:value={formTemperature}
                    placeholder="Default (e.g. 0.7)"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>
                <!-- Seed -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-seed"
                    class="text-[11px] font-medium text-fg-muted">Seed</label
                  >
                  <input
                    id="me-seed"
                    type="number"
                    bind:value={formSeed}
                    placeholder="Random"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Max Tokens -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-maxt"
                    class="text-[11px] font-medium text-fg-muted"
                    >Max Response Tokens</label
                  >
                  <input
                    id="me-maxt"
                    type="number"
                    bind:value={formMaxTokens}
                    placeholder="Default"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Context Length -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-ctx"
                    class="text-[11px] font-medium text-fg-muted"
                    >Context Window (Tokens)</label
                  >
                  <input
                    id="me-ctx"
                    type="number"
                    bind:value={formCtxLength}
                    placeholder="Default (e.g. 4096)"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Top P -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-topp"
                    class="text-[11px] font-medium text-fg-muted">Top P</label
                  >
                  <input
                    id="me-topp"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    bind:value={formTopP}
                    placeholder="e.g. 0.9"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Top K -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-topk"
                    class="text-[11px] font-medium text-fg-muted">Top K</label
                  >
                  <input
                    id="me-topk"
                    type="number"
                    bind:value={formTopK}
                    placeholder="e.g. 40"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Min P -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-minp"
                    class="text-[11px] font-medium text-fg-muted">Min P</label
                  >
                  <input
                    id="me-minp"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    bind:value={formMinP}
                    placeholder="e.g. 0.05"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Presence Penalty -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-presp"
                    class="text-[11px] font-medium text-fg-muted"
                    >Presence Penalty</label
                  >
                  <input
                    id="me-presp"
                    type="number"
                    step="0.1"
                    bind:value={formPresencePenalty}
                    placeholder="0.0"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Frequency Penalty -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-freqp"
                    class="text-[11px] font-medium text-fg-muted"
                    >Frequency Penalty</label
                  >
                  <input
                    id="me-freqp"
                    type="number"
                    step="0.1"
                    bind:value={formFrequencyPenalty}
                    placeholder="0.0"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Repeat Penalty -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-repp"
                    class="text-[11px] font-medium text-fg-muted"
                    >Repeat Penalty</label
                  >
                  <input
                    id="me-repp"
                    type="number"
                    step="0.05"
                    bind:value={formRepeatPenalty}
                    placeholder="1.0"
                    class="h-7 rounded border border-line bg-bg-elevated px-2 text-xs text-fg focus-visible:border-accent transition-colors duration-200"
                  />
                </div>

                <!-- Reasoning -->
                <div class="flex flex-col gap-1">
                  <label
                    for="me-reaseff"
                    class="text-[11px] font-medium text-fg-muted"
                    >Reasoning</label
                  >
                  <Dropdown
                    id="me-reaseff"
                    bind:value={formReasoningEffort}
                    options={[
                      { label: "Default", value: "" },
                      { label: "Yes", value: "yes" },
                      { label: "No", value: "no" },
                      { label: "Low", value: "low" },
                      { label: "Medium", value: "medium" },
                      { label: "High", value: "high" },
                    ]}
                    placeholder="Default"
                    buttonClass="h-7 bg-bg-elevated px-2"
                  />
                </div>
              </div>
            {/if}
          </div>

          {#if formError}
            <p class="text-xs text-danger">{formError}</p>
          {/if}

          <div class="flex justify-end gap-2 pt-2">
            <Button
              variant="default"
              outline
              size="sm"
              onclick={cancelForm}
              disabled={formBusy}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              size="sm"
              type="submit"
              disabled={formBusy}
            >
              <Check size={13} />
              <span>Save</span>
            </Button>
          </div>
        </form>
      </div>
    {/if}
  {/if}
</div>

<!-- Reorder Modal -->
<ModelReorderModal
  open={reorderModalOpen}
  models={modelsQuery.data ?? []}
  onClose={() => (reorderModalOpen = false)}
/>
