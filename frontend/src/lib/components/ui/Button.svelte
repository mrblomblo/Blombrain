<script module lang="ts">
  export type ButtonVariant =
    | "default"
    | "accent"
    | "danger"
    | "ghost"
    | "dark";

  export type ButtonSize = "sm" | "md" | "lg" | "icon";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  interface Props extends HTMLButtonAttributes {
    variant?: ButtonVariant;
    outline?: boolean;
    size?: ButtonSize;
    children?: Snippet;
  }

  let {
    variant = "default",
    outline = false,
    size = "md",
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none focus-visible:border-none";

  const sizes: Record<ButtonSize, string> = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-8.5 px-3 text-xs font-medium",
    lg: "h-10 px-4 text-sm",
    icon: "h-8 w-8 text-xs shrink-0 p-0",
  };

  function getVariantClasses(v: ButtonVariant, isOutline: boolean) {
    if (isOutline) {
      switch (v) {
        case "accent":
          return "border border-accent/60 text-accent bg-transparent hover:bg-accent/10 hover:border-accent";
        case "danger":
          return "border border-danger/60 text-danger bg-transparent hover:bg-danger/10 hover:border-danger";
        case "dark":
          return "border border-line text-fg bg-bg/50 hover:bg-bg hover:border-line-strong";
        case "ghost":
          return "border border-line/40 text-fg-muted bg-transparent hover:text-fg hover:bg-bg-hover";
        case "default":
        default:
          return "border border-line text-fg bg-transparent hover:bg-bg-hover hover:border-line-strong";
      }
    }

    switch (v) {
      case "accent":
        return "bg-accent text-accent-fg hover:opacity-90 active:opacity-100";
      case "danger":
        return "bg-danger text-danger-fg hover:opacity-90 active:opacity-100";
      case "dark":
        return "bg-bg text-fg border border-line hover:bg-bg-elevated hover:border-line-strong";
      case "ghost":
        return "text-fg-muted bg-transparent hover:text-fg hover:bg-bg-hover";
      case "default":
      default:
        return "bg-bg-elevated text-fg border border-line hover:bg-bg-hover hover:border-line-strong";
    }
  }

  let computedVariant = $derived(getVariantClasses(variant, outline));
</script>

<button class="{base} {sizes[size]} {computedVariant} {className}" {...rest}>
  {#if children}
    {@render children()}
  {/if}
</button>
