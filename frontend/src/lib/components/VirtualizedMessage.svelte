<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";

  interface Props {
    children: Snippet;
  }
  const { children }: Props = $props();

  let el: HTMLDivElement;
  let isVisible = $state(true);
  let isRendered = $state(true);
  let height = $state(0);
  let observer: IntersectionObserver | null = null;

  function findScrollContainer(start: HTMLElement): HTMLElement {
    let p: HTMLElement | null = start.parentElement;
    while (p && p !== document.documentElement) {
      const { overflowY } = window.getComputedStyle(p);
      if (overflowY === "auto" || overflowY === "scroll") return p;
      p = p.parentElement;
    }
    return document.documentElement;
  }

  onMount(() => {
    if (!el) return;
    const root = findScrollContainer(el);

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!isVisible) {
              isVisible = true;
              requestAnimationFrame(() => {
                isRendered = true;
              });
            }
          } else {
            if (isVisible) {
              if (el) {
                height = el.getBoundingClientRect().height;
              }
              isVisible = false;
              isRendered = false;
            }
          }
        }
      },
      {
        root: root === document.documentElement ? null : root,
        rootMargin: "1000px 0px",
      },
    );

    observer.observe(el);
    return () => observer?.disconnect();
  });
</script>

<div
  bind:this={el}
  style="height: {isRendered ? 'auto' : height + 'px'}; overflow: {isRendered
    ? 'visible'
    : 'hidden'};"
>
  {#if isVisible}
    {@render children()}
  {/if}
</div>
