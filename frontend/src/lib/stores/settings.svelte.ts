import { fetchGlobalSettings, updateGlobalSettings, type AutoNameMode, type ToolRoutingMode, type CtxOverflowBehavior, type ReasoningInjectionMode } from "../api";
import { themeStore, type ThemeName } from "../theme.svelte";

class SettingsStore {
  userName = $state("You");
  userAvatar = $state<string | null>(null);
  theme = $state<ThemeName>("autumn");
  autoNameMode = $state<AutoNameMode>("first_words");
  autoNameModel = $state<string | null>(null);
  toolRoutingMode = $state<ToolRoutingMode>("off");
  toolRoutingModel = $state<string | null>(null);
  ctxOverflowBehavior = $state<CtxOverflowBehavior>("truncate_middle");
  reasoningInjectionMode = $state<ReasoningInjectionMode>("all");
  networkToolsEnabled = $state<boolean>(false);
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
      this.ctxOverflowBehavior = data.ctxOverflowBehavior ?? "truncate_middle";
      this.reasoningInjectionMode = data.reasoningInjectionMode ?? "all";
      this.networkToolsEnabled = !!data.networkToolsEnabled;
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
      ctxOverflowBehavior: CtxOverflowBehavior;
      reasoningInjectionMode: ReasoningInjectionMode;
      networkToolsEnabled: boolean;
      password?: string;
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
    if (patch.ctxOverflowBehavior !== undefined) this.ctxOverflowBehavior = patch.ctxOverflowBehavior;
    if (patch.reasoningInjectionMode !== undefined) this.reasoningInjectionMode = patch.reasoningInjectionMode;
    if (patch.networkToolsEnabled !== undefined) this.networkToolsEnabled = patch.networkToolsEnabled;

    try {
      await updateGlobalSettings({
        userName: patch.userName,
        userAvatar: patch.userAvatar,
        theme: patch.theme,
        autoNameMode: patch.autoNameMode,
        autoNameModel: patch.autoNameModel,
        toolRoutingMode: patch.toolRoutingMode,
        toolRoutingModel: patch.toolRoutingModel,
        ctxOverflowBehavior: patch.ctxOverflowBehavior,
        reasoningInjectionMode: patch.reasoningInjectionMode,
        networkToolsEnabled: patch.networkToolsEnabled,
        password: patch.password,
      });
    } catch (err) {
      console.error("Failed to persist settings to server:", err);
      throw err;
    }
  }
}

export const settingsStore = new SettingsStore();
