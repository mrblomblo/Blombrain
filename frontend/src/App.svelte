<script lang="ts">
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import { chatStore, registerConversationsInvalidator } from "./lib/stores/chat.svelte";

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
      },
    },
  });

  // Register the invalidator so the chat store can bust the conversations cache
  // without needing to call useQueryClient() outside a Svelte component.
  registerConversationsInvalidator(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  });

  let settingsOpen = $state(false);
</script>

<QueryClientProvider client={queryClient}>
  <div class="flex h-screen w-screen bg-bg text-fg">
    <Sidebar onOpenSettings={() => (settingsOpen = true)} />

    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-line px-6 py-3">
        <h1 class="text-sm font-medium text-fg-muted">
          {chatStore.activeConversationTitle}
        </h1>
        <ModelPicker />
      </header>

      <ChatMessageList />
      <ChatInput />
    </main>
  </div>

  <SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} />
</QueryClientProvider>
