<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor, Extension } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import Placeholder from "@tiptap/extension-placeholder";
  import Link from "@tiptap/extension-link";
  import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
  import Blockquote from "@tiptap/extension-blockquote";
  import { createLowlight, common } from "lowlight";
  import { Markdown } from "tiptap-markdown";
  import { themeStore } from "../theme.svelte";
  import githubDarkCss from "highlight.js/styles/github-dark.css?raw";
  import githubLightCss from "highlight.js/styles/github.css?raw";

  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onSubmit?: () => void;
    class?: string;
  }

  let {
    value = $bindable(""),
    placeholder = "Message Blombrain…",
    disabled = false,
    onSubmit,
    class: className = "",
  }: Props = $props();

  let element: HTMLDivElement | undefined = $state();
  let editor: Editor | null = $state(null);

  export function focus(position?: "start" | "end" | "all" | number | boolean) {
    if (editor) {
      if (position !== undefined) {
        editor.commands.focus(position);
      } else {
        editor.commands.focus();
      }
    }
  }

  const lowlight = createLowlight(common);

  // Keep a fresh reference to onSubmit for the extension keyboard handler
  let getOnSubmit = $derived(() => onSubmit);

  const CustomShortcuts = Extension.create({
    name: "customShortcuts",
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          if (editor.isActive("listItem")) {
            const selFrom = editor.state.selection.$from;
            const isItemEmpty = selFrom.parent.content.size === 0;

            if (isItemEmpty) {
              // Find depth of list item container to check if nested
              const listItemDepth = selFrom.depth - 1; // paragraph is at selFrom.depth, listItem is at depth - 1
              const listContainerDepth = listItemDepth - 1;

              if (listContainerDepth > 1) {
                // Nested list: un-indent to parent list
                editor.commands.liftListItem("listItem");
              } else {
                // Top-level list: delete the empty list item completely without creating a trailing paragraph
                editor.commands.deleteNode("listItem");
              }
              return true;
            }
            return false;
          }

          if (editor.isActive("codeBlock")) {
            return false;
          }

          const fn = getOnSubmit();
          if (fn) {
            fn();
            return true;
          }
          return false;
        },
        "Shift-Enter": ({ editor }) => {
          return editor.commands.splitBlock();
        },
      };
    },
  });

  const CustomBlockquote = Blockquote.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        alertType: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-alert-type"),
          renderHTML: (attributes) => {
            if (!attributes.alertType) return {};
            return {
              "data-alert-type": attributes.alertType,
            };
          },
        },
      };
    },
  });

  function checkAlerts(ed: Editor) {
    const { doc, tr } = ed.state;
    let modified = false;
    doc.descendants((node, pos) => {
      if (node.type.name === "blockquote") {
        const text = node.textContent.trim();
        const match = text.match(
          /^\[\!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i,
        );
        const alertType = match ? match[1].toUpperCase() : null;
        if (node.attrs.alertType !== alertType) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, alertType });
          modified = true;
        }
      }
    });
    if (modified) {
      ed.view.dispatch(tr);
    }
  }

  function unescapeHtmlEntities(str: string): string {
    return str
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  onMount(() => {
    if (!element) return;

    editor = new Editor({
      element,
      editable: !disabled,
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3],
          },
          codeBlock: false,
          blockquote: false,
        }),
        CustomBlockquote,
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: "javascript",
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            class: "text-accent underline cursor-pointer",
          },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: "is-editor-empty",
        }),
        Markdown,
        CustomShortcuts,
      ],
      editorProps: {
        handleDrop: () => true,
        handleDOMEvents: {
          dragover: () => true,
        },
      },
      content: value,
      onUpdate: ({ editor }) => {
        checkAlerts(editor);
        const rawMd =
          (editor.storage as any).markdown?.getMarkdown() ?? editor.getText();
        const md = unescapeHtmlEntities(rawMd);
        if (value !== md) {
          value = md;
        }
      },
    });

    if (editor) {
      checkAlerts(editor);
    }
  });

  onDestroy(() => {
    editor?.destroy();
  });

  // Sync external value changes to the editor (e.g. draft cleared on send)
  $effect(() => {
    if (editor) {
      const rawMd = (editor.storage as any).markdown?.getMarkdown() ?? "";
      const currentMd = unescapeHtmlEntities(rawMd);
      if (value !== currentMd) {
        editor.commands.setContent(value, { emitUpdate: false });
        checkAlerts(editor);
      }
    }
  });

  // Sync disabled prop to editor editable state
  $effect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  });
</script>

<svelte:head>
  {@html `<style id="hljs-input-theme">${themeStore.isDark ? githubDarkCss : githubLightCss}</style>`}
</svelte:head>

<div
  bind:this={element}
  class="markdown-input-editor w-full text-sm text-fg overflow-y-auto max-h-52 px-2 py-1.5 {className}"
></div>

<style>
  :global(.markdown-input-editor .ProseMirror) {
    outline: none !important;
    min-height: 1.5rem;
  }

  :global(
      .markdown-input-editor .ProseMirror p.is-editor-empty:first-child::before
    ) {
    color: var(--fg-subtle);
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }

  :global(.markdown-input-editor .ProseMirror p) {
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror p:last-child) {
    margin-bottom: 0;
  }

  :global(.markdown-input-editor .ProseMirror h1) {
    font-size: 1.25rem;
    font-weight: 700;
    margin-top: 0.5rem;
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror h2) {
    font-size: 1.1rem;
    font-weight: 600;
    margin-top: 0.375rem;
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror h3) {
    font-size: 1rem;
    font-weight: 600;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror code) {
    background-color: var(--bg-inset);
    color: var(--accent);
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.875em;
  }

  :global(.markdown-input-editor .ProseMirror pre) {
    background-color: var(--bg-inset);
    border: 1px solid var(--line);
    border-radius: 0.375rem;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.85em;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
    overflow-x: auto;
  }

  :global(.markdown-input-editor .ProseMirror pre code) {
    background-color: transparent !important;
    color: inherit !important;
    padding: 0 !important;
    font-size: inherit !important;
  }

  :global(.markdown-input-editor .ProseMirror ul) {
    list-style-type: disc;
    padding-left: 1.25rem;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror ol) {
    list-style-type: decimal;
    padding-left: 1.25rem;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
  }

  :global(.markdown-input-editor .ProseMirror blockquote) {
    border-left: 3px solid
      color-mix(in srgb, var(--line-strong) 50%, transparent);
    padding: 0.375rem 0.75rem;
    color: var(--fg-muted);
    font-style: normal;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
    background-color: color-mix(in srgb, var(--bg) 75%, transparent);
    border-radius: 0 0.375rem 0.375rem 0;
    transition: all 0.15s ease;
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="NOTE"]
    ) {
    border-left-color: var(--blue);
    background-color: color-mix(in srgb, var(--blue) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="TIP"]
    ) {
    border-left-color: var(--green);
    background-color: color-mix(in srgb, var(--green) 10%, transparent);
  }

  :global(
      .markdown-input-editor
        .ProseMirror
        blockquote[data-alert-type="IMPORTANT"]
    ) {
    border-left-color: var(--purple);
    background-color: color-mix(in srgb, var(--purple) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="WARNING"]
    ) {
    border-left-color: var(--orange);
    background-color: color-mix(in srgb, var(--orange) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="CAUTION"]
    ) {
    border-left-color: var(--red);
    background-color: color-mix(in srgb, var(--red) 10%, transparent);
  }

  :global(.ProseMirror-dropcursor),
  :global(.ProseMirror-gapcursor) {
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
  }
</style>
