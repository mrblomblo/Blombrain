<script lang="ts">
  import { ChevronDown, Check } from "@lucide/svelte";
  import { fly } from "svelte/transition";

  export interface DropdownOption {
    label: string;
    value: string;
  }

  interface Props {
    value?: string;
    options: DropdownOption[];
    placeholder?: string;
    disabled?: boolean;
    onchange?: (value: string) => void;
    id?: string;
    class?: string;
    buttonClass?: string;
  }

  let {
    value = $bindable(undefined),
    options,
    placeholder = "Select option",
    disabled = false,
    onchange,
    id,
    class: className = "",
    buttonClass = "",
  }: Props = $props();

  let isOpen = $state(false);

  let selectedOption = $derived(options.find((o) => o.value === value));

  const componentId = Math.random().toString(36).substring(2, 9);

  function handleSelect(val: string) {
    value = val;
    isOpen = false;
    onchange?.(val);
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(`.dropdown-${componentId}`)) {
      isOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") isOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="relative inline-block w-full dropdown-{componentId}">
  <button
    {id}
    type="button"
    {disabled}
    onclick={() => (isOpen = !isOpen)}
    class="flex w-full items-center justify-between gap-2 rounded-md border border-line text-xs text-fg transition-colors hover:border-line-strong hover:bg-bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed {buttonClass || 'h-8 bg-bg px-3'} {className}"
  >
    <span class="truncate">{selectedOption?.label || placeholder}</span>
    <ChevronDown size={13} class="text-fg-subtle shrink-0 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}" />
  </button>

  {#if isOpen}
    <div
      transition:fly={{ y: -4, duration: 150 }}
      class="absolute left-0 top-full z-50 mt-1 w-full min-w-[160px] rounded-lg border border-line bg-bg shadow-xl overflow-hidden"
    >
      <div class="max-h-56 overflow-y-auto p-1 space-y-0.5">
        {#each options as option (option.value)}
          <button
            type="button"
            onclick={() => handleSelect(option.value)}
            class="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors {value === option.value ? 'bg-accent/15 text-accent font-medium' : 'hover:bg-bg-elevated text-fg'}"
          >
            <span class="truncate">{option.label}</span>
            {#if value === option.value}
              <Check size={13} class="text-accent shrink-0" />
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
