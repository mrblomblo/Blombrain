<script lang="ts">
  import { onMount } from "svelte";
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import {
    Menu,
    SlidersHorizontal,
    StickyNote,
    Code,
    Search,
    Trash2,
    Plus,
    X,
  } from "@lucide/svelte";
  import { fly, fade } from "svelte/transition";
  import { quintOut, cubicOut } from "svelte/easing";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import AttachmentModal from "./lib/components/AttachmentModal.svelte";
  import ConfirmModal from "./lib/components/ConfirmModal.svelte";
  import ArtifactPanel from "./lib/components/ArtifactPanel.svelte";
  import LoginScreen from "./lib/components/LoginScreen.svelte";
  import CommandPaletteModal from "./lib/components/CommandPaletteModal.svelte";
  import WindowControls from "./lib/components/WindowControls.svelte";
  import {
    upsertScratchpadEntry,
    deleteScratchpadEntryApi,
  } from "./lib/api";
  import {
    chatStore,
    registerConversationsInvalidator,
  } from "./lib/stores/chat.svelte";
  import { settingsStore } from "./lib/stores/settings.svelte";
  import { artifactStore } from "./lib/stores/artifact.svelte";
  import { authStore, checkAuth } from "./lib/stores/auth.svelte";
  import { desktopWindow } from "./lib/stores/window.svelte";

  settingsStore.init();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
      },
    },
  });

  registerConversationsInvalidator(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  });

  let settingsOpen = $state(false);
  let SettingsModalComponent = $state<any>(null);
  let commandPaletteOpen = $state(false);
  let commandPaletteView = $state<"commands" | "shortcuts">("commands");
  let showSessionParams = $state(false);
  let showScratchpad = $state(false);
  let newScratchKey = $state("");
  let newScratchContent = $state("");
  let mobileSidebarOpen = $state(false);
  let desktopSidebarOpen = $state(true);
  let inputHeight = $state(112);

  $effect(() => {
    if (settingsOpen && !SettingsModalComponent) {
      import("./lib/components/SettingsModal.svelte").then((mod) => {
        SettingsModalComponent = mod.default;
      });
    }
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key === "k") {
      e.preventDefault();
      commandPaletteView = "commands";
      commandPaletteOpen = !commandPaletteOpen;
    } else if (key === "/") {
      e.preventDefault();
      commandPaletteView = "shortcuts";
      commandPaletteOpen = true;
    } else if (key === "b") {
      e.preventDefault();
      desktopSidebarOpen = !desktopSidebarOpen;
    } else if (key === ",") {
      e.preventDefault();
      settingsOpen = !settingsOpen;
    } else if (key === ".") {
      e.preventDefault();
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
      }
    } else if (key === "f") {
      if (desktopWindow.activeModalCount === 0 && chatStore.activePath.length > 0) {
        e.preventDefault();
        chatStore.openInChatSearch();
      }
    } else if (e.shiftKey && key === "o") {
      e.preventDefault();
      if (!chatStore.isStreaming) {
        chatStore.newConversation();
      }
    }
  }

  async function handleAddScratchpad() {
    if (!chatStore.activeConversationId || !newScratchKey.trim() || !newScratchContent.trim()) return;
    chatStore.scratchpadEntries = await upsertScratchpadEntry(
      chatStore.activeConversationId,
      newScratchKey.trim(),
      newScratchContent.trim(),
    );
    newScratchKey = "";
    newScratchContent = "";
  }

  async function handleDeleteScratchpad(key: string) {
    if (!chatStore.activeConversationId) return;
    chatStore.scratchpadEntries = await deleteScratchpadEntryApi(
      chatStore.activeConversationId,
      key,
    );
  }

  let hasSessionOverrides = $derived(
    Boolean(
      chatStore.conversationSystemPromptOverride ||
        chatStore.conversationSamplingOverrides?.temperature != null ||
        chatStore.conversationSamplingOverrides?.maxTokens != null ||
        chatStore.conversationSamplingOverrides?.reasoningEffort,
    ),
  );

  let isNewChat = $derived(chatStore.activePath.length === 0);
  let isFramedTauri = $derived(desktopWindow.isTauri && !desktopWindow.isMaximized);

  $effect(() => {
    if (mobileSidebarOpen) {
      return desktopWindow.registerActiveModal();
    }
  });

  let hasInitialized = $state(false);

  onMount(() => {
    const detachWindowListeners = desktopWindow.attachListeners();

    checkAuth().then(() => {
      const match = window.location.pathname.match(/^\/chat\/([a-zA-Z0-9-]+)$/);
      if (match) {
        const uuid = match[1];
        chatStore.loadConversation({ id: uuid } as any).finally(() => {
          hasInitialized = true;
        });
      } else {
        hasInitialized = true;
      }
    });

    const onPopstate = () => {
      const match = window.location.pathname.match(/^\/chat\/([a-zA-Z0-9-]+)$/);
      if (match) {
        chatStore.loadConversation({ id: match[1] } as any);
      } else {
        chatStore.newConversation();
      }
    };
    window.addEventListener("popstate", onPopstate);

    return () => {
      detachWindowListeners();
      window.removeEventListener("popstate", onPopstate);
    };
  });

  $effect(() => {
    if (!hasInitialized) return;

    if (chatStore.activeConversationId) {
      const targetUrl = `/chat/${chatStore.activeConversationId}`;
      if (window.location.pathname !== targetUrl) {
        window.history.pushState({}, "", targetUrl);
      }
    } else {
      if (window.location.pathname !== "/") {
        window.history.pushState({}, "", "/");
      }
    }
  });
  function panelFly(node: Element, { duration = 300 }) {
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    return fly(node, {
      x: isDesktop ? 400 : 0,
      y: isDesktop ? 0 : window.innerHeight || 600,
      duration,
      easing: quintOut,
    });
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div
  class="relative h-dvh w-screen overflow-hidden {isFramedTauri
    ? 'rounded-xl p-[1px] bg-line tauri-window-frame'
    : ''}"
