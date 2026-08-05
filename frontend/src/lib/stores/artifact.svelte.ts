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

  openArtifact(data: ArtifactData) {
    if (data.id) {
      this.userClosedIds.delete(data.id);
    }
    this.activeId = data.id;
    this.code = data.code;
    this.language = data.language;
    this.title = data.title;
    this.isOpen = true;
  }

  updateCode(id: string, code: string, language: string) {
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
