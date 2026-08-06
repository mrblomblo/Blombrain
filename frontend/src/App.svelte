<script lang="ts">
  import { onMount } from "svelte";
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import { Menu } from "@lucide/svelte";
  import { fly, fade } from "svelte/transition";
  import { quintOut, cubicOut } from "svelte/easing";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import AttachmentModal from "./lib/components/AttachmentModal.svelte";
  import ConfirmModal from "./lib/components/ConfirmModal.svelte";
  import ArtifactPanel from "./lib/components/ArtifactPanel.svelte";
  import LoginScreen from "./lib/components/LoginScreen.svelte";
  import {
    chatStore,
    registerConversationsInvalidator,
  } from "./lib/stores/chat.svelte";
  import { settingsStore } from "./lib/stores/settings.svelte";
  import { artifactStore } from "./lib/stores/artifact.svelte";
  import { authStore, checkAuth } from "./lib/stores/auth.svelte";

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
  let mobileSidebarOpen = $state(false);
  let desktopSidebarOpen = $state(true);
  let inputHeight = $state(112);

  let isNewChat = $derived(chatStore.activePath.length === 0);

  let hasInitialized = $state(false);

  onMount(() => {
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

    window.addEventListener("popstate", () => {
      const match = window.location.pathname.match(/^\/chat\/([a-zA-Z0-9-]+)$/);
      if (match) {
        chatStore.loadConversation({ id: match[1] } as any);
      } else {
        chatStore.newConversation();
      }
    });
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

{#if !authStore.initialized}
  <div
    class="flex items-center justify-center h-screen w-screen bg-bg text-fg font-medium"
  >
    Loading...
  </div>
{:else if authStore.authEnabled && !authStore.authenticated}
  <LoginScreen />
{:else}
  <QueryClientProvider client={queryClient}>
    <div class="relative flex h-dvh w-screen bg-bg text-fg overflow-hidden">
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
          class="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
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
          class="relative flex min-w-0 flex-1 flex-col h-full overflow-hidden {artifactStore.isOpen
            ? artifactStore.isExpanded
              ? 'hidden'
              : 'hidden lg:flex'
            : ''}"
        >
          <header
            class="flex items-center justify-between border-b border-line px-2.5 py-2.5 bg-bg shrink-0 z-30"
          >
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <!-- Mobile Menu -->
              <button
                type="button"
                onclick={() => (mobileSidebarOpen = true)}
                aria-label="Open menu"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted md:hidden hover:bg-bg-elevated hover:text-fg"
              >
                <Menu size={18} />
              </button>

              <!-- Model Picker taking the place of conversation title -->
              <div class="min-w-0">
                <ModelPicker />
              </div>
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

        <!-- Artifact Side Panel (Fullscreen on mobile, side panel on desktop) -->
        {#if artifactStore.isOpen}
          <aside
            transition:panelFly={{ duration: 300 }}
            class="w-full {artifactStore.isExpanded
              ? ''
              : 'lg:w-[48%]'} shrink-0 h-full overflow-hidden z-30"
          >
            <ArtifactPanel />
          </aside>
        {/if}
      </div>
    </div>

    <SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />
    <AttachmentModal />
    <ConfirmModal />
  </QueryClientProvider>
{/if}