>
  <div
    class="relative flex h-full w-full overflow-hidden bg-bg text-fg {isFramedTauri
      ? 'rounded-[11px] tauri-window-inner'
      : ''}"
  >
    {#if !authStore.initialized}
      <div
        data-tauri-drag-region={desktopWindow.isTauri ? "deep" : undefined}
        class="relative flex h-full w-full items-center justify-center bg-bg text-fg font-medium overflow-hidden"
      >
        {#if desktopWindow.isTauri}
          <div
            data-tauri-drag-region="deep"
            class="fixed top-0 left-0 right-0 flex h-14 items-center justify-end px-2.5 z-50"
          >
            <WindowControls standalone />
          </div>
        {/if}
        Loading...
      </div>
    {:else if authStore.authEnabled && !authStore.authenticated}
      <div class="relative h-full w-full bg-bg overflow-hidden">
        {#if desktopWindow.isTauri}
          <div
            data-tauri-drag-region="deep"
            class="fixed top-0 left-0 right-0 flex h-14 items-center justify-end px-2.5 z-50"
          >
            <WindowControls standalone />
          </div>
        {/if}
        <LoginScreen />
      </div>
    {:else}
      <QueryClientProvider client={queryClient}>
        <div class="relative flex h-full w-full bg-bg text-fg overflow-hidden">
      <!-- Desktop Sidebar -->
      <div class="hidden md:flex h-full">
        <Sidebar
          onOpenSettings={() => (settingsOpen = true)}
          onToggleSidebar={() => (desktopSidebarOpen = !desktopSidebarOpen)}
          collapsed={!desktopSidebarOpen}
        />
      </div>

      <!-- Mobile Drawer Overlay -->
      {#if mobileSidebarOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          transition:fade={{ duration: 300, easing: cubicOut }}
          class="fixed inset-0 z-40 bg-overlay backdrop-blur-xs md:hidden"
          onclick={() => (mobileSidebarOpen = false)}
        ></div>
        <div
          transition:fly={{
            x: -280,
            duration: 200,
            opacity: 1,
            easing: cubicOut,
          }}
          class="fixed inset-y-0 left-0 z-50 w-64 md:hidden shadow-2xl"
        >
          <Sidebar
            onOpenSettings={() => {
              settingsOpen = true;
              mobileSidebarOpen = false;
            }}
            onCloseMobile={() => (mobileSidebarOpen = false)}
          />
        </div>
      {/if}

      <!-- Main Content Area with conditional Artifact Panel -->
      <div class="relative flex min-w-0 flex-1 h-full overflow-hidden">
        <!-- Main Content Pane -->
        <main
          class="relative flex min-w-0 flex-1 flex-col h-full overflow-hidden transition-all duration-300 ease-in-out {artifactStore.isOpen &&
          !artifactStore.isExpanded
            ? 'lg:mr-[48%]'
            : ''}"
        >
          <header
            data-tauri-drag-region={desktopWindow.isTauri ? "deep" : undefined}
            class="@container flex h-14 items-center justify-between gap-1.5 border-b border-line px-2.5 bg-bg shrink-0 z-30"
          >
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <!-- Mobile Menu -->
              <button
                type="button"
                onclick={() => (mobileSidebarOpen = true)}
                aria-label="Open menu"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted md:hidden hover:bg-bg-elevated hover:text-fg"
              >
                <Menu size={18} />
              </button>

              <!-- Model Picker -->
              <div class="min-w-0 shrink max-w-[240px]">
                <ModelPicker />
              </div>

              <!-- Per-Conversation Session Parameters Override Popover -->
              <div class="relative shrink-0">
                <button
                  type="button"
                  onclick={() => {
                    showSessionParams = !showSessionParams;
                    if (showSessionParams) showScratchpad = false;
                  }}
                  aria-label="Chat session parameters"
                  aria-expanded={showSessionParams}
                  title="Per-chat sampling and system prompt overrides"
                  class="flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors cursor-pointer {hasSessionOverrides ||
                  showSessionParams
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-line bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-hover'}"
                >
                  <SlidersHorizontal size={13} />
                  <span class="hidden @[440px]:inline">Params</span>
                </button>

                {#if showSessionParams}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
                    class="fixed inset-0 z-40"
                    onclick={() => (showSessionParams = false)}
                  ></div>
                  <div
                    data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
                    transition:fly={{ y: -6, duration: 150 }}
                    class="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-xl border border-line bg-bg-elevated p-3.5 shadow-2xl space-y-3 text-xs"
                  >
                    <div class="flex items-center justify-between border-b border-line pb-2">
                      <span class="font-semibold text-fg">Chat Session Overrides</span>
                      {#if hasSessionOverrides}
                        <button
                          type="button"
                          onclick={() =>
                            chatStore.updateSessionOverrides({
                              systemPromptOverride: null,
                              samplingOverrides: null,
                            })}
                          class="text-[11px] text-danger hover:underline cursor-pointer"
                        >
                          Reset All
                        </button>
                      {/if}
                    </div>

                    <div class="grid grid-cols-2 gap-2.5">
                      <div class="flex flex-col gap-1">
                        <label for="sess-temp" class="text-[11px] text-fg-muted">
                          Temperature
                        </label>
                        <input
                          id="sess-temp"
                          type="number"
                          step="0.05"
                          min="0"
                          max="2"
                          placeholder="Model default"
                          value={chatStore.conversationSamplingOverrides?.temperature ?? ""}
                          onchange={(e) => {
                            const val = (e.currentTarget as HTMLInputElement).value;
                            chatStore.updateSessionOverrides({
                              samplingOverrides: {
                                ...chatStore.conversationSamplingOverrides,
                                temperature: val !== "" ? Number(val) : null,
                              },
                            });
                          }}
                          class="h-7 rounded-md border border-line bg-bg px-2 font-mono text-xs text-fg focus:border-accent"
                        />
                      </div>

                      <div class="flex flex-col gap-1">
                        <label for="sess-maxtok" class="text-[11px] text-fg-muted">
                          Max Tokens
                        </label>
                        <input
                          id="sess-maxtok"
                          type="number"
                          min="1"
                          placeholder="Model default"
                          value={chatStore.conversationSamplingOverrides?.maxTokens ?? ""}
                          onchange={(e) => {
                            const val = (e.currentTarget as HTMLInputElement).value;
                            chatStore.updateSessionOverrides({
                              samplingOverrides: {
                                ...chatStore.conversationSamplingOverrides,
                                maxTokens: val !== "" ? Number(val) : null,
                              },
                            });
                          }}
                          class="h-7 rounded-md border border-line bg-bg px-2 font-mono text-xs text-fg focus:border-accent"
                        />
                      </div>
                    </div>

                    <div class="flex flex-col gap-1">
                      <label for="sess-prompt" class="text-[11px] text-fg-muted">
                        Conversation System Prompt Appendix
                      </label>
                      <textarea
                        id="sess-prompt"
                        rows={3}
                        placeholder="Additional instructions scoped only to this chat…"
                        value={chatStore.conversationSystemPromptOverride ?? ""}
                        onchange={(e) => {
                          const val = (e.currentTarget as HTMLTextAreaElement).value.trim();
                          chatStore.updateSessionOverrides({
                            systemPromptOverride: val || null,
                          });
                        }}
                        class="w-full rounded-md border border-line bg-bg p-2 text-xs text-fg focus:border-accent"
                      ></textarea>
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Ephemeral Conversation Scratchpad Inspector -->
              {#if chatStore.activeConversationId && (chatStore.scratchpadEntries.length > 0 || showScratchpad)}
                <div class="relative shrink-0">
                  <button
                    type="button"
                    onclick={() => {
                      showScratchpad = !showScratchpad;
                      if (showScratchpad) showSessionParams = false;
                    }}
                    aria-label="Conversation scratchpad"
                    aria-expanded={showScratchpad}
                    title="View ephemeral conversation scratchpad notes"
                    class="flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors cursor-pointer {showScratchpad
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-line bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-hover'}"
                  >
                    <StickyNote size={13} class="text-accent" />
                    <span class="hidden @[540px]:inline">Scratchpad</span>
                    <span class="rounded-full bg-accent/20 px-1.5 py-0.2 font-mono text-[10px] text-accent">
                      {chatStore.scratchpadEntries.length}
                    </span>
                  </button>

                  {#if showScratchpad}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
                      class="fixed inset-0 z-40"
                      onclick={() => (showScratchpad = false)}
                    ></div>
                    <div
                      data-tauri-drag-region={desktopWindow.isTauri ? "false" : undefined}
                      transition:fly={{ y: -6, duration: 150 }}
                      class="absolute left-0 top-full mt-1.5 z-50 w-80 rounded-xl border border-line bg-bg-elevated p-3.5 shadow-2xl space-y-2.5 text-xs"
                    >
                      <div class="flex items-center justify-between border-b border-line pb-2">
                        <span class="font-semibold text-fg">Conversation Scratchpad</span>
                        <button
                          type="button"
                          onclick={() => (showScratchpad = false)}
                          aria-label="Close scratchpad"
                          class="text-fg-subtle hover:text-fg cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>

                      <div class="max-h-52 overflow-y-auto space-y-2">
                        {#each chatStore.scratchpadEntries as entry (entry.key)}
                          <div class="rounded-lg border border-line bg-bg p-2">
                            <div class="flex items-center justify-between gap-2 mb-1">
                              <span class="font-mono text-[11px] font-semibold text-accent">
                                {entry.key}
                              </span>
                              <button
                                type="button"
                                onclick={() => handleDeleteScratchpad(entry.key)}
                                aria-label="Delete scratchpad key {entry.key}"
                                class="text-fg-subtle hover:text-danger cursor-pointer"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                            <p class="text-[11px] text-fg whitespace-pre-wrap break-words font-mono">
                              {entry.content}
                            </p>
                          </div>
                        {/each}
                      </div>

                      <div class="border-t border-line pt-2 space-y-1.5">
                        <input
                          type="text"
                          bind:value={newScratchKey}
                          placeholder="Key (e.g. plan)"
                          class="h-7 w-full rounded border border-line bg-bg px-2 font-mono text-[11px] text-fg"
                        />
                        <div class="flex gap-1.5">
                          <input
                            type="text"
                            bind:value={newScratchContent}
                            placeholder="Note content…"
                            class="h-7 flex-1 rounded border border-line bg-bg px-2 text-[11px] text-fg"
                          />
                          <button
                            type="button"
                            onclick={handleAddScratchpad}
                            aria-label="Add scratchpad note"
                            class="flex h-7 px-2 items-center justify-center rounded bg-accent text-accent-fg text-[11px] font-medium cursor-pointer"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Right Header Controls: Conversation Artifacts Pill & Command Palette -->
            <div class="flex items-center gap-1.5 shrink-0">
              {#if artifactStore.conversationArtifacts.length > 0}
                <button
                  type="button"
                  onclick={() => {
                    if (artifactStore.isOpen) {
                      artifactStore.close();
                    } else {
                      const target =
                        artifactStore.conversationArtifacts.find(
                          (a) => a.id === artifactStore.activeId,
                        ) ?? artifactStore.conversationArtifacts[0];
                      if (target) {
                        artifactStore.loadArtifact(
                          target.id,
                          target.conversationId,
                          target.filename,
                          target.title,
                          target.language,
                        );
                      }
                    }
                  }}
                  aria-label="Toggle conversation artifacts panel"
                  title="Browse artifacts in this conversation (Ctrl+.)"
                  class="flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors cursor-pointer {artifactStore.isOpen
                    ? 'border-accent bg-accent/15 text-accent font-medium'
                    : 'border-line bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-hover'}"
                >
                  <Code size={13} />
                  <span class="hidden @[360px]:inline">Artifacts</span>
                  <span class="rounded-full bg-accent/20 px-1.5 py-0.2 font-mono text-[10px] text-accent">
                    {artifactStore.conversationArtifacts.length}
                  </span>
                </button>
              {/if}

              <button
                type="button"
                onclick={() => {
                  commandPaletteView = "commands";
                  commandPaletteOpen = true;
                }}
                aria-label="Open command palette and search"
                title="Command Palette & Search (Ctrl+K)"
                class="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg-elevated px-2 text-xs text-fg-muted hover:text-fg hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <Search size={13} />
                <kbd class="hidden @[400px]:inline font-mono text-[10px] text-fg-subtle">
                  Ctrl+K
                </kbd>
              </button>

              {#if !artifactStore.isOpen}
                <WindowControls />
              {/if}
            </div>
          </header>

          <ChatMessageList bottomPadding={inputHeight} />
          {#if !isNewChat}
            <div
              bind:clientHeight={inputHeight}
              in:fly={{ y: 50, duration: 350, opacity: 0, easing: quintOut }}
              out:fly={{ y: 50, duration: 300, opacity: 0, easing: quintOut }}
              class="absolute bottom-0 left-0 right-0 z-20 w-full"
            >
              <ChatInput />
            </div>
          {/if}
        </main>

        <!-- Artifact Side Panel (Overlay expanding from right to left) -->
        {#if artifactStore.isOpen}
          <aside
            transition:panelFly={{ duration: 300 }}
            class="absolute right-0 top-0 bottom-0 h-full overflow-hidden bg-bg transition-all duration-300 ease-in-out border-l border-line {artifactStore.isExpanded
              ? 'w-full z-40 shadow-2xl'
              : 'w-full lg:w-[48%] z-30'}"
          >
            <ArtifactPanel />
          </aside>
        {/if}
      </div>
    </div>

        {#if SettingsModalComponent}
          <SettingsModalComponent
            open={settingsOpen}
            onClose={() => (settingsOpen = false)}
          />
        {/if}
        <CommandPaletteModal
          open={commandPaletteOpen}
          initialView={commandPaletteView}
          onClose={() => (commandPaletteOpen = false)}
          onOpenSettings={() => (settingsOpen = true)}
          onToggleSidebar={() => (desktopSidebarOpen = !desktopSidebarOpen)}
        />
        <AttachmentModal />
        <ConfirmModal />

        {#if desktopWindow.isTauri && desktopWindow.activeModalCount > 0}
          <div
            data-tauri-drag-region="deep"
            class="fixed top-0 left-0 right-0 z-[100] flex h-14 items-center justify-end px-2.5"
          >
            <WindowControls standalone />
          </div>
        {/if}
      </QueryClientProvider>
    {/if}
  </div>
</div>
