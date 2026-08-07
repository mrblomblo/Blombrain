<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { fetchMcpServers, fetchSkills } from "../api";
  import { chatStore } from "../stores/chat.svelte";
  import { Server, BookOpen, Wrench, CheckSquare, Square } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import ToggleSwitch from "./ui/ToggleSwitch.svelte";

  let isOpen = $state(false);
  let wrapperEl: HTMLDivElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  const mcpQuery = createQuery(() => ({
    queryKey: ["mcpServers"],
    queryFn: fetchMcpServers,
    staleTime: 30_000,
  }));

  const skillsQuery = createQuery(() => ({
    queryKey: ["skills"],
    queryFn: fetchSkills,
    staleTime: 30_000,
  }));

  /** Globally-enabled MCP servers. */
  let enabledMcps = $derived(
    (mcpQuery.data ?? []).filter((s) => s.isEnabled),
  );

  /** Globally-enabled skills. */
  let enabledSkills = $derived(
    (skillsQuery.data ?? []).filter((s) => s.isEnabled),
  );

  /** Count of items that are active (not excluded) in this conversation. */
  let activeCount = $derived.by(() => {
    const mcpActive = enabledMcps.filter(
      (s) => !chatStore.conversationExcludedMcps.includes(s.id),
    ).length;
    const skillActive = enabledSkills.filter(
      (s) => !chatStore.conversationExcludedSkills.includes(s.id),
    ).length;
    return mcpActive + skillActive;
  });

  let totalCount = $derived(enabledMcps.length + enabledSkills.length);

  function toggleOpen() {
    isOpen = !isOpen;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (!isOpen) return;
    if (wrapperEl && e.composedPath().includes(wrapperEl)) return;
    isOpen = false;
  }
</script>

<svelte:document onclick={handleOutsideClick} />

<div bind:this={wrapperEl} class="relative">
  <!-- Trigger Button (same style as the paperclip) -->
  <div class="relative inline-flex">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <button
      onclick={toggleOpen}
      aria-label="Manage MCP servers & skills"
      title="Manage tools & skills for this conversation"
      class="inline-flex items-center justify-center rounded-md border text-fg h-8 w-8 text-xs shrink-0 p-0 transition-colors duration-200 cursor-pointer disabled:opacity-40 select-none focus-visible:border-none"
      class:border-line={!isOpen}
      class:bg-transparent={!isOpen}
      class:hover:bg-bg-hover={!isOpen}
      class:hover:border-line-strong={!isOpen}
      class:border-accent={isOpen}
      class:text-accent={isOpen}
      class:bg-accent={false}
    >
      <Wrench size={15} />
    </button>
    {#if chatStore.conversationToolsEnabled && activeCount > 0}
      <span
        class="pointer-events-none absolute -top-1.5 -right-1.5 min-w-[16px] rounded-full px-1 text-[9px] font-bold leading-none text-center flex items-center justify-center h-4 transition-colors duration-200 border bg-accent text-accent-fg border-accent"
      >{activeCount}</span>
    {/if}
  </div>

  <!-- Panel -->
  {#if isOpen}
    <div
      bind:this={panelEl}
      transition:slide={{ duration: 180, axis: "y" }}
      class="absolute bottom-full mb-2 left-0 z-50 w-72 rounded-xl border border-line bg-bg-elevated shadow-lg overflow-hidden"
    >
      <div class="px-3 py-2.5 border-b border-line flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-fg">Tools &amp; Skills</span>
          <ToggleSwitch
            id="tools-skills-enable-toggle"
            checked={chatStore.conversationToolsEnabled}
            onchange={() => chatStore.toggleToolsEnabled()}
            label="Toggle tools and skills for this conversation"
          />
        </div>
        <span class="text-[10px] text-fg-subtle">
          {#if !chatStore.conversationToolsEnabled}
            Off
          {:else}
            {activeCount} / {totalCount} active
          {/if}
        </span>
      </div>

      <div class="max-h-64 overflow-y-auto p-2 space-y-1">
        {#if !chatStore.conversationToolsEnabled}
          <div class="px-2 py-1.5 mb-1 rounded bg-bg text-[11px] text-fg-subtle italic border border-line/50 text-center">
            Tools &amp; skills disabled for this chat. Preferences preserved below.
          </div>
        {/if}
        {#if enabledMcps.length > 0}
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            MCP Servers
          </p>
          {#each enabledMcps as server (server.id)}
            {@const excluded = chatStore.conversationExcludedMcps.includes(server.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              onclick={() => chatStore.toggleExcludedMcp(server.id)}
              class="flex items-center gap-2.5 rounded-lg px-2 py-2 cursor-pointer transition-colors duration-100 select-none"
              class:hover:bg-bg-hover={!excluded}
              class:hover:bg-bg={excluded}
              class:opacity-40={excluded}
            >
              <div class="shrink-0 text-fg-subtle">
                {#if excluded}
                  <Square size={14} />
                {:else}
                  <CheckSquare size={14} class="text-accent" />
                {/if}
              </div>
              <Server size={13} class="shrink-0 text-fg-muted" />
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-fg truncate">{server.name}</p>
                <p class="text-[10px] text-fg-subtle font-mono truncate">{server.commandOrUrl}</p>
              </div>
              {#if server.status === "connected"}
                <span class="h-1.5 w-1.5 rounded-full bg-success shrink-0"></span>
              {:else if server.status === "error"}
                <span class="h-1.5 w-1.5 rounded-full bg-danger shrink-0"></span>
              {/if}
            </div>
          {/each}
        {/if}

        {#if enabledSkills.length > 0}
          {#if enabledMcps.length > 0}
            <div class="h-px bg-line mx-2 my-1"></div>
          {/if}
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Skills
          </p>
          {#each enabledSkills as skill (skill.id)}
            {@const excluded = chatStore.conversationExcludedSkills.includes(skill.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              onclick={() => chatStore.toggleExcludedSkill(skill.id)}
              class="flex items-center gap-2.5 rounded-lg px-2 py-2 cursor-pointer transition-colors duration-100 select-none"
              class:hover:bg-bg-hover={!excluded}
              class:hover:bg-bg={excluded}
              class:opacity-40={excluded}
            >
              <div class="shrink-0 text-fg-subtle">
                {#if excluded}
                  <Square size={14} />
                {:else}
                  <CheckSquare size={14} class="text-accent" />
                {/if}
              </div>
              <BookOpen size={13} class="shrink-0 text-fg-muted" />
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-fg truncate">{skill.name}</p>
                <p class="text-[10px] text-fg-subtle truncate">{skill.description}</p>
              </div>
            </div>
          {/each}
        {/if}

        {#if enabledMcps.length === 0 && enabledSkills.length === 0}
          <div class="flex flex-col items-center justify-center py-6 text-fg-subtle gap-1.5">
            <Wrench size={22} class="opacity-40" />
            <p class="text-xs text-center">No MCP servers or skills configured.<br />Add them in Settings.</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
