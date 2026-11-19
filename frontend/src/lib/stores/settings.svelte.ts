import {
  fetchGlobalSettings,
  updateGlobalSettings,
  type AutoNameMode,
  type ToolRoutingMode,
  type CtxOverflowBehavior,
  type ReasoningInjectionMode,
  type SpeechProviderType,
  type SpeechDeviceType,
} from "../api";
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
  artifactNetworkEnabled = $state<boolean>(false);
  disabledBuiltInTools = $state<string[]>([]);
  memoryEnabled = $state<boolean>(true);
  crossChatRecallEnabled = $state<boolean>(true);
  crossChatIncludeArchived = $state<boolean>(false);
  embeddingModel = $state<string | null>(null);
  sttProvider = $state<SpeechProviderType>("browser");
  sttEndpoint = $state<string | null>(null);
  sttModel = $state<string | null>(null);
  sttDevice = $state<SpeechDeviceType>("cpu");
  ttsProvider = $state<SpeechProviderType>("browser");
  ttsEndpoint = $state<string | null>(null);
  ttsModel = $state<string | null>(null);
  ttsVoice = $state<string | null>(null);
  ttsDevice = $state<SpeechDeviceType>("cpu");
  speechIdleTimeoutSec = $state<number>(60);
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
      this.artifactNetworkEnabled = !!data.artifactNetworkEnabled;
      this.disabledBuiltInTools = Array.isArray(data.disabledBuiltInTools) ? data.disabledBuiltInTools : [];
      this.memoryEnabled = data.memoryEnabled !== undefined ? !!data.memoryEnabled : true;
      this.crossChatRecallEnabled = data.crossChatRecallEnabled !== undefined ? !!data.crossChatRecallEnabled : true;
      this.crossChatIncludeArchived = !!data.crossChatIncludeArchived;
      this.embeddingModel = data.embeddingModel ?? null;
      this.sttProvider = data.sttProvider ?? "browser";
      this.sttEndpoint = data.sttEndpoint ?? null;
      this.sttModel = data.sttModel ?? null;
      this.sttDevice = data.sttDevice ?? "cpu";
      this.ttsProvider = data.ttsProvider ?? "browser";
      this.ttsEndpoint = data.ttsEndpoint ?? null;
      this.ttsModel = data.ttsModel ?? null;
      this.ttsVoice = data.ttsVoice ?? null;
      this.ttsDevice = data.ttsDevice ?? "cpu";
      this.speechIdleTimeoutSec = data.speechIdleTimeoutSec ?? 60;
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
      artifactNetworkEnabled: boolean;
      disabledBuiltInTools: string[];
      memoryEnabled: boolean;
      crossChatRecallEnabled: boolean;
      crossChatIncludeArchived: boolean;
      embeddingModel: string | null;
      sttProvider: SpeechProviderType;
      sttEndpoint: string | null;
      sttModel: string | null;
      sttDevice: SpeechDeviceType;
      ttsProvider: SpeechProviderType;
      ttsEndpoint: string | null;
      ttsModel: string | null;
      ttsVoice: string | null;
      ttsDevice: SpeechDeviceType;
      speechIdleTimeoutSec: number;
      password?: string;
    }>,
  ) {
    const prev = {
      userName: this.userName,
      userAvatar: this.userAvatar,
      theme: this.theme,
      autoNameMode: this.autoNameMode,
      autoNameModel: this.autoNameModel,
      toolRoutingMode: this.toolRoutingMode,
      toolRoutingModel: this.toolRoutingModel,
      ctxOverflowBehavior: this.ctxOverflowBehavior,
      reasoningInjectionMode: this.reasoningInjectionMode,
      networkToolsEnabled: this.networkToolsEnabled,
      artifactNetworkEnabled: this.artifactNetworkEnabled,
      disabledBuiltInTools: [...this.disabledBuiltInTools],
      memoryEnabled: this.memoryEnabled,
      crossChatRecallEnabled: this.crossChatRecallEnabled,
      crossChatIncludeArchived: this.crossChatIncludeArchived,
      embeddingModel: this.embeddingModel,
      sttProvider: this.sttProvider,
      sttEndpoint: this.sttEndpoint,
      sttModel: this.sttModel,
      sttDevice: this.sttDevice,
      ttsProvider: this.ttsProvider,
      ttsEndpoint: this.ttsEndpoint,
      ttsModel: this.ttsModel,
      ttsVoice: this.ttsVoice,
      ttsDevice: this.ttsDevice,
      speechIdleTimeoutSec: this.speechIdleTimeoutSec,
    };

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
    if (patch.artifactNetworkEnabled !== undefined) this.artifactNetworkEnabled = patch.artifactNetworkEnabled;
    if (patch.disabledBuiltInTools !== undefined) this.disabledBuiltInTools = patch.disabledBuiltInTools;
    if (patch.memoryEnabled !== undefined) this.memoryEnabled = patch.memoryEnabled;
    if (patch.crossChatRecallEnabled !== undefined) this.crossChatRecallEnabled = patch.crossChatRecallEnabled;
    if (patch.crossChatIncludeArchived !== undefined) this.crossChatIncludeArchived = patch.crossChatIncludeArchived;
    if (patch.embeddingModel !== undefined) this.embeddingModel = patch.embeddingModel;
    if (patch.sttProvider !== undefined) this.sttProvider = patch.sttProvider;
    if (patch.sttEndpoint !== undefined) this.sttEndpoint = patch.sttEndpoint;
    if (patch.sttModel !== undefined) this.sttModel = patch.sttModel;
    if (patch.sttDevice !== undefined) this.sttDevice = patch.sttDevice;
    if (patch.ttsProvider !== undefined) this.ttsProvider = patch.ttsProvider;
    if (patch.ttsEndpoint !== undefined) this.ttsEndpoint = patch.ttsEndpoint;
    if (patch.ttsModel !== undefined) this.ttsModel = patch.ttsModel;
    if (patch.ttsVoice !== undefined) this.ttsVoice = patch.ttsVoice;
    if (patch.ttsDevice !== undefined) this.ttsDevice = patch.ttsDevice;
    if (patch.speechIdleTimeoutSec !== undefined) this.speechIdleTimeoutSec = patch.speechIdleTimeoutSec;

    try {
      await updateGlobalSettings(patch);
    } catch (err) {
      this.userName = prev.userName;
      this.userAvatar = prev.userAvatar;
      this.theme = prev.theme;
      themeStore.set(prev.theme);
      this.autoNameMode = prev.autoNameMode;
      this.autoNameModel = prev.autoNameModel;
      this.toolRoutingMode = prev.toolRoutingMode;
      this.toolRoutingModel = prev.toolRoutingModel;
      this.ctxOverflowBehavior = prev.ctxOverflowBehavior;
      this.reasoningInjectionMode = prev.reasoningInjectionMode;
      this.networkToolsEnabled = prev.networkToolsEnabled;
      this.artifactNetworkEnabled = prev.artifactNetworkEnabled;
      this.disabledBuiltInTools = prev.disabledBuiltInTools;
      this.memoryEnabled = prev.memoryEnabled;
      this.crossChatRecallEnabled = prev.crossChatRecallEnabled;
      this.crossChatIncludeArchived = prev.crossChatIncludeArchived;
      this.embeddingModel = prev.embeddingModel;
      this.sttProvider = prev.sttProvider;
      this.sttEndpoint = prev.sttEndpoint;
      this.sttModel = prev.sttModel;
      this.sttDevice = prev.sttDevice;
      this.ttsProvider = prev.ttsProvider;
      this.ttsEndpoint = prev.ttsEndpoint;
      this.ttsModel = prev.ttsModel;
      this.ttsVoice = prev.ttsVoice;
      this.ttsDevice = prev.ttsDevice;
      this.speechIdleTimeoutSec = prev.speechIdleTimeoutSec;
      console.error("Failed to persist settings to server:", err);
      throw err;
    }
  }
}

export const settingsStore = new SettingsStore();
