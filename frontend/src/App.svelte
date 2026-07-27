<script lang="ts">
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import { Menu } from "@lucide/svelte";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import {
    chatStore,
    registerConversationsInvalidator,
  } from "./lib/stores/chat.svelte";

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
    <main class="flex min-w-0 flex-1 flex-col h-full">
      <header
        class="flex items-center justify-between border-b border-line px-2.5 py-2.5 bg-bg"
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

      <ChatMessageList />
      <ChatInput />
    </main>
  </div>

  <SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />
</QueryClientProvider>
