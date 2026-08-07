<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    fetchMcpServers,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
  } from "../../api";
  import type { McpServerInfo, McpServerWriteBody } from "../../types";
  import Button from "../ui/Button.svelte";
  import Dropdown, { type DropdownOption } from "../ui/Dropdown.svelte";
  import {
    Plus,
    Trash2,
    AlertTriangle,
    CheckCircle,
    Server,
    RefreshCw,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  const transportTypeOptions: DropdownOption[] = [
    { label: "Local Binary (stdio)", value: "stdio" },
    { label: "Remote SSE / HTTP Endpoint", value: "http" },
  ];

  const queryClient = useQueryClient();

  const mcpQuery = createQuery(() => ({
    queryKey: ["mcpServers"],
    queryFn: fetchMcpServers,
  }));

  let isAdding = $state(false);
  let editingId = $state<string | null>(null);

  let name = $state("");
  let type = $state<"stdio" | "http">("stdio");
  let commandOrUrl = $state("");
  let argsText = $state("");
  let envText = $state("");
  let headersText = $state("");

  let formError = $state<string | null>(null);
  let formBusy = $state(false);

  function resetForm() {
    isAdding = false;
    editingId = null;
    name = "";
    type = "stdio";
    commandOrUrl = "";
    argsText = "";
    envText = "";
    headersText = "";
    formError = null;
    formBusy = false;
  }

  function startEdit(server: McpServerInfo) {
    editingId = server.id;
    name = server.name;
    type = server.type;
    commandOrUrl = server.commandOrUrl;
    argsText = (server.args || []).join(" ");
    envText = JSON.stringify(server.env || {}, null, 2);
    headersText = JSON.stringify(server.headers || {}, null, 2);
    isAdding = true;
    formError = null;
  }

  async function handleSave() {
    if (!name.trim() || !commandOrUrl.trim()) {
      formError = "Server Name and Command/URL are required.";
      return;
    }

    let parsedArgs: string[] = [];
    if (argsText.trim()) {
      parsedArgs = argsText.trim().split(/\s+/);
    }
    let parsedEnv: Record<string, string> = {};
    if (envText.trim()) {
      try {
        parsedEnv = JSON.parse(envText);
      } catch {
        formError = "Environment Variables must be a valid JSON object.";
        return;
      }
    }

    let parsedHeaders: Record<string, string> = {};
    if (headersText.trim()) {
      try {
        parsedHeaders = JSON.parse(headersText);
      } catch {
        formError = "Headers / Authorization must be a valid JSON object.";
        return;
      }
    }

    formBusy = true;
    formError = null;

    try {
      const payload: McpServerWriteBody = {
        name: name.trim(),
        type,
        commandOrUrl: commandOrUrl.trim(),
        args: parsedArgs,
        env: parsedEnv,
        headers: parsedHeaders,
      };

      if (editingId) {
        await updateMcpServer(editingId, payload);
      } else {
        await createMcpServer(payload);
      }

      await queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
      resetForm();
    } catch (err: any) {
      formError = err?.message || "Failed to save MCP server";
    } finally {
      formBusy = false;
    }
  }

  import { confirmStore } from "../../stores/confirmStore.svelte";

  async function handleDelete(server: McpServerInfo) {
    const confirmed = await confirmStore.confirm({
      title: "Delete MCP Server",
      message: `Are you sure you want to delete MCP server "${server.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;

    try {
      await deleteMcpServer(server.id);
      await queryClient.invalidateQueries({ queryKey: ["mcpServers"] });
    } catch (err: any) {
      alert("Failed to delete server: " + (err?.message || String(err)));
    }
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-base font-semibold text-fg">MCP Servers</h3>
      <p class="text-xs text-fg-subtle">
        Connect external Model Context Protocol servers (local binaries or
        HTTP/SSE endpoints).
      </p>
    </div>
    {#if !isAdding}
      <Button variant="accent" size="sm" onclick={() => (isAdding = true)}>
        <Plus size={14} class="mr-1" /> Add MCP Server
      </Button>
    {/if}
  </div>

  {#if isAdding}
    <div
      transition:slide={{ duration: 300 }}
      class="rounded-xl border border-line bg-bg-elevated p-4 space-y-4"
    >
      <h4 class="text-sm font-semibold text-fg">
        {editingId ? "Edit MCP Server" : "Add MCP Server"}
      </h4>

      {#if type === "stdio"}
        <div
          class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning"
        >
          <AlertTriangle size={16} class="shrink-0 mt-0.5" />
          <div>
            <span class="font-semibold">Security Warning:</span> Stdio MCP servers
            execute arbitrary local binaries and CLI arguments with your user permissions.
            Ensure you trust the server source.
          </div>
        </div>
      {/if}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            for="mcp-server-name"
            class="block text-xs font-medium text-fg-muted mb-1"
            >Server Name</label
          >
          <input
            id="mcp-server-name"
            bind:value={name}
            placeholder="e.g. SQLite DB, Github"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            for="mcp-transport-type"
            class="block text-xs font-medium text-fg-muted mb-1"
            >Transport Type</label
          >
          <Dropdown
            id="mcp-transport-type"
            value={type}
            options={transportTypeOptions}
            onchange={(val) => (type = val as "stdio" | "http")}
          />
        </div>
      </div>

      <div>
        <label
          for="mcp-cmd-url"
          class="block text-xs font-medium text-fg-muted mb-1"
        >
          {type === "stdio" ? "Command / Binary Path" : "SSE Endpoint URL"}
        </label>
        <input
          id="mcp-cmd-url"
          bind:value={commandOrUrl}
          placeholder={type === "stdio"
            ? "npx or /usr/local/bin/mcp-server"
            : "https://mcp.example.com/sse"}
          class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
        />
      </div>

      {#if type === "stdio"}
        <div>
          <label
            for="mcp-cmd-args"
            class="block text-xs font-medium text-fg-muted mb-1"
            >Arguments (space separated)</label
          >
          <input
            id="mcp-cmd-args"
            bind:value={argsText}
            placeholder="-y @modelcontextprotocol/server-sqlite --db path.db"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label
            for="mcp-cmd-env"
            class="block text-xs font-medium text-fg-muted mb-1"
            >Environment Variables (JSON object)</label
          >
          <textarea
            id="mcp-cmd-env"
            bind:value={envText}
            rows={3}
            placeholder={`{ "API_KEY": "secret" }`}
            class="w-full rounded-md border border-line bg-bg p-2 text-xs font-mono text-fg focus:outline-none focus:border-accent"
          ></textarea>
        </div>
      {:else if type === "http"}
        <div>
          <label
            for="mcp-http-headers"
            class="block text-xs font-medium text-fg-muted mb-1"
            >HTTP Headers / Authorization (JSON object)</label
          >
          <textarea
            id="mcp-http-headers"
            bind:value={headersText}
            rows={3}
            placeholder={`{\n  "Authorization": "Bearer your_token_here",\n  "X-Custom-Header": "value"\n}`}
            class="w-full rounded-md border border-line bg-bg p-2 text-xs font-mono text-fg focus:outline-none focus:border-accent"
          ></textarea>
        </div>
      {/if}

      {#if formError}
        <p class="text-xs text-danger font-medium">{formError}</p>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <Button
          variant="default"
          size="sm"
          onclick={resetForm}
          disabled={formBusy}>Cancel</Button
        >
        <Button
          variant="accent"
          size="sm"
          onclick={handleSave}
          disabled={formBusy}
        >
          {formBusy ? "Saving..." : "Save Server"}
        </Button>
      </div>
    </div>
  {:else}
    {#if mcpQuery.isLoading}
      <div class="flex items-center justify-center p-8 text-fg-subtle">
        <RefreshCw class="animate-spin mr-2" size={16} /> Loading MCP Servers...
      </div>
    {:else if mcpQuery.data && mcpQuery.data.length > 0}
    <div class="space-y-3">
      {#each mcpQuery.data as server (server.id)}
        <div
          class="flex items-center justify-between rounded-xl border border-line bg-bg-elevated p-3.5"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-inset border border-line text-fg-muted"
            >
              <Server size={18} />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm text-fg">{server.name}</span>
                <span
                  class="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase font-mono text-fg-subtle"
                  >{server.type}</span
                >
                {#if server.status === "connected"}
                  <span
                    class="flex items-center gap-1 text-[10px] text-success font-medium"
                  >
                    <CheckCircle size={10} /> Connected
                  </span>
                {:else if server.status === "error"}
                  <span
                    class="flex items-center gap-1 text-[10px] text-danger font-medium"
                  >
                    <AlertTriangle size={10} /> Error
                  </span>
                {/if}
              </div>
              <p
                class="text-xs text-fg-subtle font-mono truncate max-w-md mt-0.5"
              >
                {server.commandOrUrl}
                {(server.args || []).join(" ")}
              </p>
              {#if server.status === "error" && server.error}
                <p class="text-[11px] text-danger mt-1 max-w-md break-words">
                  {server.error}
                </p>
              {/if}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onclick={() => startEdit(server)}>Edit</Button
            >
            <button
              type="button"
              onclick={() => handleDelete(server)}
              aria-label="Delete {server.name}"
              class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-danger disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else if !isAdding}
    <div
      class="rounded-xl border border-dashed border-line p-8 text-center text-fg-subtle"
    >
      <Server size={32} class="mx-auto mb-2 opacity-50" />
      <p class="text-sm font-medium">No MCP Servers Configured</p>
      <p class="text-xs mt-1">
        Add local binary servers or remote HTTP endpoints to expand model tool
        capabilities.
      </p>
    </div>
  {/if}
{/if}
</div>
