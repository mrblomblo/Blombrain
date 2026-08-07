import { settingsStore } from "./settings.svelte";
import { fetchArtifactContent } from "../api";

export interface ArtifactData {
  id: string;
  filename?: string;
  conversationId?: string;
  code: string;
  language: string;
  title: string;
}

class ArtifactStore {
  isOpen = $state(false);
  isExpanded = $state(false);
  activeId = $state<string | null>(null);
  artifactId = $state<string | null>(null);
  filename = $state<string | null>(null);
  conversationId = $state<string | null>(null);
  code = $state("");
  language = $state("html");
  title = $state("Artifact");
  userClosedIds = $state(new Set<string>());
  networkAccess = $state(false);
  generatingArtifactId = $state<string | null>(null);

  openArtifact(data: ArtifactData, isGenerating: boolean = false) {
    if (data.id) {
      this.userClosedIds.delete(data.id);
    }
    if (this.activeId !== data.id) {
      this.networkAccess = settingsStore.artifactNetworkEnabled;
    }
    this.activeId = data.id;
    this.artifactId = data.id;
    this.filename = data.filename ?? null;
    this.conversationId = data.conversationId ?? null;
    this.code = data.code;
    this.language = data.language;
    this.title = data.title;
    this.isOpen = true;
    if (isGenerating && data.id) {
      this.generatingArtifactId = data.id;
    } else if (!isGenerating && this.generatingArtifactId === data.id) {
      this.generatingArtifactId = null;
    }
  }

  async loadArtifact(artifactId: string, conversationId: string, filename: string, title: string, language: string) {
    this.userClosedIds.delete(artifactId);
    if (this.activeId !== artifactId) {
      this.networkAccess = settingsStore.artifactNetworkEnabled;
    }
    this.activeId = artifactId;
    this.artifactId = artifactId;
    this.conversationId = conversationId;
    this.filename = filename;
    this.title = title;
    this.language = language;
    this.isOpen = true;

    try {
      const content = await fetchArtifactContent(artifactId);
      this.code = content;
    } catch (err) {
      console.error("Failed to load artifact content:", err);
    }
  }

  async refreshArtifactContent(artifactId: string) {
    if (this.artifactId === artifactId || this.activeId === artifactId) {
      try {
        const content = await fetchArtifactContent(artifactId);
        this.code = content;
      } catch (err) {
        console.error("Failed to refresh artifact content:", err);
      }
    }
  }

  updateCode(id: string, code: string, language: string, isGenerating: boolean = false) {
    if (isGenerating) {
      this.generatingArtifactId = id;
    } else if (this.generatingArtifactId === id) {
      this.generatingArtifactId = null;
    }

    if (this.activeId === id) {
      this.code = code;
      this.language = language;
    }
  }

  toggleExpand() {
    this.isExpanded = !this.isExpanded;
  }

  close() {
    if (this.activeId) {
      this.userClosedIds.add(this.activeId);
    }
    this.isOpen = false;
    this.isExpanded = false;
  }

  resetUserClosed() {
    this.userClosedIds.clear();
  }
}

export const artifactStore = new ArtifactStore();
