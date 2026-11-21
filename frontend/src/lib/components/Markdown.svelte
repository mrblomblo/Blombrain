<script lang="ts">
  import { renderMarkdown } from "../markdown";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import morphdom from "morphdom";
  import { artifactStore } from "../stores/artifact.svelte";
  import { chatStore } from "../stores/chat.svelte";
  import { triggerCatalogStore } from "../stores/triggerCatalog.svelte";
  import { copyToClipboard } from "../utils/clipboard";
  import { decodeBase64 } from "../markdown";
  import { decorateTriggerTokensInElement } from "../utils/inputTriggers";
  import { themeStore } from "../theme.svelte";
  import { getCachedMermaidSvg, renderMermaidDiagram } from "../utils/mermaidRenderer";
  import { fetchConversationWorkspaceFile, fetchWorkspaceFileByPath } from "../api";

  interface Props {
    content: string;
    class?: string;
    streaming?: boolean;
    isArtifactPreview?: boolean;
    highlightTriggers?: boolean;
  }

  const {
    content,
    class: className = "",
    streaming = false,
    isArtifactPreview = false,
    highlightTriggers = false,
  }: Props = $props();

  let html = $derived(renderMarkdown(content, { isArtifactPreview, isStreaming: streaming }));

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
  let observer: IntersectionObserver | null = null;

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

  const instanceId = Math.random().toString(36).substring(2, 9);

  function initArtifactCard(card: HTMLElement) {
    const index = Array.from(
      containerEl!.querySelectorAll(".artifact-card"),
    ).indexOf(card);
    const id =
      card.getAttribute("data-artifact-id") || `${instanceId}-${index}`;
    if (!card.hasAttribute("data-artifact-id")) {
      card.setAttribute("data-artifact-id", id);
    }
    const isActive = artifactStore.isOpen && artifactStore.activeId === id;

    const btnTexts = card.querySelectorAll<HTMLElement>(".btn-text");
    btnTexts.forEach((span) => {
      span.textContent = isActive ? "Close Artifact" : "View Artifact";
    });

    const clickLabel = card.querySelector<HTMLElement>(".artifact-click-label");
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
  }

  /** Update container DOM incrementally using morphdom */
  $effect(() => {
    const currentHtml = html;
    const activeTheme = themeStore.current;
    const validAt = highlightTriggers ? triggerCatalogStore.validAtSet : null;
    const validSlash = highlightTriggers ? triggerCatalogStore.validSlashSet : null;
    if (!containerEl) return;

    const tempDiv = document.createElement("div");
    tempDiv.className = containerEl.className;
    tempDiv.innerHTML = currentHtml;

    // Synchronously apply any already-cached Mermaid SVGs to prevent flicker
    tempDiv.querySelectorAll<HTMLElement>(".mermaid-diagram-slot").forEach((slot) => {
      const hash = slot.getAttribute("data-mermaid-hash");
      if (!hash) return;
      const cachedSvg = getCachedMermaidSvg(hash, activeTheme);
      if (cachedSvg) {
        slot.innerHTML = cachedSvg;
        slot.setAttribute("data-rendered-hash", hash);
        slot.setAttribute("data-rendered-theme", activeTheme);
        const expandBtn = slot
          .closest(".mermaid-block-wrapper")
          ?.querySelector<HTMLElement>(".expand-mermaid-btn");
        if (expandBtn && !isArtifactPreview) {
          expandBtn.classList.remove("hidden");
          expandBtn.classList.add("flex");
        }
      }
    });

    if (highlightTriggers && validAt && validSlash) {
      decorateTriggerTokensInElement(tempDiv, validAt, validSlash);
    }

    morphdom(containerEl, tempDiv, {
      onNodeAdded: (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (streaming && !el.closest(".code-block-wrapper, .mermaid-block-wrapper")) {
            el.classList.add("fade-in-node");
          }
          // Observe any new sentinels
          if (observer) {
            if (el.classList.contains("code-sticky-sentinel")) {
              observer.observe(el);
            }
            const sentinels = el.querySelectorAll<HTMLElement>(
              ".code-sticky-sentinel",
            );
            sentinels.forEach((s) => observer!.observe(s));
          }
          // Initialize any new artifact cards
          if (el.classList.contains("artifact-card")) {
            initArtifactCard(el);
          } else if (el.querySelector?.(".artifact-card")) {
            el.querySelectorAll<HTMLElement>(".artifact-card").forEach((c) =>
              initArtifactCard(c),
            );
          }
        }
        return node;
      },
      onBeforeElUpdated: (fromEl, toEl) => {
        // Preserve already-rendered Mermaid diagram SVG when hash and theme match
        if (fromEl.classList.contains("mermaid-diagram-slot")) {
          const renderedHash = fromEl.getAttribute("data-rendered-hash");
          const renderedTheme = fromEl.getAttribute("data-rendered-theme");
          const targetHash = toEl.getAttribute("data-mermaid-hash");
          if (
            renderedHash &&
            renderedHash === targetHash &&
            renderedTheme === activeTheme &&
            fromEl.querySelector("svg")
          ) {
            return false;
          }
          // During streaming, keep the last good diagram rather than flashing "Rendering diagram..."
          if (streaming && fromEl.querySelector("svg") && !toEl.querySelector("svg")) {
            toEl.innerHTML = fromEl.innerHTML;
            if (renderedHash) toEl.setAttribute("data-rendered-hash", renderedHash);
            if (renderedTheme) toEl.setAttribute("data-rendered-theme", renderedTheme);
            return false;
          }
        }

        if (!streaming) return true;

        if (fromEl.classList.contains("mermaid-block-wrapper")) {
          const view = fromEl.getAttribute("data-view");
          if (view) toEl.setAttribute("data-view", view);
        }

        if (
          fromEl.classList.contains("mermaid-diagram-pane") ||
          fromEl.classList.contains("mermaid-source-pane") ||
          fromEl.classList.contains("mermaid-error-banner")
        ) {
          toEl.classList.toggle("hidden", fromEl.classList.contains("hidden"));
        }

        if (fromEl.classList.contains("expand-mermaid-btn")) {
          toEl.classList.toggle("hidden", fromEl.classList.contains("hidden"));
          toEl.classList.toggle("flex", fromEl.classList.contains("flex"));
        }

        if (fromEl.classList.contains("mermaid-view-btn-text")) {
          toEl.textContent = fromEl.textContent;
        }

        // Preserve dynamically toggled classes on code block headers
        if (fromEl.classList.contains("code-block-header")) {
          toEl.classList.toggle(
            "rounded-t-md",
            fromEl.classList.contains("rounded-t-md"),
          );
        }

        // Preserve dynamically toggled classes on copy/wrap/collapse buttons and bodies
        if (fromEl.classList.contains("copy-code-btn")) {
          toEl.classList.toggle(
            "text-success",
            fromEl.classList.contains("text-success"),
          );
          toEl.classList.toggle(
            "border-success/40",
            fromEl.classList.contains("border-success/40"),
          );
        }

        if (fromEl.classList.contains("code-block-wrapper")) {
          const isUnwrapped = fromEl.dataset.wrapped === "false";
          const isCollapsed = fromEl.dataset.collapsed === "true";
          if (isUnwrapped) toEl.dataset.wrapped = "false";
          if (isCollapsed) toEl.dataset.collapsed = "true";
        }

        if (fromEl.classList.contains("code-line-text")) {
          const isUnwrapped = fromEl.classList.contains("whitespace-pre");
          toEl.classList.toggle("whitespace-pre", isUnwrapped);
          toEl.classList.toggle("whitespace-pre-wrap", !isUnwrapped);
          toEl.classList.toggle("wrap-anywhere", !isUnwrapped);
        }

        if (
          fromEl.classList.contains("code-block-body") ||
          fromEl.classList.contains("code-collapsed-banner")
        ) {
          toEl.classList.toggle("hidden", fromEl.classList.contains("hidden"));
        }

        if (fromEl.classList.contains("code-header-overlay")) {
          toEl.style.inset = fromEl.style.inset;
        }

        // Preserve dynamically set text content on buttons/labels
        if (
          fromEl.classList.contains("btn-text") ||
          fromEl.classList.contains("wrap-btn-text") ||
          fromEl.classList.contains("collapse-btn-text") ||
          fromEl.classList.contains("artifact-click-label") ||
          fromEl.classList.contains("artifact-mobile-click-label")
        ) {
          toEl.textContent = fromEl.textContent;
        }

        if (fromEl.closest(".code-block-wrapper, .mermaid-block-wrapper, .artifact-card")) {
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

  /** Lazy-render Mermaid diagram blocks asynchronously (debounced while streaming) */
  $effect(() => {
    void html;
    const activeTheme = themeStore.current;
    const isCurrentlyStreaming = streaming;
    if (!containerEl) return;

    const slots = Array.from(
      containerEl.querySelectorAll<HTMLElement>(".mermaid-diagram-slot"),
    );
    if (slots.length === 0) return;

    let cancelled = false;
    const renderPending = async () => {
      for (const slot of slots) {
        if (cancelled || !slot.isConnected) return;
        const hash = slot.getAttribute("data-mermaid-hash");
        const b64 = slot.getAttribute("data-mermaid-code");
        if (!hash || !b64) continue;

        if (
          slot.getAttribute("data-rendered-hash") === hash &&
          slot.getAttribute("data-rendered-theme") === activeTheme &&
          slot.querySelector("svg")
        ) {
          continue;
        }

        const code = decodeBase64(b64).trim();
        if (!code) continue;

        const result = await renderMermaidDiagram(code, hash, activeTheme);
        if (
          cancelled ||
          !slot.isConnected ||
          slot.getAttribute("data-mermaid-hash") !== hash ||
          themeStore.current !== activeTheme
        ) {
          return;
        }

        const wrapper = slot.closest<HTMLElement>(".mermaid-block-wrapper");
        const errBanner = wrapper?.querySelector<HTMLElement>(".mermaid-error-banner");
        const expandBtn = wrapper?.querySelector<HTMLElement>(".expand-mermaid-btn");

        if ("svg" in result) {
          slot.innerHTML = result.svg;
          slot.setAttribute("data-rendered-hash", hash);
          slot.setAttribute("data-rendered-theme", activeTheme);
          if (errBanner) {
            errBanner.textContent = "";
            errBanner.classList.add("hidden");
          }
          if (expandBtn && !isArtifactPreview) {
            expandBtn.classList.remove("hidden");
            expandBtn.classList.add("flex");
          }
        } else if (!isCurrentlyStreaming) {
          slot.textContent = "Unable to render diagram";
          if (errBanner) {
            errBanner.textContent = result.error;
            errBanner.classList.remove("hidden");
          }
        }
      }
    };

    const delayMs = isCurrentlyStreaming ? 320 : 0;
    const timer = setTimeout(() => {
      void renderPending();
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  function openMermaidInPanel(wrapper: HTMLElement) {
    if (isArtifactPreview) return;
    const svgEl = wrapper.querySelector<SVGElement>(".mermaid-diagram-slot svg");
    if (!svgEl) return;
    const hash = wrapper.getAttribute("data-mermaid-hash") || "diagram";
    artifactStore.openArtifact(
      {
        id: `mermaid-${hash}`,
        filename: `diagram-${hash.slice(0, 6)}.svg`,
        code: svgEl.outerHTML,
        language: "svg",
        title: "Mermaid Diagram",
      },
      false,
    );
  }

  /**
   * Set up a single IntersectionObserver for all code block sticky headers.
   * Runs once when the container is mounted.
   */
  $effect(() => {
    if (!containerEl) return;
    const root = findScrollContainer(containerEl);
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sentinel = entry.target as HTMLElement;
          const wrapper = sentinel.closest<HTMLElement>(".code-block-wrapper");
          const header =
            wrapper?.querySelector<HTMLElement>(".code-block-header");
          if (header) {
            header.classList.toggle("rounded-t-md", entry.isIntersecting);
          }
        }
      },
      { root, threshold: 0 },
    );

    const existingSentinels = containerEl.querySelectorAll<HTMLElement>(
      ".code-sticky-sentinel",
    );
    existingSentinels.forEach((s) => observer!.observe(s));

    return () => {
      observer?.disconnect();
      observer = null;
    };
  });

  $effect(() => {
    const activeId = artifactStore.activeId;
    const isOpen = artifactStore.isOpen;
    if (!containerEl) return;

    const artifactCards =
      containerEl.querySelectorAll<HTMLElement>(".artifact-card");
    artifactCards.forEach((card) => {
      const id = card.getAttribute("data-artifact-id");
      if (!id) return;

      const isActive = isOpen && activeId === id;

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

  function openTriggerFileReference(rawName: string) {
    const targetLower = rawName.trim().toLowerCase();
    if (!targetLower) return;

    const artifact = artifactStore.conversationArtifacts.find(
      (a) => a.filename.trim().toLowerCase() === targetLower,
    );
    if (artifact) {
      void artifactStore.loadArtifact(
        artifact.id,
        artifact.conversationId,
        artifact.filename,
        artifact.title,
        artifact.language,
      );
      return;
    }

    for (const pending of chatStore.pendingAttachments) {
      if (pending.originalName.trim().toLowerCase() === targetLower) {
        chatStore.selectedAttachment = pending;
        return;
      }
    }

    const activeMsgs = chatStore.activePath;
    for (let i = activeMsgs.length - 1; i >= 0; i--) {
      const msg = activeMsgs[i];
      if (!msg.attachments) continue;
      for (const att of msg.attachments) {
        if (att.originalName.trim().toLowerCase() === targetLower) {
          chatStore.selectedAttachment = att;
          return;
        }
      }
    }

    const convId = chatStore.activeConversationId;
    const effWsPath = chatStore.effectiveWorkspacePath;
    if (effWsPath) {
      const cleaned = rawName.trim().replace(/^workspace:/i, "");
      const cleanedLower = cleaned.toLowerCase();
      const matchedRel =
        chatStore.workspaceFiles.find((p) => p.toLowerCase() === cleanedLower) ??
        chatStore.workspaceFiles.find(
          (p) => p.split("/").pop()?.toLowerCase() === cleanedLower,
        ) ??
        cleaned;

      void (async () => {
        try {
          const preview = convId
            ? await fetchConversationWorkspaceFile(convId, matchedRel)
            : await fetchWorkspaceFileByPath(effWsPath, matchedRel);
          artifactStore.openArtifact(
            {
              id: `workspace:${preview.path}`,
              filename: preview.path,
              conversationId: convId ?? undefined,
              code: preview.content,
              language: preview.language || "text",
              title: preview.path,
            },
            false,
          );
        } catch (err) {
          console.warn("[Markdown] Failed to preview workspace file:", err);
        }
      })();
    }
  }

  function handleContainerKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement | null;
    const atChip = target?.closest<HTMLElement>("[data-trigger-kind='at']");
    if (!atChip) return;
    e.preventDefault();
    openTriggerFileReference(atChip.getAttribute("data-trigger-value") || "");
  }

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Handle @ file reference chip click
    const atChip = target.closest<HTMLElement>("[data-trigger-kind='at']");
    if (atChip) {
      e.preventDefault();
      openTriggerFileReference(atChip.getAttribute("data-trigger-value") || "");
      return;
    }

    // Handle Artifact Card Click
    const artifactCard = target.closest<HTMLElement>(".artifact-card");
    if (artifactCard) {
      e.preventDefault();
      const id = artifactCard.getAttribute("data-artifact-id") || "";
      if (artifactStore.isOpen && artifactStore.activeId === id) {
        artifactStore.close();
      } else {
        const lang = artifactCard.getAttribute("data-artifact-lang") || "html";
        const title =
          artifactCard.getAttribute("data-artifact-title") || "Artifact";
        const filename =
          artifactCard.getAttribute("data-artifact-filename") || "";

        // Open the panel with empty code, then immediately fetch the latest from the server
        artifactStore.openArtifact(
          { id, filename, code: "", language: lang, title },
          false,
        );
        artifactStore.refreshArtifactContent(id);
      }
      return;
    }

    // Handle Code Block Wrap Toggle Button
    const wrapBtn = target.closest<HTMLButtonElement>(".toggle-wrap-code-btn");
    if (wrapBtn) {
      e.preventDefault();
      const wrapper = wrapBtn.closest<HTMLElement>(".code-block-wrapper");
      if (!wrapper) return;
      const currentlyWrapped = wrapper.dataset.wrapped !== "false";
      const nextWrapped = !currentlyWrapped;
      wrapper.dataset.wrapped = nextWrapped ? "true" : "false";
      wrapper.querySelectorAll<HTMLElement>(".code-line-text").forEach((span) => {
        span.classList.toggle("whitespace-pre-wrap", nextWrapped);
        span.classList.toggle("wrap-anywhere", nextWrapped);
        span.classList.toggle("whitespace-pre", !nextWrapped);
      });
      const label = wrapBtn.querySelector(".wrap-btn-text");
      if (label) label.textContent = nextWrapped ? "Scroll" : "Wrap";
      return;
    }

    // Handle Code Block Collapse Toggle Button
    const collapseBtn = target.closest<HTMLButtonElement>(".toggle-collapse-code-btn");
    if (collapseBtn) {
      e.preventDefault();
      const wrapper = collapseBtn.closest<HTMLElement>(".code-block-wrapper");
      if (!wrapper) return;
      const nextCollapsed = wrapper.dataset.collapsed !== "true";
      wrapper.dataset.collapsed = nextCollapsed ? "true" : "false";
      wrapper.querySelector(".code-block-body")?.classList.toggle("hidden", nextCollapsed);
      wrapper.querySelector(".code-collapsed-banner")?.classList.toggle("hidden", !nextCollapsed);
      const overlay = wrapper.querySelector<HTMLElement>(".code-header-overlay");
      if (overlay) {
        overlay.style.inset = nextCollapsed ? "0 0 0 0" : "0 0 4.5rem 0";
      }
      const label = collapseBtn.querySelector(".collapse-btn-text");
      if (label) label.textContent = nextCollapsed ? "Expand" : "Collapse";
      return;
    }

    // Handle Mermaid View Toggle Button (Diagram <-> Source)
    const mermaidToggleBtn = target.closest<HTMLButtonElement>(".toggle-mermaid-view-btn");
    if (mermaidToggleBtn) {
      e.preventDefault();
      const wrapper = mermaidToggleBtn.closest<HTMLElement>(".mermaid-block-wrapper");
      if (!wrapper) return;
      const showSource = wrapper.dataset.view !== "source";
      wrapper.dataset.view = showSource ? "source" : "diagram";
      wrapper.querySelector(".mermaid-diagram-pane")?.classList.toggle("hidden", showSource);
      wrapper.querySelector(".mermaid-source-pane")?.classList.toggle("hidden", !showSource);
      const label = mermaidToggleBtn.querySelector(".mermaid-view-btn-text");
      if (label) label.textContent = showSource ? "Diagram" : "Source";
      return;
    }

    // Handle Mermaid Expand Button
    const mermaidExpandBtn = target.closest<HTMLButtonElement>(".expand-mermaid-btn");
    if (mermaidExpandBtn) {
      e.preventDefault();
      const wrapper = mermaidExpandBtn.closest<HTMLElement>(".mermaid-block-wrapper");
      if (wrapper) openMermaidInPanel(wrapper);
      return;
    }

    // Handle Code Block Copy Button
    const copyBtn = target.closest<HTMLButtonElement>(".copy-code-btn");
    if (copyBtn) {
      e.preventDefault();
      const wrapper = copyBtn.closest<HTMLElement>(".code-block-wrapper, .mermaid-block-wrapper");
      let codeToCopy = "";
      if (wrapper?.dataset.code) {
        codeToCopy = decodeBase64(wrapper.dataset.code);
      } else {
        const codeEl = wrapper?.querySelector("pre code");
        if (codeEl) {
          codeToCopy = codeEl.textContent || "";
        }
      }

      if (codeToCopy) {
        copyToClipboard(codeToCopy).then((success) => {
          if (!success) return;
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
        copyToClipboard(text).then((success) => {
          if (!success) return;
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

  function handleContainerDblClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const diagramSlot = target?.closest<HTMLElement>(".mermaid-diagram-slot");
    if (!diagramSlot) return;
    const wrapper = diagramSlot.closest<HTMLElement>(".mermaid-block-wrapper");
    if (wrapper) {
      e.preventDefault();
      openMermaidInPanel(wrapper);
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
  ondblclick={handleContainerDblClick}
  onkeydown={handleContainerKeydown}
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
