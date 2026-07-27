<script lang="ts">
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import ChatInput from "./lib/components/ChatInput.svelte";
  import ChatMessageList from "./lib/components/ChatMessageList.svelte";
  import ModelPicker from "./lib/components/ModelPicker.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5_000,
      },
    },
  });
</script>

<QueryClientProvider client={queryClient}>
  <div class="flex h-screen w-screen bg-bg text-fg">
    <Sidebar />

    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-line px-6 py-3">
        <h1 class="text-sm font-medium text-fg-muted">New conversation</h1>
        <ModelPicker />
      </header>

      <ChatMessageList />
      <ChatInput />
    </main>
  </div>
</QueryClientProvider>
