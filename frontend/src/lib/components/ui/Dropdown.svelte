<script lang="ts">
  import { ChevronDown, Check } from "@lucide/svelte";
  import { fly } from "svelte/transition";

  export interface DropdownOption {
    label: string;
    value: string;
    icon?: any;
    iconClass?: string;
  }

  interface Props {
    value?: string;
    isOpen?: boolean;
    options: DropdownOption[];
    placeholder?: string;
    disabled?: boolean;
    onchange?: (value: string) => void;
    onopenchange?: (isOpen: boolean) => void;
    id?: string;
    class?: string;
    buttonClass?: string;
    trigger?: import("svelte").Snippet;
    unstyledTrigger?: boolean;
    align?: "left" | "right";
    resetOnSelect?: boolean;
    showCheckmark?: boolean;
    ariaLabel?: string;
  }

  let {
    value = $bindable(undefined),
    isOpen = $bindable(false),
    options,
    placeholder = "Select option",
    disabled = false,
    onchange,
    onopenchange,
    id,
    class: className = "",
    buttonClass = "",
    trigger,
    unstyledTrigger = false,
    align = "left",
    resetOnSelect = false,
    showCheckmark = true,
    ariaLabel,
  }: Props = $props();

  let highlightedIndex = $state(-1);

  $effect(() => {
    onopenchange?.(isOpen);
    if (isOpen) {
      const idx = options.findIndex((o) => o.value === value);
      highlightedIndex = idx >= 0 ? idx : 0;
    } else {
      highlightedIndex = -1;
    }
  });

  let selectedOption = $derived(options.find((o) => o.value === value));

  const componentId = Math.random().toString(36).substring(2, 9);

  function handleSelect(val: string) {
    if (resetOnSelect) {
      value = undefined;
    } else {
      value = val;
    }
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
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      isOpen = false;
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (options.length > 0) {
        highlightedIndex = (highlightedIndex + 1) % options.length;
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length > 0) {
        highlightedIndex =
          (highlightedIndex - 1 + options.length) % options.length;
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      if (options.length > 0) highlightedIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      if (options.length > 0) highlightedIndex = options.length - 1;
    } else if (e.key === "Enter" && highlightedIndex >= 0 && highlightedIndex < options.length) {
      e.preventDefault();
      handleSelect(options[highlightedIndex].value);
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="relative inline-block w-full dropdown-{componentId}">
  <button
    {id}
    type="button"
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-label={ariaLabel}
    onclick={() => (isOpen = !isOpen)}
    class={unstyledTrigger
      ? `${buttonClass || ""} ${className || ""}`
      : `flex w-full items-center justify-between gap-2 rounded-md border border-line text-xs text-fg transition-colors cursor-pointer hover:border-line-strong hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed ${buttonClass || "h-8 bg-bg px-3"} ${className}`}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <span class="truncate">{selectedOption?.label || placeholder}</span>
      <ChevronDown
        size={13}
        class="text-fg-subtle shrink-0 transition-transform duration-200 {isOpen
          ? 'rotate-180'
          : ''}"
      />
    {/if}
  </button>

  {#if isOpen}
    <div
      transition:fly={{ y: -4, duration: 150 }}
      class="absolute {align === 'right'
        ? 'right-0'
        : 'left-0'} top-full z-50 mt-1 w-full min-w-40 rounded-lg border border-line bg-bg shadow-xl overflow-hidden"
    >
      <div
        role="listbox"
        aria-label={ariaLabel || placeholder}
        class="max-h-56 overflow-y-auto p-1 space-y-0.5"
      >
        {#each options as option, idx (option.value)}
          {@const isSelected = !resetOnSelect && value === option.value}
          {@const isHighlighted = idx === highlightedIndex}
          <button
            type="button"
            role="option"
            aria-selected={isSelected}
            onmouseenter={() => (highlightedIndex = idx)}
            onclick={() => handleSelect(option.value)}
            class="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer {isSelected
              ? 'bg-accent/15 text-accent font-medium hover:bg-accent/20'
              : isHighlighted
                ? 'bg-bg-hover text-fg'
                : 'hover:bg-bg-hover text-fg'}"
          >
            <div class="flex items-center gap-2 min-w-0">
              {#if option.icon}
                {@const Icon = option.icon}
                <Icon
                  size={13}
                  class="shrink-0 {option.iconClass || 'text-fg-subtle'}"
                />
              {/if}
              <span class="truncate">{option.label}</span>
            </div>
            {#if showCheckmark && isSelected}
              <Check size={13} class="text-accent shrink-0" />
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
