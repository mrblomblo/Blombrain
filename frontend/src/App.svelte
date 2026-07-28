<script lang="ts">
  import { onMount } from "svelte";
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import { Menu } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import AttachmentModal from "./lib/components/AttachmentModal.svelte";
  import ConfirmModal from "./lib/components/ConfirmModal.svelte";
  import {
    chatStore,
    registerConversationsInvalidator,
  } from "./lib/stores/chat.svelte";
  import { settingsStore } from "./lib/stores/settings.svelte";

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
    const match = window.location.pathname.match(/^\/chat\/([a-zA-Z0-9-]+)$/);
    if (match) {
      const uuid = match[1];
      chatStore.loadConversation({ id: uuid } as any).finally(() => {
        hasInitialized = true;
      });
    } else {
      hasInitialized = true;
    }

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
</script>

<QueryClientProvider client={queryClient}>
  <div class="relative flex h-screen w-screen bg-bg text-fg overflow-hidden">
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
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
        onclick={() => (mobileSidebarOpen = false)}
      ></div>
      <div
        class="fixed inset-y-0 left-0 z-50 w-64 md:hidden shadow-2xl animate-in slide-in-from-left duration-200"
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

    <!-- Main Content Pane -->
    <main class="relative flex min-w-0 flex-1 flex-col h-full overflow-hidden">
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
  </div>

  <SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />
  <AttachmentModal />
  <ConfirmModal />
</QueryClientProvider>
