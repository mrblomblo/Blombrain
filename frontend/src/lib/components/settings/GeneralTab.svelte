<script lang="ts">
  import {
    type AutoNameMode,
    type ToolRoutingMode,
    type CtxOverflowBehavior,
    type ReasoningInjectionMode,
  } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
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
</script>

<div class="flex flex-col gap-6">
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
        Choose default behavior when a conversation exceeds the model's maximum
        context length.
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
        Control how reasoning blocks (&lt;think&gt;...&lt;/think&gt;) from past
        assistant turns are included in prompt history.
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
