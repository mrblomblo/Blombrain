import { chatStore } from "./chat.svelte";
import { artifactStore } from "./artifact.svelte";
import type { SessionFileItem } from "../types";

class TriggerCatalogStore {
  slashNames = $state<string[]>([]);

  sessionFiles = $derived.by((): SessionFileItem[] => {
    const byName = new Map<string, SessionFileItem>();

    for (const att of chatStore.pendingAttachments) {
      const key = att.originalName.trim().toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: att.id,
          name: att.originalName,
          source: "pending",
          subtitle: "Pending upload",
          mimeType: att.mimeType,
        });
      }
    }

    for (const art of artifactStore.conversationArtifacts) {
      const key = art.filename.trim().toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: art.id,
          name: art.filename,
          source: "artifact",
          subtitle: art.language ? `Artifact (${art.language})` : "Artifact",
        });
      }
    }

    const activeMsgs = chatStore.activePath;
    for (let i = activeMsgs.length - 1; i >= 0; i--) {
      const msg = activeMsgs[i];
      if (!msg.attachments) continue;
      for (const att of msg.attachments) {
        const key = att.originalName.trim().toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, {
            id: att.id,
            name: att.originalName,
            source: "attachment",
            subtitle: "Session attachment",
            mimeType: att.mimeType,
          });
        }
      }
    }

    const dirCounts = new Map<string, number>();
    for (const relPath of chatStore.workspaceFiles) {
      const trimmed = relPath.trim();
      if (!trimmed) continue;
      const parts = trimmed.split("/").filter(Boolean);
      for (let i = 0; i < parts.length - 1; i++) {
        const dirRel = `${parts.slice(0, i + 1).join("/")}/`;
        dirCounts.set(dirRel, (dirCounts.get(dirRel) ?? 0) + 1);
      }
      const key = trimmed.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: `workspace:${trimmed}`,
          name: trimmed,
          source: "workspace",
          subtitle: "Workspace file",
          workspacePath: trimmed,
        });
      }
    }

    const sortedDirs = Array.from(dirCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [dirRel, count] of sortedDirs) {
      const key = dirRel.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, {
          id: `workspace_dir:${dirRel}`,
          name: dirRel,
          source: "workspace",
          subtitle: `Workspace folder (${count} file${count === 1 ? "" : "s"})`,
          workspacePath: dirRel,
        });
      }
    }

    return Array.from(byName.values());
  });

  validAtSet = $derived.by(() => {
    const set = new Set<string>();
    for (const f of this.sessionFiles) {
      const lower = f.name.trim().toLowerCase();
      if (lower) set.add(lower);
      if (f.source === "workspace" && lower.includes("/")) {
        const base = lower.split("/").pop();
        if (base) set.add(base);
      }
    }
    return set;
  });

  validSlashSet = $derived.by(
    () =>
      new Set(
        this.slashNames
          .map((n) => n.trim().toLowerCase())
          .filter(Boolean),
      ),
  );

  setSlashNames(names: string[]) {
    if (
      names.length === this.slashNames.length &&
      names.every((n, i) => n === this.slashNames[i])
    ) {
      return;
    }
    this.slashNames = names;
  }
}

export const triggerCatalogStore = new TriggerCatalogStore();
