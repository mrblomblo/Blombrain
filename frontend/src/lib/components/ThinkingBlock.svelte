<script lang="ts">
  import { ChevronDown, ChevronRight, Brain } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import Markdown from "./Markdown.svelte";

  interface Props {
    thinkingContent?: string;
    thinkingDone?: boolean;
    streaming?: boolean;
    hasMainContent?: boolean;
    status?: string | null;
    routerOutput?: string;
    isRouter?: boolean;
  }
  const {
    thinkingContent,
    thinkingDone,
    streaming,
    hasMainContent = true,
    status = null,
    routerOutput,
    isRouter = false,
  }: Props = $props();

  let isOpen = $state(false);
  let userInteracted = $state(false);

  function formatToolName(name: string): string {
    if (!name) return "";
    const parts = name.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : name;
  }

  let parsedRouterInfo = $derived.by(() => {
    if (!routerOutput) return null;
    
    let text = routerOutput;
    let tools: string[] = [];
    let skills: string[] = [];
    let hasValidJson = false;
    
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (Array.isArray(parsed.tools)) tools = parsed.tools.map(String);
        if (Array.isArray(parsed.skills)) skills = parsed.skills.map(String);
        text = text.replace(codeBlockMatch[0], "").trim();
        hasValidJson = true;
      } catch (e) {}
    } else {
      const rawJsonMatch = text.match(/\{[\s\S]*\}/);
      if (rawJsonMatch) {
        try {
          const parsed = JSON.parse(rawJsonMatch[0]);
          if (Array.isArray(parsed.tools)) tools = parsed.tools.map(String);
          if (Array.isArray(parsed.skills)) skills = parsed.skills.map(String);
          text = text.replace(rawJsonMatch[0], "").trim();
          hasValidJson = true;
        } catch (e) {}
      }
    }

    if (!hasValidJson) {
      const openCodeBlock = text.match(/```[\s\S]*$/);
      if (openCodeBlock) {
         text = text.replace(openCodeBlock[0], "").trim();
      } else {
         const afterThink = text.lastIndexOf("</think>");
         if (afterThink !== -1) {
            const remainder = text.slice(afterThink + 8).trimStart();
            if (remainder.startsWith("{")) {
                text = text.slice(0, afterThink + 8).trim();
            }
         } else if (text.trimStart().startsWith("{")) {
            text = "";
         }
      }
    }
    
    text = text.replace(/<\/?think>/gi, "").trim();
    return { text, tools, skills, hasValidJson };
  });

  $effect(() => {
    if (status === "routing") {
      if (!userInteracted) isOpen = true;
      return;
    }
    if (isRouter) {
      if (!userInteracted) isOpen = false;
      return;
    }
    if (streaming && !thinkingDone) {
      if (!userInteracted) isOpen = true;
      return;
    } else if (thinkingDone && streaming) {
      if (!userInteracted && isOpen) {
        isOpen = false;
      }
    } else if (!streaming && (thinkingDone === false || !hasMainContent)) {
      if (!userInteracted) isOpen = true;
    }
  });

  function toggleOpen() {
    userInteracted = true;
    isOpen = !isOpen;
  }
</script>

{#if status === "routing" || isRouter || thinkingContent !== undefined}
  <div class="mb-2 text-xs">
    <button
      type="button"
      onclick={toggleOpen}
      class="flex w-full items-center gap-1 text-fg-muted transition-colors hover:text-fg font-medium"
    >
      <ChevronRight
        size={14}
        class="shrink-0 transition-transform duration-200 {isOpen ? 'rotate-90' : ''}"
      />
      <div class="flex items-center gap-1.5">
        <Brain
          size={13}
          class={status === "routing" || (streaming && !thinkingDone)
            ? "animate-pulse text-accent"
            : "text-fg-subtle"}
        />
        <span>
          {#if status === "routing"}
            Selecting tools & skills...
          {:else if isRouter}
            Selected tools & skills
          {:else if streaming && !thinkingDone}
            Thinking
          {:else}
            Thought process{#if thinkingDone === false} (interrupted){/if}
          {/if}
        </span>
      </div>
    </button>

    {#if !isOpen && (status === "routing" || isRouter) && parsedRouterInfo && (parsedRouterInfo.tools.length > 0 || parsedRouterInfo.skills.length > 0)}
      <div class="mt-1.5 pl-5 flex flex-wrap items-center gap-1.5">
        {#each parsedRouterInfo.tools as tool}
          <span class="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent border border-accent/20">
            {formatToolName(tool)}
          </span>
        {/each}
        {#each parsedRouterInfo.skills as skill}
          <span class="inline-flex items-center rounded bg-important/10 px-1.5 py-0.5 text-[10px] font-medium text-important border border-important/20">
            {skill}
          </span>
        {/each}
      </div>
    {/if}

    {#if isOpen}
      <div
        transition:slide={{ duration: 200 }}
        class="mt-1.5 pl-4 text-[11px] leading-relaxed text-fg-muted opacity-90 border-l-2 border-line/50 ml-1.5 py-1"
      >
        {#if status === "routing" || isRouter}
          {#if parsedRouterInfo}
            {#if parsedRouterInfo.text}
              <Markdown content={parsedRouterInfo.text} streaming={status === "routing"} class="text-[11px]" />
            {/if}
            {#if parsedRouterInfo.tools.length > 0 || parsedRouterInfo.skills.length > 0}
              <div class="mt-2 flex flex-col gap-1.5">
                {#if parsedRouterInfo.tools.length > 0}
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-fg-muted font-medium uppercase tracking-wider">Tools:</span>
                    <div class="flex flex-wrap gap-1">
                      {#each parsedRouterInfo.tools as tool}
                        <span class="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent border border-accent/20">
                          {formatToolName(tool)}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if parsedRouterInfo.skills.length > 0}
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-fg-muted font-medium uppercase tracking-wider">Skills:</span>
                    <div class="flex flex-wrap gap-1">
                      {#each parsedRouterInfo.skills as skill}
                        <span class="inline-flex items-center rounded bg-important/10 px-1.5 py-0.5 text-[10px] font-medium text-important border border-important/20">
                          {skill}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {:else if parsedRouterInfo.hasValidJson || status !== "routing"}
              <div class="mt-1 italic text-fg-subtle text-[10px]">No tools or skills selected.</div>
            {/if}
          {:else}
            <div class="italic text-fg-subtle">Evaluating tools and skills catalog...</div>
          {/if}
        {:else}
          <Markdown content={thinkingContent ?? ""} streaming={streaming && !thinkingDone} class="text-[11px]" />
        {/if}
      </div>
    {/if}
  </div>
{/if}

