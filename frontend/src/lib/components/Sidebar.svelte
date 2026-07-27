<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { fetchBackends } from "../api";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";

  const backendsQuery = createQuery(() => ({
    queryKey: ["backends"],
    queryFn: fetchBackends,
    refetchInterval: 10_000,
  }));
</script>

<aside class="flex w-64 shrink-0 flex-col border-r border-line bg-bg-inset">
  <div class="flex items-center gap-2 px-4 py-4">
    <div class="h-3.5 w-3.5 rotate-45 bg-accent"></div>
    <span class="text-sm font-semibold tracking-wide">Blombrain</span>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-2">
    <p class="mb-2 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      Conversations
    </p>
    <p class="rounded-md border border-dashed border-line px-3 py-3 text-xs text-fg-muted">
      History &amp; persistence land in the next build pass (SQLite-backed
      conversations). For now every reload starts fresh.
    </p>

    <p class="mt-6 mb-2 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      Backends
    </p>
    {#if backendsQuery.isLoading}
      <p class="text-xs text-fg-muted">Loading…</p>
    {:else if backendsQuery.isError}
      <p class="text-xs text-danger">Can't reach the backend API.</p>
    {:else}
      <ul class="flex flex-col gap-1.5">
        {#each backendsQuery.data ?? [] as backend (backend.id)}
          <li class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              class:bg-success={backend.status === "online"}
              class:bg-danger={backend.status === "offline"}
              class:bg-fg-subtle={backend.status === "unknown"}
              aria-hidden="true"
            ></span>
            <span class="flex-1 truncate text-fg">{backend.name}</span>
            <span class="shrink-0 font-mono text-[10px] text-fg-subtle">{backend.prefix}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex items-center justify-between border-t border-line px-4 py-3">
    <span class="text-xs text-fg-muted">Theme</span>
    <ThemeSwitcher />
  </div>
</aside>
