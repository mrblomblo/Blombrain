import { fetchGlobalSettings, updateGlobalSettings, type AutoNameMode, type ToolRoutingMode } from "../api";
import { themeStore, type ThemeName } from "../theme.svelte";

class SettingsStore {
  userName = $state("You");
  userAvatar = $state<string | null>(null);
  theme = $state<ThemeName>("autumn");
  autoNameMode = $state<AutoNameMode>("first_words");
  autoNameModel = $state<string | null>(null);
  toolRoutingMode = $state<ToolRoutingMode>("off");
  toolRoutingModel = $state<string | null>(null);
  loaded = $state(false);

  async init() {
    try {
      const data = await fetchGlobalSettings();
      this.userName = data.userName;
      this.userAvatar = data.userAvatar;
      this.theme = data.theme as ThemeName;
      this.autoNameMode = data.autoNameMode ?? "first_words";
      this.autoNameModel = data.autoNameModel ?? null;
      this.toolRoutingMode = data.toolRoutingMode ?? "off";
      this.toolRoutingModel = data.toolRoutingModel ?? null;
      themeStore.set(this.theme);
      this.loaded = true;
    } catch (err) {
      console.error("Failed to load settings from server:", err);
    }
  }

  async update(
    patch: Partial<{
      userName: string;
      userAvatar: string | null;
      theme: ThemeName;
      autoNameMode: AutoNameMode;
      autoNameModel: string | null;
      toolRoutingMode: ToolRoutingMode;
      toolRoutingModel: string | null;
    }>,
  ) {
    if (patch.userName !== undefined) this.userName = patch.userName;
    if (patch.userAvatar !== undefined) this.userAvatar = patch.userAvatar;
    if (patch.theme !== undefined) {
      this.theme = patch.theme;
      themeStore.set(patch.theme);
    }
    if (patch.autoNameMode !== undefined) this.autoNameMode = patch.autoNameMode;
    if (patch.autoNameModel !== undefined) this.autoNameModel = patch.autoNameModel;
    if (patch.toolRoutingMode !== undefined) this.toolRoutingMode = patch.toolRoutingMode;
    if (patch.toolRoutingModel !== undefined) this.toolRoutingModel = patch.toolRoutingModel;

    try {
      await updateGlobalSettings({
        userName: patch.userName,
        userAvatar: patch.userAvatar,
        theme: patch.theme,
        autoNameMode: patch.autoNameMode,
        autoNameModel: patch.autoNameModel,
        toolRoutingMode: patch.toolRoutingMode,
        toolRoutingModel: patch.toolRoutingModel,
      });
    } catch (err) {
      console.error("Failed to persist settings to server:", err);
    }
  }
}

export const settingsStore = new SettingsStore();
