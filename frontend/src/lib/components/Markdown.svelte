<script lang="ts">
  import { renderMarkdown } from "../markdown";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import morphdom from "morphdom";
  import { artifactStore } from "../stores/artifact.svelte";
  import { decodeBase64 } from "../markdown";

  interface Props {
    content: string;
    class?: string;
    streaming?: boolean;
    isArtifactPreview?: boolean;
  }

  const {
    content,
    class: className = "",
    streaming = false,
    isArtifactPreview = false,
  }: Props = $props();

  let html = $derived(renderMarkdown(content, { isArtifactPreview }));

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

  /** Update container DOM incrementally using morphdom */
  $effect(() => {
    const currentHtml = html;
    if (!containerEl) return;

    const tempDiv = document.createElement("div");
    tempDiv.className = containerEl.className;
    tempDiv.innerHTML = currentHtml;

    morphdom(containerEl, tempDiv, {
      onNodeAdded: (node) => {
        if (streaming && node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          el.classList.add("fade-in-node");
        }
        return node;
      },
      onBeforeElUpdated: (fromEl, toEl) => {
        if (!streaming) return true;

        // Skip custom inline-fade text diffing inside code blocks and artifacts
        if (fromEl.closest(".code-block-wrapper, .artifact-card")) {
          return true;
        }

        // Filter out our temporary inline-fade wrapper spans when comparing structure
        const fromRealChildren = Array.from(fromEl.children).filter(
          (c) => !c.classList.contains("inline-fade"),
        );
        const toRealChildren = Array.from(toEl.children);

        // If toEl has new real child elements (like new code syntax spans, strong/em tags, li items, etc.),
        // let morphdom diff them so onNodeAdded can animate the new elements.
        if (toRealChildren.length > fromRealChildren.length) {
          return true;
        }

        // If child element structure is unchanged, check if text content grew
        if (toRealChildren.length === fromRealChildren.length) {
          const oldText = fromEl.textContent || "";
          const newText = toEl.textContent || "";

          if (newText.startsWith(oldText) && newText.length > oldText.length) {
            const addedText = newText.slice(oldText.length);
            const span = document.createElement("span");
            span.className = "inline-fade";
            span.textContent = addedText;
            fromEl.appendChild(span);

            for (const attr of Array.from(toEl.attributes)) {
              if (attr.name !== "class") {
                fromEl.setAttribute(attr.name, attr.value);
              }
            }
            return false;
          }
        }

        return true;
      },
    });
  });

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
      const sentinels = containerEl!.querySelectorAll<HTMLElement>(
        ".code-sticky-sentinel",
      );
      sentinels.forEach((sentinel) => {
        const wrapper = sentinel.closest<HTMLElement>(".code-block-wrapper");
        const header =
          wrapper?.querySelector<HTMLElement>(".code-block-header");
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

  const instanceId = Math.random().toString(36).substring(2, 9);

  $effect(() => {
    const _html = html;
    const activeId = artifactStore.activeId;
    const isOpen = artifactStore.isOpen;
    if (!containerEl) return;

    const artifactCards =
      containerEl.querySelectorAll<HTMLElement>(".artifact-card");
    artifactCards.forEach((card, index) => {
      const id =
        card.getAttribute("data-artifact-id") || `${instanceId}-${index}`;
      if (!card.hasAttribute("data-artifact-id")) {
        card.setAttribute("data-artifact-id", id);
      }

      const b64Code = card.getAttribute("data-artifact-code") || "";
      const code = b64Code ? decodeBase64(b64Code) : "";
      const lang = card.getAttribute("data-artifact-lang") || "html";
      const title = card.getAttribute("data-artifact-title") || "Artifact";

      if (streaming && !card.hasAttribute("data-auto-opened")) {
        card.setAttribute("data-auto-opened", "true");
        if (!isOpen) {
          artifactStore.openArtifact({ id, code, language: lang, title });
        }
      }

      const isActive = isOpen && activeId === id;
      if (isActive) {
        artifactStore.updateCode(id, code, lang);
      }

      // Update button text and labels reactively
      const btnTexts = card.querySelectorAll<HTMLElement>(".btn-text");
      btnTexts.forEach((span) => {
        span.textContent = isActive ? "Close Artifact" : "View Artifact";
      });

      const clickLabel = card.querySelector<HTMLElement>(
        ".artifact-click-label",
      );
      if (clickLabel) {
        clickLabel.textContent = isActive
          ? "Click to close artifact"
          : "Click to view artifact in side panel";
      }

      const mobileClickLabel = card.querySelector<HTMLElement>(
        ".artifact-mobile-click-label",
      );
      if (mobileClickLabel) {
        mobileClickLabel.textContent = isActive
          ? "Click to close artifact"
          : "Click to view artifact";
      }
    });
  });

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Handle Artifact Card Click
    const artifactCard = target.closest<HTMLElement>(".artifact-card");
    if (artifactCard) {
      e.preventDefault();
      const id = artifactCard.getAttribute("data-artifact-id") || "";
      if (artifactStore.isOpen && artifactStore.activeId === id) {
        artifactStore.close();
      } else {
        const b64Code = artifactCard.getAttribute("data-artifact-code") || "";
        const code = b64Code ? decodeBase64(b64Code) : "";
        const lang = artifactCard.getAttribute("data-artifact-lang") || "html";
        const title =
          artifactCard.getAttribute("data-artifact-title") || "Artifact";

        artifactStore.openArtifact({ id, code, language: lang, title });
      }
      return;
    }

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
></div>

<style>
  :global(.fade-in-node) {
    animation: fadeInNode 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  :global(.inline-fade) {
    display: inline;
    animation: fadeInInline 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes fadeInNode {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeInInline {
    from {
      opacity: 0;
      filter: blur(1.5px);
    }
    to {
      opacity: 1;
      filter: blur(0);
    }
  }
</style>
