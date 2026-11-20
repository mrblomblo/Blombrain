<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    X,
    Plus,
    Pencil,
    Trash2,
    Check,
    Play,
    Square,
    RotateCw,
    Terminal,
  } from "@lucide/svelte";
  import {
    fetchBackends,
    fetchBackendProtocols,
    createBackend,
    updateBackend,
    deleteBackend,
    setBackendEnabled,
    controlBackendProcess,
    fetchBackendLogs,
  } from "../../api";
  import type { BackendInfo } from "../../types";
  import { flip } from "svelte/animate";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import ToggleSwitch from "../ui/ToggleSwitch.svelte";
  import Button from "../ui/Button.svelte";
  import Dropdown from "../ui/Dropdown.svelte";
  import { confirmStore } from "../../stores/confirmStore.svelte";

  const queryClient = useQueryClient();

  const backendsQuery = createQuery(() => ({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        Array.isArray(data) &&
        data.some(
          (b) =>
            b.launchCommand &&
            (b.process?.state === "running" || b.process?.state === "stopping"),
        )
      ) {
        return 3000;
      }
      return false;
    },
  }));

  const protocolsQuery = createQuery(() => ({
    queryKey: ["backendProtocols"],
    queryFn: fetchBackendProtocols,
  }));

  let apiTypeOptions = $derived(
    protocolsQuery.data?.map((p) => ({ label: p.name, value: p.id })) ?? [
      { label: "OpenAI Compatible", value: "openai" },
      { label: "Ollama Native", value: "ollama" },
    ],
  );

  let protocolMap = $derived(
    new Map((protocolsQuery.data ?? []).map((p) => [p.id, p])),
  );

  type FormMode = "idle" | "add" | "edit";
  let formMode = $state<FormMode>("idle");
  let editingId = $state<string | null>(null);

  let formId = $state("");
  let formName = $state("");
  let formBaseUrl = $state("");
  let formPrefix = $state("");
  let formApiKey = $state("");
  let formApiType = $state<string>("openai");
  let formClearKey = $state(false);
  let formLaunchCommand = $state("");
  let formLaunchCwd = $state("");
  let formIsEnabled = $state(true);

  let formError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let formBusy = $state(false);
  let deletingId = $state<string | null>(null);
  let busyBackendIds = $state<Record<string, boolean>>({});
  let openLogsId = $state<string | null>(null);

  const logsQuery = createQuery(() => ({
    queryKey: ["backendLogs", openLogsId],
    queryFn: () => fetchBackendLogs(openLogsId!),
    enabled: openLogsId !== null,
    refetchInterval: 2000,
  }));

  function startAdd() {
    formMode = "add";
    editingId = null;
    formId = "";
    formName = "";
    formBaseUrl = "";
    formPrefix = "";
    formApiKey = "";
    formApiType = "openai";
    formClearKey = false;
    formLaunchCommand = "";
    formLaunchCwd = "";
    formIsEnabled = true;
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
    formApiType = b.apiType ?? "openai";
    formClearKey = false;
    formLaunchCommand = b.launchCommand ?? "";
    formLaunchCwd = b.launchCwd ?? "";
    formIsEnabled = b.isEnabled;
    formError = null;
  }

  function cancelForm() {
    formMode = "idle";
    editingId = null;
    formError = null;
  }

  async function refreshLists() {
    await queryClient.invalidateQueries({ queryKey: ["backends"] });
    await queryClient.invalidateQueries({ queryKey: ["models"] });
    if (openLogsId) {
      await queryClient.invalidateQueries({ queryKey: ["backendLogs", openLogsId] });
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    formBusy = true;

    try {
      const launchCommand = formLaunchCommand.trim() || null;
      const launchCwd = formLaunchCwd.trim() || null;
      if (formMode === "add") {
        await createBackend({
          id: formId.trim(),
          name: formName.trim(),
          baseUrl: formBaseUrl.trim(),
          prefix: formPrefix.trim(),
          apiKey: formApiKey.trim() || undefined,
          apiType: formApiType,
          launchCommand,
          launchCwd,
          isEnabled: formIsEnabled,
        });
      } else if (formMode === "edit" && editingId) {
        await updateBackend(editingId, {
          name: formName.trim(),
          baseUrl: formBaseUrl.trim(),
          prefix: formPrefix.trim(),
          apiKey: formClearKey ? "" : formApiKey.trim() || undefined,
          apiType: formApiType,
          launchCommand: launchCommand ?? "",
          launchCwd: launchCwd ?? "",
          isEnabled: formIsEnabled,
        });
      }
      await refreshLists();
      cancelForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : "An error occurred.";
    } finally {
      formBusy = false;
    }
  }

  async function handleToggleEnabled(b: BackendInfo, enabled: boolean) {
    actionError = null;
    busyBackendIds = { ...busyBackendIds, [b.id]: true };
    try {
      await setBackendEnabled(b.id, enabled);
      await refreshLists();
      if (editingId === b.id) {
        formIsEnabled = enabled;
      }
    } catch (err) {
      actionError =
        err instanceof Error ? err.message : "Failed to update backend state.";
    } finally {
      const next = { ...busyBackendIds };
      delete next[b.id];
      busyBackendIds = next;
    }
  }

  async function handleProcessAction(
    b: BackendInfo,
    action: "start" | "stop" | "restart",
  ) {
    actionError = null;
    busyBackendIds = { ...busyBackendIds, [b.id]: true };
    try {
      await controlBackendProcess(b.id, action);
      await refreshLists();
    } catch (err) {
      actionError =
        err instanceof Error ? err.message : `Failed to ${action} command.`;
    } finally {
      const next = { ...busyBackendIds };
      delete next[b.id];
      busyBackendIds = next;
    }
  }

  async function handleDelete(b: BackendInfo) {
    const confirmed = await confirmStore.confirm({
      title: "Delete Backend",
      message: `Are you sure you want to delete backend "${b.name}"? Any running launch command for it will also be stopped. This action cannot be undone.`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;
    deletingId = b.id;
    actionError = null;
    try {
      await deleteBackend(b.id);
      if (openLogsId === b.id) openLogsId = null;
      await refreshLists();
      if (editingId === b.id) cancelForm();
    } catch (err) {
      actionError =
        err instanceof Error ? err.message : "Failed to delete backend.";
    } finally {
      deletingId = null;
    }
  }

  function processLabel(b: BackendInfo): string {
    const p = b.process;
    if (!p) return "";
    if (p.state === "running") return p.pid ? `running (pid ${p.pid})` : "running";
    if (p.state === "stopping") return "stopping...";
    if (p.state === "failed") return p.error ? `failed: ${p.error}` : "failed";
    if (p.state === "exited") {
      return p.exitCode !== null
        ? `exited (${p.exitCode})`
        : p.signal
          ? `exited (${p.signal})`
          : "exited";
    }
    return "stopped";
  }
</script>

<div class="flex h-full flex-col">
  {#if actionError}
    <div
      role="alert"
      class="mb-3 flex items-center justify-between gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      <span>{actionError}</span>
      <button
        type="button"
        onclick={() => (actionError = null)}
        class="shrink-0 rounded p-0.5 hover:bg-danger/20 cursor-pointer"
        aria-label="Dismiss error"
      >
        <X size={13} />
      </button>
    </div>
  {/if}

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
          {@const rowBusy = Boolean(busyBackendIds[b.id])}
          {@const procRunning = b.process?.state === "running"}
          {@const procStopping = b.process?.state === "stopping"}
          <li
            animate:flip={{ duration: 300, easing: quintOut }}
            out:slide={{ duration: 250, easing: quintOut }}
            class="flex flex-col gap-2 rounded-lg border bg-bg-elevated px-4 py-3 text-sm transition-colors"
            class:border-accent={editingId === b.id}
            class:border-line={editingId !== b.id}
            class:opacity-70={!b.isEnabled}
          >
            <div class="flex items-center gap-3">
              <!-- Status dot -->
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                class:bg-success={b.status === "online"}
                class:bg-danger={b.status === "offline"}
                class:bg-fg-subtle={b.status === "unknown" || b.status === "disabled"}
                title={b.status === "disabled" ? "Disabled" : b.status}
                aria-hidden="true"
              ></span>
              <!-- Info -->
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-fg">{b.name}</p>
                <p class="truncate font-mono text-[11px] text-fg-subtle">
                  {b.baseUrl}
                </p>
              </div>
              {#key b.apiType}
                {@const proto = protocolMap.get(b.apiType ?? "openai")}
                <span
                  class="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-sans text-[10px] text-accent font-medium"
                >
                  {proto?.badgeLabel || b.apiType || "OpenAI"}
                </span>
              {/key}
              <span
                class="shrink-0 rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle"
              >
                {b.prefix}:
              </span>
              <!-- Enable/disable + edit/delete -->
              <div class="flex shrink-0 items-center gap-1.5">
                <ToggleSwitch
                  checked={b.isEnabled}
                  disabled={rowBusy || formBusy}
                  label="Enable {b.name}"
                  onchange={(checked) => handleToggleEnabled(b, checked)}
                />
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
            </div>

            {#if b.launchCommand}
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2 text-xs"
              >
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    class="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] {procRunning
                      ? 'bg-success/15 text-success'
                      : b.process?.state === 'failed' ||
                          b.process?.state === 'exited'
                        ? 'bg-danger/15 text-danger'
                        : 'bg-bg text-fg-subtle'}"
                  >
                    {processLabel(b)}
                  </span>
                  <span
                    class="truncate font-mono text-[11px] text-fg-muted"
                    title={b.launchCommand}
                  >
                    $ {b.launchCommand}
                  </span>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  {#if procRunning || procStopping}
                    <button
                      type="button"
                      onclick={() => handleProcessAction(b, "restart")}
                      disabled={rowBusy || !b.isEnabled}
                      title="Restart launch command"
                      aria-label="Restart {b.name} process"
                      class="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                    >
                      <RotateCw size={11} />
                    </button>
                    <button
                      type="button"
                      onclick={() => handleProcessAction(b, "stop")}
                      disabled={rowBusy || procStopping}
                      title="Stop launch command"
                      aria-label="Stop {b.name} process"
                      class="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Square size={11} />
                    </button>
                  {:else}
                    <button
                      type="button"
                      onclick={() => handleProcessAction(b, "start")}
                      disabled={rowBusy || !b.isEnabled}
                      title={b.isEnabled
                        ? "Start launch command"
                        : "Enable backend to start its command"}
                      aria-label="Start {b.name} process"
                      class="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-success disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Play size={11} />
                    </button>
                  {/if}
                  <button
                    type="button"
                    onclick={() =>
                      (openLogsId = openLogsId === b.id ? null : b.id)}
                    title="Toggle process logs"
                    aria-label="Toggle logs for {b.name}"
                    class="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors cursor-pointer hover:bg-bg {openLogsId ===
                    b.id
                      ? 'bg-bg text-accent'
                      : 'text-fg-muted hover:text-fg'}"
                  >
                    <Terminal size={11} />
                    <span>Logs</span>
                  </button>
                </div>
              </div>

              {#if openLogsId === b.id}
                <div
                  transition:slide={{ duration: 150 }}
                  class="rounded-md border border-line bg-bg p-2.5 font-mono text-[11px] text-fg-muted"
                >
                  {#if logsQuery.isLoading}
                    <p class="text-fg-subtle">Loading logs...</p>
                  {:else if (logsQuery.data?.lines ?? []).length === 0}
                    <p class="text-fg-subtle">No process output yet.</p>
                  {:else}
                    <pre class="max-h-44 overflow-auto whitespace-pre-wrap break-all">{(
                        logsQuery.data?.lines ?? []
                      ).join("\n")}</pre>
                  {/if}
                </div>
              {/if}
            {/if}
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
              placeholder="Local llama.cpp"
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
          <label for="be-apitype" class="text-xs text-fg-muted"
            >API Protocol</label
          >
          <Dropdown
            id="be-apitype"
            bind:value={formApiType}
            options={apiTypeOptions}
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="be-launch-cmd" class="text-xs text-fg-muted">
            Startup command
            <span class="text-fg-subtle">(optional)</span>
          </label>
          <input
            id="be-launch-cmd"
            bind:value={formLaunchCommand}
            placeholder="llama-server -m /path/to/model.gguf --port 8080"
            class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus-visible:border-accent transition-colors duration-200"
          />
          <p class="text-[11px] text-fg-subtle">
            Runs in the background when Blombrain starts (while enabled) and is
            stopped when you disable this backend or close Blombrain. Keep the
            process in the foreground (e.g. <code class="font-mono">ollama serve</code>).
          </p>
        </div>

        {#if formLaunchCommand.trim()}
          <div class="flex flex-col gap-1">
            <label for="be-launch-cwd" class="text-xs text-fg-muted">
              Working directory
              <span class="text-fg-subtle">(optional)</span>
            </label>
            <input
              id="be-launch-cwd"
              bind:value={formLaunchCwd}
              placeholder="/path/to/working/dir"
              class="h-8 rounded-md border border-line bg-bg px-3 font-mono text-xs text-fg focus-visible:border-accent transition-colors duration-200"
            />
          </div>
        {/if}

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

        <div class="flex items-center gap-2 pt-0.5">
          <ToggleSwitch id="be-enabled" bind:checked={formIsEnabled} />
          <label for="be-enabled" class="cursor-pointer text-xs text-fg-muted">
            Enabled (start launch command and sync models)
          </label>
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
