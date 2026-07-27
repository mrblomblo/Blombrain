<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { fetchModels } from "../api";
  import { chatStore } from "../stores/chat.svelte";

  const modelsQuery = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    refetchInterval: 10_000,
  }));

  $effect(() => {
    const models = modelsQuery.data;
    if (models && models.length > 0 && !chatStore.selectedModel) {
      chatStore.setModel(models[0].id);
    }
  });

  // Group models by backend so the <select> reads as "backend > model".
  const grouped = $derived.by(() => {
    const models = modelsQuery.data ?? [];
    const map = new Map<string, { name: string; models: typeof models }>();
    for (const m of models) {
      const entry = map.get(m.backendId) ?? { name: m.backendName, models: [] };
      entry.models.push(m);
      map.set(m.backendId, entry);
    }
    return [...map.values()];
  });
</script>

<div class="flex items-center gap-2">
  <span
    class="h-2 w-2 shrink-0 rotate-45"
    class:bg-success={!modelsQuery.isError && (modelsQuery.data?.length ?? 0) > 0}
    class:bg-fg-subtle={modelsQuery.isLoading}
    class:bg-danger={modelsQuery.isError || (modelsQuery.data && modelsQuery.data.length === 0)}
    aria-hidden="true"
  ></span>

  {#if modelsQuery.isLoading}
    <span class="text-sm text-fg-muted">Looking for backends…</span>
  {:else if modelsQuery.isError}
    <span class="text-sm text-danger">Couldn't reach the Blombrain backend</span>
  {:else if grouped.length === 0}
    <span class="text-sm text-fg-muted"
      >No models found. Check your backend registry config.</span
    >
  {:else}
    <select
      class="h-8 rounded-md border border-line bg-bg-elevated px-2 font-mono text-xs text-fg outline-none"
      value={chatStore.selectedModel}
      onchange={(e) => chatStore.setModel(e.currentTarget.value)}
    >
      {#each grouped as group (group.name)}
        <optgroup label={group.name}>
          {#each group.models as model (model.id)}
            <option value={model.id}>{model.rawId}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  {/if}
</div>
