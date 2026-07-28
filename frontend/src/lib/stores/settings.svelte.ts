import { fetchGlobalSettings, updateGlobalSettings, type GlobalSettingsOut } from "../api";
import { themeStore, type ThemeName } from "../theme.svelte";

class SettingsStore {
  userName = $state("You");
  userAvatar = $state<string | null>(null);
  theme = $state<ThemeName>("autumn");
  loaded = $state(false);

  async init() {
    try {
      const data = await fetchGlobalSettings();
      this.userName = data.userName;
      this.userAvatar = data.userAvatar;
      this.theme = data.theme as ThemeName;
      themeStore.set(this.theme);
      this.loaded = true;
    } catch (err) {
      console.error("Failed to load settings from server:", err);
    }
  }

  async update(patch: Partial<{ userName: string; userAvatar: string | null; theme: ThemeName }>) {
    if (patch.userName !== undefined) this.userName = patch.userName;
    if (patch.userAvatar !== undefined) this.userAvatar = patch.userAvatar;
    if (patch.theme !== undefined) {
      this.theme = patch.theme;
      themeStore.set(patch.theme);
    }

    try {
      await updateGlobalSettings({
        userName: patch.userName,
        userAvatar: patch.userAvatar,
        theme: patch.theme,
      });
    } catch (err) {
      console.error("Failed to persist settings to server:", err);
    }
  }
}

export const settingsStore = new SettingsStore();
