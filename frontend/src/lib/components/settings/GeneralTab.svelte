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
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";

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
    <div class="border-b border-line pb-3">
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

  <!-- Context Window & Prompt Management Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-5"
  >
    <div class="border-b border-line pb-3">
      <h3 class="text-sm font-semibold text-fg">
        Context Window & Prompt Management
      </h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Configure how conversation context, reasoning tokens, and pre-pass tool
        routing are managed.
      </p>
    </div>

    <!-- Context-Scoped Tool Routing -->
    <div class="flex flex-col gap-2">
      <div>
        <h4 class="text-xs font-semibold text-fg">
          Context-Scoped Tool Routing
        </h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Run a lightweight pre-pass model to filter out irrelevant tool and
          skill descriptions before sending the prompt to the primary chat
          model. Note that it will still run the pre-pass model if the combined
          schemas of the active tools and skills are too big.
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
        <div class="flex flex-col gap-1 mt-1">
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

    <div class="h-px bg-line/60"></div>

    <!-- Context Overflow Behavior -->
    <div class="flex flex-col gap-2">
      <div>
        <h4 class="text-xs font-semibold text-fg">Context Overflow Behavior</h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Choose default behavior when a conversation exceeds the model's
          maximum context length.
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

    <div class="h-px bg-line/60"></div>

    <!-- Reasoning Context Injection -->
    <div class="flex flex-col gap-2">
      <div>
        <h4 class="text-xs font-semibold text-fg">
          Reasoning Context Injection
        </h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Control how reasoning blocks (&lt;think&gt;...&lt;/think&gt;) from
          past assistant turns are included in prompt history.
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

  <!-- Built-in Network Tools Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div class="flex items-center justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-fg">
          Network-Dependent Built-in Tools
        </h3>
        <p class="text-xs text-fg-subtle mt-0.5">
          Allow built-in tools that require network access to be available to
          models. Disabled by default.
        </p>
      </div>
      <ToggleSwitch
        id="network-tools-enable-toggle"
        checked={settingsStore.networkToolsEnabled}
        onchange={(checked) =>
          settingsStore.update({ networkToolsEnabled: checked })}
        label="Toggle network-dependent built-in tools"
      />
    </div>
  </div>
</div>
