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

    return Array.from(byName.values());
  });

  validAtSet = $derived.by(
    () =>
      new Set(
        this.sessionFiles
          .map((f) => f.name.trim().toLowerCase())
          .filter(Boolean),
      ),
  );

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
