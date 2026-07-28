<script lang="ts">
  import { renderMarkdown } from "../markdown";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  interface Props {
    content: string;
    class?: string;
  }

  const { content, class: className = "" }: Props = $props();

  let html = $derived(renderMarkdown(content));

  // Tooltip state for inline code snippets
  let tooltip = $state<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    copied: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    text: "Copy",
    copied: false,
  });

  let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  let activeInlineCodeEl: HTMLElement | null = null;
  let containerEl: HTMLDivElement | undefined = $state();

  /** Walk up the DOM to find the nearest scrollable ancestor. */
  function findScrollContainer(start: HTMLElement): Element | null {
    let p: HTMLElement | null = start.parentElement;
    while (p && p !== document.documentElement) {
      const { overflowY } = window.getComputedStyle(p);
      if (overflowY === "auto" || overflowY === "scroll") return p;
      p = p.parentElement;
    }
    return null;
  }

  /**
   * After the HTML content renders, set up IntersectionObservers for each
   * code block. Each observer watches a 1px sentinel element placed just
   * before the sticky header. When the sentinel scrolls out of the scroll
   * container, the header is "stuck" and we remove its rounded-t-md class
   * so it appears flat against the viewport edge. When the sentinel is
   * visible again, the header is back at rest and we restore the rounding.
   */
  $effect(() => {
    // Track html so the effect re-runs whenever content changes.
    const _html = html;
    if (!containerEl) return;

    const observers: IntersectionObserver[] = [];
    const root = findScrollContainer(containerEl);

    const setup = () => {
      const sentinels = containerEl!.querySelectorAll<HTMLElement>(".code-sticky-sentinel");
      sentinels.forEach((sentinel) => {
        const wrapper = sentinel.closest<HTMLElement>(".code-block-wrapper");
        const header = wrapper?.querySelector<HTMLElement>(".code-block-header");
        if (!header) return;

        const observer = new IntersectionObserver(
          ([entry]) => {
            // Sentinel visible = header at rest = round top corners.
            // Sentinel hidden  = header stuck   = flat top.
            header.classList.toggle("rounded-t-md", entry.isIntersecting);
          },
          { root, threshold: 0 },
        );
        observer.observe(sentinel);
        observers.push(observer);
      });
    };

    const raf = requestAnimationFrame(setup);
    return () => {
      cancelAnimationFrame(raf);
      observers.forEach((o) => o.disconnect());
    };
  });

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Handle Code Block Copy Button
    const copyBtn = target.closest<HTMLButtonElement>(".copy-code-btn");
    if (copyBtn) {
      e.preventDefault();
      const wrapper = copyBtn.closest(".code-block-wrapper");
      const codeEl = wrapper?.querySelector("pre code");
      if (codeEl && codeEl.textContent) {
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
          const copyIcon = copyBtn.querySelector(".copy-icon");
          const checkIcon = copyBtn.querySelector(".check-icon");
          const btnText = copyBtn.querySelector(".btn-text");

          copyIcon?.classList.add("hidden");
          checkIcon?.classList.remove("hidden");
          if (btnText) btnText.textContent = "Copied!";
          copyBtn.classList.add("text-success", "border-success/40");

          setTimeout(() => {
            copyIcon?.classList.remove("hidden");
            checkIcon?.classList.add("hidden");
            if (btnText) btnText.textContent = "Copy";
            copyBtn.classList.remove("text-success", "border-success/40");
          }, 2000);
        });
      }
      return;
    }

    // Handle Inline Code Click
    const inlineCode = target.closest<HTMLElement>(".inline-code");
    if (inlineCode) {
      e.preventDefault();
      const text = inlineCode.textContent || "";
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          tooltip.text = "Copied!";
          tooltip.copied = true;
          updateTooltipPosition(inlineCode);

          if (tooltipTimer) clearTimeout(tooltipTimer);
          tooltipTimer = setTimeout(() => {
            tooltip.text = "Copy";
            tooltip.copied = false;
            if (activeInlineCodeEl !== inlineCode) {
              tooltip.visible = false;
            }
          }, 1500);
        });
      }
    }
  }

  function handleContainerMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const inlineCode = target.closest<HTMLElement>(".inline-code");

    if (inlineCode) {
      activeInlineCodeEl = inlineCode;
      updateTooltipPosition(inlineCode);
      tooltip.visible = true;
    }
  }

  function handleContainerMouseOut(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const inlineCode = target.closest<HTMLElement>(".inline-code");

    if (inlineCode && !inlineCode.contains(e.relatedTarget as Node)) {
      activeInlineCodeEl = null;
      if (!tooltip.copied) {
        tooltip.visible = false;
      }
    }
  }

  function updateTooltipPosition(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    tooltip.x = rect.left + rect.width / 2;
    tooltip.y = rect.top - 8;
  }
</script>

<!-- Floating Dynamic Tooltip for Inline Code -->
{#if tooltip.visible}
  <div
    class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full"
    style="left: {tooltip.x}px; top: {tooltip.y}px;"
    transition:fly={{ y: 6, duration: 140, easing: cubicOut }}
  >
    <div
      class="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono font-medium shadow-md transition-colors {tooltip.copied
        ? 'border-success bg-bg-elevated text-success'
        : 'border-line bg-bg-elevated text-fg'}"
    >
      <span>{tooltip.text}</span>
    </div>
  </div>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
  bind:this={containerEl}
  class="prose max-w-none text-fg leading-relaxed text-sm {className}"
  onclick={handleContainerClick}
  onmouseover={handleContainerMouseOver}
  onmouseout={handleContainerMouseOut}
>
  {@html html}
</div>
