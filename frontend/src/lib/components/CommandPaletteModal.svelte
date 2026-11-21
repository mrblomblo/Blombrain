<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import {
    searchConversations,
    fetchModels,
    fetchPromptTemplates,
    fetchConversationWorkspaceFile,
    fetchWorkspaceFileByPath,
    exportBackupUrl,
    triggerDownload,
  } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { settingsStore } from "../stores/settings.svelte";
  import { artifactStore } from "../stores/artifact.svelte";
  import { desktopWindow } from "../stores/window.svelte";
  import { THEMES, THEME_LABELS, type ThemeName } from "../theme.svelte";
  import {
    Search,
    SquarePen,
    Settings,
    Layers,
    Palette,
    MessageSquare,
    Keyboard,
    Download,
    PanelLeft,
    Code,
    X,
    FileText,
    Sparkles,
    RefreshCw,
  } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";

  interface Props {
    open: boolean;
    initialView?: "commands" | "shortcuts";
    onClose: () => void;
    onOpenSettings: () => void;
    onOpenPromptTemplates?: () => void;
    onToggleSidebar: () => void;
  }

  let {
    open,
    initialView = "commands",
    onClose,
    onOpenSettings,
    onOpenPromptTemplates,
    onToggleSidebar,
  }: Props = $props();

  let query = $state("");
  let view = $state<"commands" | "shortcuts">("commands");
  let selectedIdx = $state(0);

  $effect(() => {
    if (open) {
      view = initialView;
      query = "";
      selectedIdx = 0;
      return desktopWindow.registerActiveModal();
    }
  });

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    enabled: open,
  }));

  const promptTemplatesQuery = createQuery(() => ({
    queryKey: ["promptTemplates"],
    queryFn: fetchPromptTemplates,
    enabled: open,
  }));

  const searchHitsQuery = createQuery(() => ({
    queryKey: ["commandPaletteSearch", query.trim()],
    queryFn: () => searchConversations(query.trim(), true),
    enabled: open && query.trim().length >= 2,
    staleTime: 5_000,
  }));

  interface PaletteItem {
    id: string;
    group: string;
    label: string;
    sublabel?: string;
    shortcut?: string;
    icon: any;
    action: () => void;
  }

  let items = $derived.by<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: PaletteItem[] = [];

    // 1. Quick Actions
    const actions: PaletteItem[] = [
      {
        id: "act-find-in-chat",
        group: "Actions",
        label: "Find in Current Conversation",
        shortcut: "Ctrl+F",
        icon: Search,
        action: () => {
          onClose();
          if (chatStore.activePath.length > 0) {
            chatStore.openInChatSearch();
          }
        },
      },
      {
        id: "act-new-chat",
        group: "Actions",
        label: "New Chat",
        shortcut: "Ctrl+Shift+O",
        icon: SquarePen,
        action: () => {
          chatStore.newConversation();
          onClose();
        },
      },
      {
        id: "act-toggle-sidebar",
        group: "Actions",
        label: "Toggle Sidebar",
        shortcut: "Ctrl+B",
        icon: PanelLeft,
        action: () => {
          onToggleSidebar();
          onClose();
        },
      },
      {
        id: "act-open-settings",
        group: "Actions",
        label: "Open Settings",
        shortcut: "Ctrl+,",
        icon: Settings,
        action: () => {
          onClose();
          onOpenSettings();
        },
      },
      {
        id: "act-toggle-artifact",
        group: "Actions",
        label: artifactStore.isOpen ? "Close Artifact Panel" : "Open Artifact Panel",
        shortcut: "Ctrl+.",
        icon: Code,
        action: () => {
          if (artifactStore.isOpen) {
            artifactStore.close();
          } else if (artifactStore.conversationArtifacts.length > 0) {
            const first = artifactStore.conversationArtifacts[0];
            artifactStore.loadArtifact(
              first.id,
              first.conversationId,
              first.filename,
              first.title,
              first.language,
            );
          } else {
            artifactStore.isOpen = true;
          }
          onClose();
        },
      },
      ...(onOpenPromptTemplates
        ? [
            {
              id: "act-manage-prompt-templates",
              group: "Actions",
              label: "Manage Prompt Templates (/commands)",
              icon: Sparkles,
              action: () => {
                onClose();
                onOpenPromptTemplates();
              },
            },
          ]
        : []),
      ...(chatStore.effectiveWorkspacePath
        ? [
            {
              id: "act-refresh-workspace",
              group: "Actions",
              label: "Refresh Attached Workspace Files",
              sublabel: chatStore.effectiveWorkspacePath,
              icon: RefreshCw,
              action: () => {
                void chatStore.refreshWorkspaceFiles();
                onClose();
              },
            },
          ]
        : []),
      {
        id: "act-export-backup",
        group: "Actions",
        label: "Export Full Instance Backup",
        icon: Download,
        action: () => {
          onClose();
          void triggerDownload(exportBackupUrl(false, true), "blombrain-backup.zip").catch(
            (err) => console.error("Failed to export backup:", err),
          );
        },
      },
      {
        id: "act-shortcuts",
        group: "Actions",
        label: "View Keyboard Shortcuts",
        shortcut: "Ctrl+/",
        icon: Keyboard,
        action: () => {
          view = "shortcuts";
        },
      },
    ];

    for (const a of actions) {
      if (!q || a.label.toLowerCase().includes(q)) {
        list.push(a);
      }
    }

    // 1b. Attached Workspace Files
    if (chatStore.effectiveWorkspacePath && chatStore.workspaceFiles.length > 0) {
      const wsMatches = q
        ? chatStore.workspaceFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 10)
        : chatStore.workspaceFiles.slice(0, 5);
      for (const relPath of wsMatches) {
        list.push({
          id: `wsfile-${relPath}`,
          group: "Workspace Files",
          label: relPath,
          sublabel: "Open in Artifact Panel",
          icon: FileText,
          action: () => {
            const wsRoot = chatStore.effectiveWorkspacePath;
            const convId = chatStore.activeConversationId;
            onClose();
            if (!wsRoot) return;
            const loadPromise = convId
              ? fetchConversationWorkspaceFile(convId, relPath)
              : fetchWorkspaceFileByPath(wsRoot, relPath);
            void loadPromise
              .then((preview) => {
                artifactStore.openArtifact({
                  id: `workspace:${preview.path}`,
                  filename: preview.path,
                  conversationId: convId ?? undefined,
                  code: preview.content,
                  language: preview.language,
                  title: preview.path,
                });
              })
              .catch((err) => console.error("Failed to open workspace file:", err));
          },
        });
      }
    }

    // 1c. Prompt Templates (/commands)
    for (const tpl of promptTemplatesQuery.data ?? []) {
      if (
        !q ||
        tpl.name.toLowerCase().includes(q) ||
        (tpl.description || "").toLowerCase().includes(q) ||
        "prompt template".includes(q)
      ) {
        list.push({
          id: `prompt-${tpl.id}`,
          group: "Prompt Templates",
          label: `/${tpl.name}`,
          sublabel: tpl.description || tpl.content.slice(0, 80),
          icon: Sparkles,
          action: () => {
            const cur = chatStore.draftText;
            const sep = cur && !/\s$/.test(cur) ? " " : "";
            chatStore.draftText = `${cur}${sep}/${tpl.name} `;
            onClose();
          },
        });
      }
    }

    // 2. Matching Conversations & Messages
    for (const hit of (searchHitsQuery.data ?? []).slice(0, 8)) {
      list.push({
        id: `conv-${hit.conversationId}-${hit.messageId}`,
        group: "Conversations & Messages",
        label: hit.conversationTitle,
        sublabel: hit.snippet,
        icon: MessageSquare,
        action: () => {
          chatStore.loadConversation({
            id: hit.conversationId,
            title: hit.conversationTitle,
            model: null,
            createdAt: hit.createdAt,
            updatedAt: hit.createdAt,
          });
          onClose();
        },
      });
    }

    // 3. Models
    const visibleModels = (modelsQuery.data ?? []).filter(
      (m) => !m.isHidden && !m.isOffline && !m.isOrphaned,
    );
    for (const m of visibleModels) {
      const mName = m.name || m.id;
      if (
        !q ||
        mName.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.backendName.toLowerCase().includes(q)
      ) {
        list.push({
          id: `model-${m.id}`,
          group: "Switch Model",
          label: mName,
          sublabel: m.backendName,
          icon: Layers,
          action: () => {
            chatStore.setModel(m.id);
            onClose();
          },
        });
      }
    }

    // 4. Themes
    if (q) {
      for (const t of THEMES) {
        const label = THEME_LABELS[t] || t;
        if (label.toLowerCase().includes(q) || t.toLowerCase().includes(q) || "theme".includes(q)) {
          list.push({
            id: `theme-${t}`,
            group: "Switch Theme",
            label: `Theme: ${label}`,
            icon: Palette,
            action: () => {
              settingsStore.update({ theme: t as ThemeName });
              onClose();
            },
          });
        }
      }
    }

    return list;
  });

  $effect(() => {
    items.length;
    if (selectedIdx >= items.length) {
      selectedIdx = Math.max(0, items.length - 1);
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (view === "commands") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length > 0) {
          selectedIdx = (selectedIdx + 1) % items.length;
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length > 0) {
          selectedIdx = (selectedIdx - 1 + items.length) % items.length;
        }
      } else if (
        e.key === "Enter" &&
        !e.isComposing &&
        selectedIdx >= 0 &&
        selectedIdx < items.length
      ) {
        e.preventDefault();
        items[selectedIdx].action();
      }
    }
  }

  function focusSearchInput(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus());
  }

  const SHORTCUTS_LIST = [
    { keys: "Ctrl/Cmd + K", desc: "Open Command Palette & Full-Text Search" },
    { keys: "Ctrl/Cmd + F", desc: "Find in Current Conversation" },
    { keys: "Ctrl/Cmd + Shift + O", desc: "Start a New Chat" },
    { keys: "Ctrl/Cmd + B", desc: "Toggle Sidebar" },
    { keys: "Ctrl/Cmd + ,", desc: "Open Settings" },
    { keys: "Ctrl/Cmd + .", desc: "Toggle Artifact Panel" },
    { keys: "Ctrl/Cmd + /", desc: "View Keyboard Shortcuts" },
    { keys: "Enter", desc: "Send Message" },
    { keys: "Shift + Enter", desc: "Insert New Line in Message" },
    { keys: "Ctrl/Cmd + V", desc: "Paste Text or Upload Clipboard Image/File" },
    { keys: "Escape", desc: "Close Active Modal, Popover, or Cancel Edit" },
  ];
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label={view === "shortcuts" ? "Keyboard Shortcuts" : "Command Palette"}
    tabindex="-1"
    transition:fade={{ duration: 120 }}
    onclick={(e) => e.target === e.currentTarget && onClose()}
    onkeydown={handleKeydown}
    class="fixed inset-0 z-50 flex items-start justify-center bg-overlay backdrop-blur-xs {desktopWindow.isTauri
      ? 'pt-[max(3.75rem,12vh)]'
      : 'pt-[12vh]'} p-4"
  >
    <div
      transition:fly={{ y: -12, duration: 150 }}
      class="flex w-full max-w-xl max-h-full flex-col rounded-xl border border-line bg-bg shadow-2xl overflow-hidden"
    >
      {#if view === "commands"}
        <div class="flex items-center gap-2.5 border-b border-line bg-bg-elevated px-3.5 py-2.5">
          <Search size={15} class="text-fg-subtle shrink-0" />
          <input
            type="text"
            use:focusSearchInput
            bind:value={query}
            placeholder="Search chats, messages, models, themes, or type a command…"
            aria-label="Command palette search"
            class="w-full bg-transparent text-xs text-fg placeholder:text-fg-subtle"
          />
          <button
            type="button"
            onclick={() => (view = "shortcuts")}
            title="Keyboard shortcuts"
            class="rounded border border-line bg-bg px-1.5 py-0.5 text-[10px] font-mono text-fg-subtle hover:text-fg cursor-pointer shrink-0"
          >
            Shortcuts
          </button>
          <button
            type="button"
            onclick={onClose}
            aria-label="Close command palette"
            class="text-fg-subtle hover:text-fg cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div
          role="listbox"
          aria-label="Commands and search results"
          class="max-h-80 overflow-y-auto p-1.5 space-y-0.5"
        >
          {#if items.length === 0}
            <div class="py-8 text-center text-xs text-fg-subtle">
              No matching commands, models, or conversations found.
            </div>
          {:else}
            {#each items as item, idx (item.id)}
              {@const Icon = item.icon}
              {@const showGroupHeader =
                idx === 0 || items[idx - 1].group !== item.group}
              {#if showGroupHeader}
                <div class="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {item.group}
                </div>
              {/if}
              <button
                type="button"
                role="option"
                aria-selected={idx === selectedIdx}
                onmouseenter={() => (selectedIdx = idx)}
                onclick={item.action}
                class="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer {idx ===
                selectedIdx
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-fg hover:bg-bg-hover'}"
              >
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                  <Icon size={14} class="shrink-0 opacity-75" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate">{item.label}</div>
                    {#if item.sublabel}
                      <div class="truncate text-[10px] text-fg-subtle font-normal">
                        {item.sublabel}
                      </div>
                    {/if}
                  </div>
                </div>
                {#if item.shortcut}
                  <kbd class="shrink-0 rounded border border-line bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                    {item.shortcut}
                  </kbd>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="flex items-center justify-between border-b border-line bg-bg-elevated px-4 py-3">
          <div class="flex items-center gap-2">
            <Keyboard size={15} class="text-accent" />
            <h3 class="text-xs font-semibold text-fg">Keyboard Shortcuts</h3>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => (view = "commands")}
              class="text-xs text-accent hover:underline cursor-pointer"
            >
              Back to Search
            </button>
            <button
              type="button"
              onclick={onClose}
              aria-label="Close shortcuts modal"
              class="text-fg-subtle hover:text-fg cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div class="p-4 space-y-2 max-h-80 overflow-y-auto">
          {#each SHORTCUTS_LIST as sc}
            <div class="flex items-center justify-between gap-4 py-1 border-b border-line/40 last:border-0 text-xs">
              <span class="text-fg-muted">{sc.desc}</span>
              <kbd class="rounded border border-line bg-bg-inset px-2 py-0.5 font-mono text-[11px] text-fg">
                {sc.keys}
              </kbd>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
