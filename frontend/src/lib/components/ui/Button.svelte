<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "ghost" | "outline" | "danger";

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    size?: "sm" | "md";
    children: Snippet;
  }

  let {
    variant = "outline",
    size = "md",
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed";

  const sizes: Record<string, string> = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-9 px-3.5 text-sm",
  };

  const variants: Record<Variant, string> = {
    primary:
      "bg-accent text-accent-fg hover:brightness-110 active:brightness-95",
    outline: "border border-line text-fg bg-transparent hover:bg-bg-hover",
    ghost: "text-fg-muted hover:text-fg hover:bg-bg-hover",
    danger: "bg-danger text-danger-fg hover:brightness-110",
  };
</script>

<button class="{base} {sizes[size]} {variants[variant]} {className}" {...rest}>
  {@render children()}
</button>
