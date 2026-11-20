<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { Editor, Extension } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import Placeholder from "@tiptap/extension-placeholder";
  import Link from "@tiptap/extension-link";
  import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
  import Blockquote from "@tiptap/extension-blockquote";
  import { createLowlight, common } from "lowlight";
  import { Markdown } from "tiptap-markdown";
  import { Plugin, PluginKey } from "@tiptap/pm/state";
  import { Decoration, DecorationSet } from "@tiptap/pm/view";
  import {
    detectInputTrigger,
    findValidPrefixMatchesInText,
    type ActiveInputTrigger,
  } from "../utils/inputTriggers";

  export type EditorTriggerState = ActiveInputTrigger & {
    from: number;
    to: number;
  };

  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    disableSubmit?: boolean;
    onSubmit?: () => void;
    onPasteFiles?: (files: File[]) => void;
    onTriggerChange?: (trigger: EditorTriggerState | null) => void;
    onTriggerKeydown?: (key: string) => boolean;
    validAtNames?: string[];
    validSlashNames?: string[];
    class?: string;
  }

  let {
    value = $bindable(""),
    placeholder = "Message Blombrain…",
    disabled = false,
    disableSubmit = false,
    onSubmit,
    onPasteFiles,
    onTriggerChange,
    onTriggerKeydown,
    validAtNames = [],
    validSlashNames = [],
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

  export function replaceRange(from: number, to: number, text: string) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, text)
      .run();
    updateTriggerState(editor);
  }

  const lowlight = createLowlight(common);

  // Keep a fresh reference to callbacks/flags for editor handlers
  let getOnSubmit = $derived(() => onSubmit);
  let getDisableSubmit = $derived(() => disableSubmit);
  let getOnPasteFiles = $derived(() => onPasteFiles);
  let getOnTriggerChange = $derived(() => onTriggerChange);
  let getOnTriggerKeydown = $derived(() => onTriggerKeydown);

  const tokenHighlightPluginKey = new PluginKey("tokenHighlight");
  let validAtSet = new Set<string>();
  let validSlashSet = new Set<string>();

  function buildTokenDecorations(doc: any): DecorationSet {
    if (validAtSet.size === 0 && validSlashSet.size === 0) {
      return DecorationSet.empty;
    }
    const decos: Decoration[] = [];
    doc.descendants((node: any, pos: number) => {
      if (node.type?.name === "codeBlock") return false;
      if (!node.isTextblock) return true;

      let text = "";
      const charPositions: number[] = [];
      node.forEach((child: any, offsetInBlock: number) => {
        if (child.isText && child.text) {
          for (let i = 0; i < child.text.length; i++) {
            text += child.text[i];
            charPositions.push(pos + 1 + offsetInBlock + i);
          }
        } else {
          text += "\n";
          charPositions.push(pos + 1 + offsetInBlock);
        }
      });

      for (const m of findValidPrefixMatchesInText(text, "@", validAtSet)) {
        const from = charPositions[m.start];
        const toChar = charPositions[m.end - 1];
        if (from !== undefined && toChar !== undefined) {
          decos.push(
            Decoration.inline(from, toChar + 1, {
              class: "input-mention-chip input-mention-at",
              title: "Session file",
            }),
          );
        }
      }

      for (const m of findValidPrefixMatchesInText(text, "/", validSlashSet)) {
        const from = charPositions[m.start];
        const toChar = charPositions[m.end - 1];
        if (from !== undefined && toChar !== undefined) {
          decos.push(
            Decoration.inline(from, toChar + 1, {
              class: "input-mention-chip input-mention-slash",
              title: "Injected tool, skill, or MCP",
            }),
          );
        }
      }
      return false;
    });
    return DecorationSet.create(doc, decos);
  }

  const TokenHighlight = Extension.create({
    name: "tokenHighlight",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: tokenHighlightPluginKey,
          state: {
            init: (_config, state) => buildTokenDecorations(state.doc),
            apply: (tr, prev, _oldState, newState) => {
              if (tr.docChanged || tr.getMeta(tokenHighlightPluginKey)) {
                return buildTokenDecorations(newState.doc);
              }
              return prev;
            },
          },
          props: {
            decorations: (state) => tokenHighlightPluginKey.getState(state),
          },
        }),
      ];
    },
  });

  // True while the component itself is pushing content into the editor, so the
  // resulting selection/update events do not feed back into trigger state.
  let suppressTriggerEvents = false;

  function emitTrigger(trigger: EditorTriggerState | null) {
    const cb = untrack(() => getOnTriggerChange());
    if (!cb) return;
    // Never let parent state writes become dependencies of whatever effect we may be in.
    untrack(() => cb(trigger));
  }

  function updateTriggerState(ed: Editor) {
    if (suppressTriggerEvents) return;
    const cb = emitTrigger;
    const { selection } = ed.state;
    const { from, empty } = selection;
    const resolvedFrom = selection.$from;
    if (!empty || !resolvedFrom.parent.isTextblock) {
      cb(null);
      return;
    }
    const textBefore = resolvedFrom.parent.textBetween(0, resolvedFrom.parentOffset, "\n", "\n");
    const detected = detectInputTrigger(textBefore);
    if (!detected) {
      cb(null);
      return;
    }
    cb({
      ...detected,
      from: Math.max(0, from - detected.matchLength),
      to: from,
    });
  }

  const CustomShortcuts = Extension.create({
    name: "customShortcuts",
    addKeyboardShortcuts() {
      return {
        ArrowUp: ({ editor }) => {
          if (editor.view.composing) return false;
          return Boolean(getOnTriggerKeydown()?.("ArrowUp"));
        },
        ArrowDown: ({ editor }) => {
          if (editor.view.composing) return false;
          return Boolean(getOnTriggerKeydown()?.("ArrowDown"));
        },
        Tab: ({ editor }) => {
          if (editor.view.composing) return false;
          return Boolean(getOnTriggerKeydown()?.("Tab"));
        },
        Escape: ({ editor }) => {
          if (editor.view.composing) return false;
          return Boolean(getOnTriggerKeydown()?.("Escape"));
        },
        Enter: ({ editor }) => {
          if (editor.view.composing) {
            return false;
          }
          if (getOnTriggerKeydown()?.("Enter")) {
            return true;
          }
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

          if (!getDisableSubmit()) {
            const fn = getOnSubmit();
            if (fn) {
              fn();
              return true;
            }
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
          link: false,
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
        TokenHighlight,
      ],
      editorProps: {
        handleDrop: () => true,
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            const fn = getOnPasteFiles();
            if (fn) {
              fn(Array.from(files));
              return true;
            }
          }
          return false;
        },
        handleDOMEvents: {
          dragover: () => true,
        },
      },
      content: value,
      onUpdate: ({ editor }) => {
        if (suppressTriggerEvents) return;
        checkAlerts(editor);
        const rawMd =
          (editor.storage as any).markdown?.getMarkdown() ?? editor.getText();
        const md = unescapeHtmlEntities(rawMd);
        if (value !== md) {
          value = md;
        }
        updateTriggerState(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        updateTriggerState(editor);
      },
      onBlur: () => {
        emitTrigger(null);
      },
      onFocus: ({ editor }) => {
        updateTriggerState(editor);
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
    const incoming = value;
    const ed = editor;
    if (!ed) return;
    untrack(() => {
      const rawMd = (ed.storage as any).markdown?.getMarkdown() ?? "";
      const currentMd = unescapeHtmlEntities(rawMd);
      if (incoming !== currentMd) {
        suppressTriggerEvents = true;
        try {
          ed.commands.setContent(incoming, { emitUpdate: false });
          checkAlerts(ed);
        } finally {
          suppressTriggerEvents = false;
        }
        if (ed.isFocused) {
          updateTriggerState(ed);
        } else {
          emitTrigger(null);
        }
      }
    });
  });

  // Sync disabled prop to editor editable state
  $effect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  });

  // Refresh inline @ and / token decorations whenever valid file/tool catalogs change
  $effect(() => {
    const nextAt = new Set(validAtNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
    const nextSlash = new Set(validSlashNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
    validAtSet = nextAt;
    validSlashSet = nextSlash;
    const ed = editor;
    if (ed) {
      untrack(() => {
        ed.view.dispatch(ed.state.tr.setMeta(tokenHighlightPluginKey, true));
      });
    }
  });

  function handleContainerMousedown(e: MouseEvent) {
    if (disabled || !editor) return;
    const target = e.target as HTMLElement | null;
    if (target === element || target?.classList.contains("markdown-input-editor")) {
      e.preventDefault();
      editor.commands.focus();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={element}
  onmousedown={handleContainerMousedown}
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
    border-left-color: var(--info);
    background-color: color-mix(in srgb, var(--info) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="TIP"]
    ) {
    border-left-color: var(--success);
    background-color: color-mix(in srgb, var(--success) 10%, transparent);
  }

  :global(
      .markdown-input-editor
        .ProseMirror
        blockquote[data-alert-type="IMPORTANT"]
    ) {
    border-left-color: var(--important);
    background-color: color-mix(in srgb, var(--important) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="WARNING"]
    ) {
    border-left-color: var(--warning);
    background-color: color-mix(in srgb, var(--warning) 10%, transparent);
  }

  :global(
      .markdown-input-editor .ProseMirror blockquote[data-alert-type="CAUTION"]
    ) {
    border-left-color: var(--danger);
    background-color: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  :global(.ProseMirror-dropcursor),
  :global(.ProseMirror-gapcursor) {
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
  }
</style>
