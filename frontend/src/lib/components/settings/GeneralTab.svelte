<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import {
    uploadFile,
    serveUploadUrl,
    type AutoNameMode,
    type ToolRoutingMode,
    type CtxOverflowBehavior,
    type ReasoningInjectionMode,
  } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
  import ThemeSwitcher from "../ThemeSwitcher.svelte";
  import Button from "../ui/Button.svelte";
  import Dropdown, { type DropdownOption } from "../ui/Dropdown.svelte";
  import ModelDropdown from "../ui/ModelDropdown.svelte";

  const modeOptions: DropdownOption[] = [
    { label: "First Words (Extract 8 words locally)", value: "first_words" },
    { label: "Active Model (Prompt active chat model)", value: "active_model" },
    {
      label: "Designated Model (Prompt a specific model)",
      value: "designated_model",
    },
  ];

  const toolRoutingModeOptions: DropdownOption[] = [
    { label: "Disabled (Include all non-excluded schemas)", value: "off" },
    {
      label: "Active Model (Pre-pass with active chat model)",
      value: "active_model",
    },
    {
      label: "Designated Model (Pre-pass with specific model)",
      value: "designated_model",
    },
  ];

  const overflowBehaviorOptions: DropdownOption[] = [
    {
      label: "Keep first message + recent history (Recommended)",
      value: "truncate_middle",
    },
    {
      label: "Sliding window (Drop oldest history)",
      value: "rolling",
    },
    {
      label: "Stop generation and show error",
      value: "stop",
    },
  ];

  const reasoningInjectionOptions: DropdownOption[] = [
    {
      label: "Inject all reasoning (Full history)",
      value: "all",
    },
    {
      label: "Inject latest reasoning only (Compact)",
      value: "latest",
    },
    {
      label: "Do not inject reasoning (Minimal)",
      value: "none",
    },
  ];

  let imageUploading = $state(false);
  let formError = $state<string | null>(null);

  async function handleAvatarUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    imageUploading = true;
    formError = null;

    try {
      const upload = await uploadFile(file);
      const avatarUrl = serveUploadUrl(upload.id);
      await settingsStore.update({ userAvatar: avatarUrl });
    } catch (err) {
      formError =
        err instanceof Error ? err.message : "Failed to upload avatar.";
    } finally {
      imageUploading = false;
      input.value = "";
    }
  }

  import { confirmStore } from "../../stores/confirmStore.svelte";

  async function handleRemoveAvatar() {
    const confirmed = await confirmStore.confirm({
      title: "Remove Avatar",
      message: "Are you sure you want to remove your profile avatar?",
      confirmText: "Remove",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (confirmed) {
      await settingsStore.update({ userAvatar: null });
    }
  }

  async function handleNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    await settingsStore.update({ userName: input.value });
  }
</script>

<div class="flex flex-col gap-6">
  {#if formError}
    <div
      class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {formError}
    </div>
  {/if}

  <!-- User Profile Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <h3 class="text-sm font-semibold text-fg">User Profile</h3>

    <!-- Avatar Upload -->
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-fg-muted">Profile Avatar</span>
      <div class="flex items-center gap-3">
        {#if settingsStore.userAvatar}
          <img
            src={settingsStore.userAvatar}
            alt="User Avatar"
            class="h-10 w-10 rounded-lg object-cover border border-line bg-bg"
          />
        {:else}
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-bg font-semibold text-xs text-fg-muted"
          >
            YOU
          </div>
        {/if}

        <div class="flex items-center gap-2">
          <label
            class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors hover:bg-bg-elevated"
          >
            <Upload size={13} />
            <span>{imageUploading ? "Uploading..." : "Upload Image"}</span>
            <input
              type="file"
              accept="image/*"
              class="hidden"
              onchange={handleAvatarUpload}
              disabled={imageUploading}
            />
          </label>

          {#if settingsStore.userAvatar}
            <Button
              variant="danger"
              outline
              size="sm"
              onclick={handleRemoveAvatar}
            >
              Remove
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <!-- User Name -->
    <div class="flex flex-col gap-1">
      <label for="user-profile-name" class="text-xs font-medium text-fg-muted">
        User Name
      </label>
      <input
        id="user-profile-name"
        type="text"
        value={settingsStore.userName}
        onchange={handleNameChange}
        placeholder="Enter your name"
        class="h-9 w-full rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors focus:border-accent"
      />
    </div>
  </div>

  <!-- Appearance Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <h3 class="text-sm font-semibold text-fg">Appearance</h3>

    <div class="flex flex-col gap-1">
      <label for="user-theme-select" class="text-xs font-medium text-fg-muted">
        Theme
      </label>
      <ThemeSwitcher
        id="user-theme-select"
        value={settingsStore.theme}
        onchange={(t) => settingsStore.update({ theme: t })}
      />
    </div>
  </div>

  <!-- Auto Chat Naming Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div>
      <h3 class="text-sm font-semibold text-fg">Auto Chat Naming</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Choose how new chat conversation titles are generated.
      </p>
    </div>

    <div class="flex flex-col gap-1">
      <label
        for="auto-name-mode-select"
        class="text-xs font-medium text-fg-muted"
      >
        Naming Mode
      </label>
      <Dropdown
        id="auto-name-mode-select"
        value={settingsStore.autoNameMode}
        options={modeOptions}
        onchange={(val) =>
          settingsStore.update({
            autoNameMode: val as AutoNameMode,
          })}
      />
    </div>

    {#if settingsStore.autoNameMode === "designated_model"}
      <div class="flex flex-col gap-1">
        <label
          for="auto-name-model-select"
          class="text-xs font-medium text-fg-muted"
        >
          Designated Model
        </label>
        <ModelDropdown
          id="auto-name-model-select"
          value={settingsStore.autoNameModel ?? undefined}
          placeholder="Select a model..."
          onchange={(val) =>
            settingsStore.update({
              autoNameModel: val || null,
            })}
        />
      </div>
    {/if}
  </div>

  <!-- Context-Scoped Tool Routing Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div>
      <h3 class="text-sm font-semibold text-fg">Context-Scoped Tool Routing</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Run a lightweight pre-pass model to filter out irrelevant tool and skill
        descriptions before sending the prompt to the primary chat model.
      </p>
    </div>

    <div class="flex flex-col gap-1">
      <label
        for="tool-routing-mode-select"
        class="text-xs font-medium text-fg-muted"
      >
        Routing Pre-pass Mode
      </label>
      <Dropdown
        id="tool-routing-mode-select"
        value={settingsStore.toolRoutingMode}
        options={toolRoutingModeOptions}
        onchange={(val) =>
          settingsStore.update({
            toolRoutingMode: val as ToolRoutingMode,
          })}
      />
    </div>

    {#if settingsStore.toolRoutingMode === "designated_model"}
      <div class="flex flex-col gap-1">
        <label
          for="tool-routing-model-select"
          class="text-xs font-medium text-fg-muted"
        >
          Designated Router Model
        </label>
        <ModelDropdown
          id="tool-routing-model-select"
          value={settingsStore.toolRoutingModel ?? undefined}
          placeholder="Select a fast router model..."
          onchange={(val) =>
            settingsStore.update({
              toolRoutingModel: val || null,
            })}
        />
      </div>
    {/if}
  </div>

  <!-- Context Overflow Behavior Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div>
      <h3 class="text-sm font-semibold text-fg">Context Overflow Behavior</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Choose default behavior when a conversation exceeds the model's maximum context length.
      </p>
    </div>

    <div class="flex flex-col gap-1">
      <label
        for="ctx-overflow-behavior-select"
        class="text-xs font-medium text-fg-muted"
      >
        Default Overflow Strategy
      </label>
      <Dropdown
        id="ctx-overflow-behavior-select"
        value={settingsStore.ctxOverflowBehavior}
        options={overflowBehaviorOptions}
        onchange={(val) =>
          settingsStore.update({
            ctxOverflowBehavior: val as CtxOverflowBehavior,
          })}
      />
    </div>
  </div>

  <!-- Reasoning Context Injection Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div>
      <h3 class="text-sm font-semibold text-fg">Reasoning Context Injection</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Control how reasoning blocks (&lt;think&gt;...&lt;/think&gt;) from past assistant turns are included in prompt history.
      </p>
    </div>

    <div class="flex flex-col gap-1">
      <label
        for="reasoning-injection-mode-select"
        class="text-xs font-medium text-fg-muted"
      >
        Reasoning Injection Strategy
      </label>
      <Dropdown
        id="reasoning-injection-mode-select"
        value={settingsStore.reasoningInjectionMode}
        options={reasoningInjectionOptions}
        onchange={(val) =>
          settingsStore.update({
            reasoningInjectionMode: val as ReasoningInjectionMode,
          })}
      />
    </div>
  </div>
</div>
