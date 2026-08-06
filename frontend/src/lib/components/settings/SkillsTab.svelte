<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import {
    fetchSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    importSkill,
    uploadSkillFiles,
  } from "../../api";
  import type { SkillInfo, SkillWriteBody } from "../../types";
  import Button from "../ui/Button.svelte";
  import {
    Plus,
    Trash2,
    BookOpen,
    Eye,
    ShieldCheck,
    RefreshCw,
    FolderPlus,
    UploadCloud,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  const queryClient = useQueryClient();

  const skillsQuery = createQuery(() => ({
    queryKey: ["skills"],
    queryFn: fetchSkills,
  }));

  let activeMode = $state<"list" | "import" | "manual">("list");
  let previewSkill = $state<SkillInfo | null>(null);
  let editingId = $state<string | null>(null);

  let isDragging = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let showManualPathInput = $state(false);
  let importPath = $state("");

  let name = $state("");
  let description = $state("");
  let instructions = $state("");
  let dirPath = $state("");
  let sourceUrl = $state("");

  let formError = $state<string | null>(null);
  let formBusy = $state(false);

  function resetForm() {
    activeMode = "list";
    editingId = null;
    isDragging = false;
    showManualPathInput = false;
    importPath = "";
    name = "";
    description = "";
    instructions = "";
    dirPath = "";
    sourceUrl = "";
    formError = null;
    formBusy = false;
  }

  function startEdit(skill: SkillInfo) {
    editingId = skill.id;
    name = skill.name;
    description = skill.description;
    instructions = skill.instructions;
    dirPath = skill.dirPath || "";
    sourceUrl = skill.sourceUrl || "";
    activeMode = "manual";
    formError = null;
  }

  async function getFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<{ file: File; relativePath: string }[]> {
    const items = Array.from(dataTransfer.items);
    const results: { file: File; relativePath: string }[] = [];

    async function scanEntry(entry: any, pathSoFar: string = "") {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
        results.push({ file, relativePath: pathSoFar ? `${pathSoFar}/${file.name}` : file.name });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = await new Promise<any[]>((resolve, reject) => {
          const allEntries: any[] = [];
          function readNext() {
            reader.readEntries((batch: any[]) => {
              if (batch.length === 0) {
                resolve(allEntries);
              } else {
                allEntries.push(...batch);
                readNext();
              }
            }, reject);
          }
          readNext();
        });
        for (const child of entries) {
          await scanEntry(child, pathSoFar ? `${pathSoFar}/${entry.name}` : entry.name);
        }
      }
    }

    const webkitEntries = items.map((item) => item.webkitGetAsEntry()).filter(Boolean);
    if (webkitEntries.length > 0) {
      for (const entry of webkitEntries) {
        await scanEntry(entry, "");
      }
    } else {
      const files = Array.from(dataTransfer.files);
      for (const f of files) {
        results.push({ file: f, relativePath: f.webkitRelativePath || f.name });
      }
    }

    return results;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (!e.dataTransfer) return;

    const items = await getFilesFromDataTransfer(e.dataTransfer);
    if (items.length === 0) {
      formError = "No files found in dropped items.";
      return;
    }
    await processUploadedFiles(items);
  }

  async function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const files = Array.from(target.files);
    const items = files.map((f) => ({
      file: f,
      relativePath: f.webkitRelativePath || f.name,
    }));
    await processUploadedFiles(items);
  }

  async function processUploadedFiles(items: { file: File; relativePath: string }[]) {
    formBusy = true;
    formError = null;
    try {
      await uploadSkillFiles(items);
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      resetForm();
    } catch (err: any) {
      formError = err?.message || "Failed to upload skill folder";
    } finally {
      formBusy = false;
    }
  }

  async function handleImportByPath() {
    if (!importPath.trim()) {
      formError = "Skill directory path is required.";
      return;
    }
    formBusy = true;
    formError = null;
    try {
      await importSkill(importPath.trim());
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      resetForm();
    } catch (err: any) {
      formError = err?.message || "Failed to import skill";
    } finally {
      formBusy = false;
    }
  }

  async function handleSave() {
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      formError = "Name, Description, and Instructions are required.";
      return;
    }

    formBusy = true;
    formError = null;

    try {
      const payload: SkillWriteBody = {
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        dirPath: dirPath.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      };

      if (editingId) {
        await updateSkill(editingId, payload);
      } else {
        await createSkill(payload);
      }

      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      resetForm();
    } catch (err: any) {
      formError = err?.message || "Failed to save Skill";
    } finally {
      formBusy = false;
    }
  }

  import { confirmStore } from "../../stores/confirmStore.svelte";

  async function handleDelete(skill: SkillInfo) {
    const confirmed = await confirmStore.confirm({
      title: "Delete Skill",
      message: `Are you sure you want to delete skill "${skill.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (!confirmed) return;

    try {
      await deleteSkill(skill.id);
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
    } catch (err: any) {
      alert("Failed to delete skill: " + (err?.message || String(err)));
    }
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h3 class="text-base font-semibold text-fg">Agent Skills</h3>
      <p class="text-xs text-fg-subtle">
        Lazily-loaded procedural knowledge (SKILL.md format with YAML frontmatter).
      </p>
    </div>
    {#if activeMode === "list"}
      <div class="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onclick={() => (activeMode = "manual")}
        >
          <Plus size={14} class="mr-1" /> Create
        </Button>
        <Button
          variant="accent"
          size="sm"
          onclick={() => (activeMode = "import")}
        >
          <FolderPlus size={14} class="mr-1" /> Import
        </Button>
      </div>
    {/if}
  </div>

  {#if previewSkill}
    <div class="rounded-xl border border-line bg-bg-elevated p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold text-fg flex items-center gap-2">
          <BookOpen size={16} /> Skill Review: {previewSkill.name}
        </h4>
        <Button variant="ghost" size="sm" onclick={() => (previewSkill = null)}>
          Close Preview
        </Button>
      </div>
      <p class="text-xs text-fg-subtle">{previewSkill.description}</p>
      {#if previewSkill.dirPath}
        <div class="text-[11px] font-mono text-fg-muted truncate">
          <span class="font-semibold text-fg-subtle">Directory:</span>
          {previewSkill.dirPath}
        </div>
      {/if}
      <div
        class="flex items-center gap-2 text-[10px] font-mono text-fg-subtle bg-bg p-2 rounded border border-line/50"
      >
        <ShieldCheck size={12} class="text-emerald-500" />
        <span>Content Hash: {previewSkill.contentHash.slice(0, 16)}…</span>
      </div>
      <pre
        class="max-h-60 overflow-y-auto rounded-md border border-line bg-bg p-3 text-xs font-mono text-fg whitespace-pre-wrap">{previewSkill.instructions}</pre>
    </div>
  {/if}

  {#if activeMode === "import"}
    <div
      transition:slide={{ duration: 300 }}
      class="rounded-xl border border-line bg-bg-elevated p-5 space-y-4"
    >
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold text-fg flex items-center gap-2">
          <FolderPlus size={16} class="text-accent" /> Import Skill Folder
        </h4>
        <Button variant="ghost" size="sm" onclick={resetForm} disabled={formBusy}>
          Cancel
        </Button>
      </div>

      <input
        bind:this={fileInputEl}
        type="file"
        webkitdirectory
        multiple
        class="hidden"
        onchange={handleFileInputChange}
      />

      <div
        role="button"
        tabindex="0"
        onclick={() => fileInputEl?.click()}
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && fileInputEl?.click()}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={handleDrop}
        class="relative cursor-pointer flex flex-col items-center justify-center rounded-2xl border-2 border-dashed py-10 px-6 text-center transition-all duration-200 {isDragging
          ? 'border-accent bg-accent/10 shadow-lg scale-[1.01]'
          : 'border-line bg-bg/50 hover:border-accent/60 hover:bg-bg-inset'}"
      >
        {#if formBusy}
          <RefreshCw class="animate-spin text-accent mb-3" size={28} />
          <p class="text-sm font-semibold text-fg">Uploading and processing skill...</p>
        {:else}
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent mb-3">
            <UploadCloud size={24} />
          </div>
          <p class="text-sm font-semibold text-fg">
            Drag & drop a skill folder here, or click to browse
          </p>
          <p class="text-xs text-fg-subtle mt-1 max-w-sm">
            Folder must contain a <code class="rounded bg-bg-inset border border-line px-1 py-0.5 font-mono text-accent">SKILL.md</code> file with YAML frontmatter.
          </p>
        {/if}
      </div>

      {#if formError}
        <p class="text-xs text-danger font-medium">{formError}</p>
      {/if}

      <div class="pt-2 border-t border-line/40">
        <button
          type="button"
          onclick={() => (showManualPathInput = !showManualPathInput)}
          class="text-xs text-fg-subtle hover:text-fg underline underline-offset-2"
        >
          {showManualPathInput ? "Hide local server path input" : "Or enter local server path manually"}
        </button>

        {#if showManualPathInput}
          <div transition:slide={{ duration: 200 }} class="mt-3 space-y-3">
            <div>
              <label for="import-path" class="block text-xs font-medium text-fg-muted mb-1">
                Server Directory Path
              </label>
              <input
                id="import-path"
                bind:value={importPath}
                placeholder="e.g. /home/user/skills/webpack or example_skills/webgl"
                class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs font-mono text-fg focus:outline-none focus:border-accent"
              />
            </div>
            <div class="flex justify-end">
              <Button
                variant="accent"
                size="sm"
                onclick={handleImportByPath}
                disabled={formBusy}
              >
                {formBusy ? "Importing..." : "Import Path"}
              </Button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if activeMode === "manual"}
    <div
      transition:slide={{ duration: 300 }}
      class="rounded-xl border border-line bg-bg-elevated p-4 space-y-4"
    >
      <h4 class="text-sm font-semibold text-fg">
        {editingId ? "Edit Skill" : "Add New Skill Manually"}
      </h4>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            for="skill-name"
            class="block text-xs font-medium text-fg-muted mb-1"
          >
            Skill Name
          </label>
          <input
            id="skill-name"
            bind:value={name}
            placeholder="e.g. code-review"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            for="skill-desc"
            class="block text-xs font-medium text-fg-muted mb-1"
          >
            Short Description
          </label>
          <input
            id="skill-desc"
            bind:value={description}
            placeholder="e.g. OWASP security code review guidelines"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div>
        <label
          for="skill-instructions"
          class="block text-xs font-medium text-fg-muted mb-1"
        >
          Instructions (Markdown body)
        </label>
        <textarea
          id="skill-instructions"
          bind:value={instructions}
          rows={6}
          placeholder="Detailed procedural instructions for the model..."
          class="w-full rounded-md border border-line bg-bg p-2.5 text-xs font-mono text-fg focus:outline-none focus:border-accent"
        ></textarea>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            for="skill-dir-path"
            class="block text-xs font-medium text-fg-muted mb-1"
          >
            Internal Directory Path (Optional)
          </label>
          <input
            id="skill-dir-path"
            bind:value={dirPath}
            placeholder="/path/to/skill/working/dir"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            for="skill-source-url"
            class="block text-xs font-medium text-fg-muted mb-1"
          >
            Source URL (Optional)
          </label>
          <input
            id="skill-source-url"
            bind:value={sourceUrl}
            placeholder="https://github.com/org/skills"
            class="w-full rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {#if formError}
        <p class="text-xs text-danger font-medium">{formError}</p>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <Button
          variant="default"
          size="sm"
          onclick={resetForm}
          disabled={formBusy}
        >
          Cancel
        </Button>
        <Button
          variant="accent"
          size="sm"
          onclick={handleSave}
          disabled={formBusy}
        >
          {formBusy ? "Saving..." : "Save Skill"}
        </Button>
      </div>
    </div>
  {:else if skillsQuery.isLoading}
    <div class="flex items-center justify-center p-8 text-fg-subtle">
      <RefreshCw class="animate-spin mr-2" size={16} /> Loading Skills...
    </div>
  {:else if skillsQuery.data && skillsQuery.data.length > 0}
    <div class="space-y-3">
      {#each skillsQuery.data as skill (skill.id)}
        <div
          class="flex items-center justify-between rounded-xl border border-line bg-bg-elevated p-3.5"
        >
          <div class="flex items-center gap-3">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-inset border border-line text-fg-muted"
            >
              <BookOpen size={18} />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm text-fg">{skill.name}</span>
              </div>
              <p class="text-xs text-fg-subtle truncate max-w-md mt-0.5">
                {skill.description}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onclick={() => (previewSkill = skill)}
            >
              <Eye size={14} class="mr-1" /> Preview
            </Button>
            <Button
              variant="default"
              size="sm"
              onclick={() => startEdit(skill)}
            >
              Edit
            </Button>
            <button
              type="button"
              onclick={() => handleDelete(skill)}
              aria-label="Delete {skill.name}"
              class="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors cursor-pointer hover:bg-bg hover:text-danger disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else if activeMode === "list"}
    <div
      class="rounded-xl border border-dashed border-line p-8 text-center text-fg-subtle"
    >
      <BookOpen size={32} class="mx-auto mb-2 opacity-50" />
      <p class="text-sm font-medium">No Skills Installed</p>
      <p class="text-xs mt-1 mb-4">
        Add procedural SKILL.md guidelines to provide your model with
        domain-specific playbooks.
      </p>
    </div>
  {/if}
</div>
