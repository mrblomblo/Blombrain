<script lang="ts">
import { onMount } from "svelte";
import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    type AutoNameMode,
    type ToolRoutingMode,
    type CtxOverflowBehavior,
    type ReasoningInjectionMode,
    type WebServerStatus,
    fetchBuiltInTools,
    fetchWebServerStatus,
    exportBackupUrl,
    importBackupBundle,
    triggerDownload,
  } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
  import { authStore } from "../../stores/auth.svelte";
  import { desktopWindow } from "../../stores/window.svelte";
  import { confirmStore } from "../../stores/confirmStore.svelte";
  import { copyToClipboard } from "../../utils/clipboard";
  import Dropdown, { type DropdownOption } from "../ui/Dropdown.svelte";
  import ModelDropdown from "../ui/ModelDropdown.svelte";
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";
  import Button from "../ui/Button.svelte";
  import {
    Download,
    Upload,
    Database,
    Globe,
    Copy,
    Check,
    ExternalLink,
    AlertTriangle,
  } from "@lucide/svelte";

  const queryClient = useQueryClient();

  let backupIncludeSecrets = $state(false);
  let backupImportMode = $state<"merge" | "replace">("merge");
  let backupBusy = $state(false);
  let backupStatusMsg = $state<string | null>(null);
  let backupIsError = $state(false);
  let backupFileInput: HTMLInputElement | undefined = $state();

  let webHostDraft = $state(settingsStore.webHost);
  let webPortDraft = $state(String(settingsStore.webPort));
  let webDirty = $state(false);
  let webSaving = $state(false);
  let webFormError = $state<string | null>(null);
  let webStatus = $state<WebServerStatus | null>(null);
  let copiedUrl = $state<string | null>(null);

  $effect(() => {
    if (!webDirty) {
      webHostDraft = settingsStore.webHost;
      webPortDraft = String(settingsStore.webPort);
    }
  });

  async function refreshWebStatus() {
    try {
      webStatus = await fetchWebServerStatus();
    } catch { }
  }

  onMount(() => {
    void refreshWebStatus();
  });

  function isLoopbackHostStr(raw: string): boolean {
    const clean = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
    return clean === "127.0.0.1" || clean === "localhost" || clean === "::1";
  }

  async function saveWebConfig(nextEnabled = settingsStore.webEnabled) {
    webFormError = null;
    const host = webHostDraft.trim();
    const port = Number(webPortDraft.trim());

    if (!host || /[\s/?#\\]/.test(host) || host.includes("://")) {
      webFormError = "Enter a valid IP or hostname (e.g. 127.0.0.1 or 0.0.0.0), without http:// or port.";
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      webFormError = "Port must be an integer between 1 and 65535.";
      return;
    }

    webSaving = true;
    try {
      await settingsStore.update({
        webEnabled: nextEnabled,
        webHost: host,
        webPort: port,
      });
      webDirty = false;
      await refreshWebStatus();
    } catch (err: any) {
      webFormError = err?.message || "Failed to update web server settings.";
    } finally {
      webSaving = false;
    }
  }

  async function handleCopyUrl(url: string) {
    const ok = await copyToClipboard(url);
    if (ok) {
      copiedUrl = url;
      setTimeout(() => {
        if (copiedUrl === url) copiedUrl = null;
      }, 1500);
    }
  }

  async function handleImportBackupFile(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    if (backupImportMode === "replace") {
      const confirmed = await confirmStore.confirm({
        title: "Replace Entire Instance Data",
        message:
          "Are you sure you want to replace all current conversations, settings, presets, skills, and memories with this backup file?",
        confirmText: "Replace Instance",
        confirmStyle: "danger",
        cancelText: "Cancel",
        cancelStyle: "ghost",
        cancelOutline: true,
      });
      if (!confirmed) {
        input.value = "";
        return;
      }
    }

    backupBusy = true;
    backupStatusMsg = null;
    backupIsError = false;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await importBackupBundle(bundle, backupImportMode);
      await settingsStore.init();
      await queryClient.invalidateQueries();
      const c = res.counts || {};
      backupStatusMsg = `Backup restored (${c.conversations ?? 0} chats, ${c.messages ?? 0} messages, ${c.modelSettings ?? 0} model settings, ${c.skills ?? 0} skills, ${c.memories ?? 0} memories).`;
    } catch (err: any) {
      backupIsError = true;
      backupStatusMsg = err?.message || "Failed to import backup file.";
    } finally {
      backupBusy = false;
      input.value = "";
    }
  }

  const builtInToolsQuery = createQuery(() => ({
    queryKey: ["builtinTools"],
    queryFn: fetchBuiltInTools,
    staleTime: 60_000,
  }));

  function toggleBuiltInTool(toolName: string, enabled: boolean) {
    const current = new Set(settingsStore.disabledBuiltInTools);
    if (enabled) {
      current.delete(toolName);
    } else {
      current.add(toolName);
    }
    settingsStore.update({ disabledBuiltInTools: Array.from(current) });
  }

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

  <!-- Network Connectivity Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-5"
  >
    <div class="border-b border-line pb-3">
      <h3 class="text-sm font-semibold text-fg">Network Connectivity</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Configure default network access permissions for built-in tools and rendered artifacts.
      </p>
    </div>

    <!-- Built-in Network Tools -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h4 class="text-xs font-semibold text-fg">
            Network-Dependent Built-in Tools
          </h4>
          <p class="text-[11px] text-fg-subtle mt-0.5">
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

      {#if settingsStore.networkToolsEnabled && builtInToolsQuery.data}
        {@const networkTools = builtInToolsQuery.data.filter(
          (t) => t.requiresNetwork,
        )}
        {#if networkTools.length > 0}
          <div class="ml-2 flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              Individual Network Tools
            </span>
            {#each networkTools as tool (tool.name)}
              {@const isToolEnabled = !settingsStore.disabledBuiltInTools.includes(
                tool.name,
              )}
              <div class="flex items-center justify-between gap-3 py-1">
                <div class="min-w-0">
                  <div class="text-xs font-mono font-medium text-fg">
                    {tool.name}
                  </div>
                  <div class="text-[11px] text-fg-subtle truncate max-w-md">
                    {tool.description}
                  </div>
                </div>
                <ToggleSwitch
                  id="builtin-tool-{tool.name}"
                  checked={isToolEnabled}
                  onchange={(checked) => toggleBuiltInTool(tool.name, checked)}
                  label="Enable {tool.name}"
                />
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="h-px bg-line/60"></div>

    <!-- Default Artifact Network Access -->
    <div class="flex items-center justify-between gap-4">
      <div>
        <h4 class="text-xs font-semibold text-fg">
          Default Artifact Network Access
        </h4>
        <p class="text-[11px] text-fg-subtle mt-0.5">
          Enable network access for rendered artifacts by default in the side panel. Disabled by default.
        </p>
      </div>
      <ToggleSwitch
        id="artifact-network-enable-toggle"
        checked={settingsStore.artifactNetworkEnabled}
        onchange={(checked) =>
          settingsStore.update({ artifactNetworkEnabled: checked })}
        label="Toggle default artifact network access"
      />
    </div>
  </div>

  <!-- Web Browser Access Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div class="flex items-center justify-between gap-4 border-b border-line pb-3">
      <div class="flex items-center gap-2 min-w-0">
        <Globe size={16} class="text-accent shrink-0" />
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-fg">Web Browser Access</h3>
          <p class="text-xs text-fg-subtle mt-0.5">
            Expose the Blombrain web interface on a port and host so you can access it from a web browser.
          </p>
        </div>
      </div>
      <ToggleSwitch
        id="web-access-enable-toggle"
        checked={settingsStore.webEnabled}
        disabled={webSaving}
        onchange={(checked) => void saveWebConfig(checked)}
        label="Toggle web browser access"
      />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="flex flex-col gap-1 sm:col-span-2">
        <label for="web-access-host" class="text-xs font-medium text-fg-muted">
          Accessible Host (Bind Address)
        </label>
        <input
          id="web-access-host"
          type="text"
          value={webHostDraft}
          oninput={(e) => {
            webHostDraft = (e.currentTarget as HTMLInputElement).value;
            webDirty = true;
            webFormError = null;
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveWebConfig();
            }
          }}
          placeholder="127.0.0.1 or 0.0.0.0"
          class="h-9 w-full rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg transition-colors focus:border-accent"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="web-access-port" class="text-xs font-medium text-fg-muted">
          Port
        </label>
        <input
          id="web-access-port"
          type="number"
          min="1"
          max="65535"
          value={webPortDraft}
          oninput={(e) => {
            webPortDraft = (e.currentTarget as HTMLInputElement).value;
            webDirty = true;
            webFormError = null;
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveWebConfig();
            }
          }}
          placeholder="4300"
          class="h-9 w-full rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg transition-colors focus:border-accent"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onclick={() => {
            webHostDraft = "127.0.0.1";
            webDirty = webHostDraft !== settingsStore.webHost || Number(webPortDraft) !== settingsStore.webPort;
            webFormError = null;
          }}
          class="rounded-md border px-2 py-1 text-[11px] font-mono transition-colors cursor-pointer {webHostDraft.trim() === '127.0.0.1'
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line bg-bg text-fg-muted hover:text-fg hover:bg-bg-hover'}"
        >
          127.0.0.1 (Local only)
        </button>
        <button
          type="button"
          onclick={() => {
            webHostDraft = "0.0.0.0";
            webDirty = webHostDraft !== settingsStore.webHost || Number(webPortDraft) !== settingsStore.webPort;
            webFormError = null;
          }}
          class="rounded-md border px-2 py-1 text-[11px] font-mono transition-colors cursor-pointer {webHostDraft.trim() === '0.0.0.0'
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-line bg-bg text-fg-muted hover:text-fg hover:bg-bg-hover'}"
        >
          0.0.0.0 (All / LAN)
        </button>
        {#if webStatus?.interfaces}
          {#each webStatus.interfaces as iface (iface.address + iface.name)}
            <button
              type="button"
              onclick={() => {
                webHostDraft = iface.address;
                webDirty = webHostDraft !== settingsStore.webHost || Number(webPortDraft) !== settingsStore.webPort;
                webFormError = null;
              }}
              class="rounded-md border px-2 py-1 text-[11px] font-mono transition-colors cursor-pointer {webHostDraft.trim() === iface.address
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-bg text-fg-muted hover:text-fg hover:bg-bg-hover'}"
              title="Bind only to {iface.name} ({iface.address})"
            >
              {iface.address} ({iface.name})
            </button>
          {/each}
        {/if}
      </div>

      <Button
        variant={webDirty ? "accent" : "default"}
        size="sm"
        disabled={webSaving || !webDirty}
        onclick={() => void saveWebConfig()}
      >
        {webSaving ? "Applying..." : "Apply"}
      </Button>
    </div>

    {#if webFormError}
      <div class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        {webFormError}
      </div>
    {:else if webStatus?.error}
      <div class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        {webStatus.error}
      </div>
    {/if}

    {#if settingsStore.webEnabled && !isLoopbackHostStr(settingsStore.webHost) && !authStore.authEnabled}
      <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
        <AlertTriangle size={14} class="shrink-0 mt-0.5" />
        <span>
          Blombrain is exposed on a non-loopback address without an Instance Password. Consider setting one in the <strong>User</strong> tab.
        </span>
      </div>
    {/if}

    {#if webStatus?.listening && webStatus.urls.length > 0}
      <div class="rounded-md border border-line bg-bg px-3 py-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2 text-[11px] text-success font-medium">
          <span>
            Listening on {webStatus.activeHost}:{webStatus.activePort}
          </span>
          {#if !webStatus.frontendAvailable}
            <span class="text-warning">Built frontend dist not found (dev API only)</span>
          {/if}
        </div>
        <div class="flex flex-wrap gap-2">
          {#each webStatus.urls as url (url)}
            <div class="inline-flex items-center gap-1 rounded-md border border-line bg-bg-elevated px-2 py-1 text-xs font-mono text-fg">
              <a
                href={url}
                target={desktopWindow.isTauri ? undefined : "_blank"}
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 hover:text-accent transition-colors"
                title="Open in browser"
              >
                <span>{url}</span>
                <ExternalLink size={11} class="text-fg-subtle" />
              </a>
              <button
                type="button"
                onclick={() => void handleCopyUrl(url)}
                aria-label="Copy URL {url}"
                title="Copy URL"
                class="ml-1 text-fg-subtle hover:text-fg cursor-pointer"
              >
                {#if copiedUrl === url}
                  <Check size={12} class="text-success" />
                {:else}
                  <Copy size={12} />
                {/if}
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Instance Backup & Restore Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div class="flex items-center gap-2 border-b border-line pb-3">
      <Database size={16} class="text-accent" />
      <div>
        <h3 class="text-sm font-semibold text-fg">Instance Backup &amp; Restore</h3>
        <p class="text-xs text-fg-subtle mt-0.5">
          Export a complete backup of your Blombrain instance (settings, backends, presets, MCP servers, skills, memories, conversations, and artifacts) or restore from a backup file.
        </p>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2.5">
        <ToggleSwitch
          id="backup-include-secrets-toggle"
          bind:checked={backupIncludeSecrets}
          label="Include API keys and MCP secrets in export"
        />
        <label
          for="backup-include-secrets-toggle"
          class="text-xs text-fg-muted cursor-pointer"
        >
          Include backend API keys &amp; MCP secrets in export
        </label>
      </div>

      <button
        type="button"
        disabled={backupBusy}
        onclick={async () => {
          backupBusy = true;
          backupStatusMsg = null;
          try {
            const saved = await triggerDownload(
              exportBackupUrl(backupIncludeSecrets, true),
              "blombrain-backup.zip",
            );
            if (saved) {
              backupStatusMsg = "Backup exported.";
            }
          } catch (err) {
            backupStatusMsg = `Export failed: ${(err as Error).message}`;
          } finally {
            backupBusy = false;
          }
        }}
        class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0 cursor-pointer"
      >
        <Download size={13} />
        <span>{backupBusy ? "Exporting..." : "Export Backup"}</span>
      </button>
    </div>

    <div class="h-px bg-line/60"></div>

    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-fg-muted shrink-0">Restore Mode:</span>
        <div class="w-56">
          <Dropdown
            id="backup-import-mode"
            bind:value={backupImportMode}
            options={[
              { label: "Merge with existing data", value: "merge" },
              { label: "Replace entire instance", value: "replace" },
            ]}
          />
        </div>
      </div>

      <div>
        <input
          bind:this={backupFileInput}
          type="file"
          accept=".json,application/json"
          class="hidden"
          onchange={handleImportBackupFile}
        />
        <Button
          variant="default"
          size="sm"
          onclick={() => backupFileInput?.click()}
          disabled={backupBusy}
        >
          <Upload size={13} />
          <span>{backupBusy ? "Restoring..." : "Import Backup File"}</span>
        </Button>
      </div>
    </div>

    {#if backupStatusMsg}
      <p class="text-xs {backupIsError ? 'text-danger' : 'text-success'}">
        {backupStatusMsg}
      </p>
    {/if}
  </div>
</div>
