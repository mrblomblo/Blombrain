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

  openArtifact(data: ArtifactData) {
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
    this.isOpen = false;
    this.isExpanded = false;
  }
}

export const artifactStore = new ArtifactStore();
