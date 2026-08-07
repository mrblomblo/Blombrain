import { settingsStore } from "./settings.svelte";

export interface ArtifactData {
  id: string;
  code: string;
  language: string;
  title: string;
}

class ArtifactStore {
  isOpen = $state(false);
  isExpanded = $state(false);
  activeId = $state<string | null>(null);
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
