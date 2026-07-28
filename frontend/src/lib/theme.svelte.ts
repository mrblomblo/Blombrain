export const THEMES = [
  "autumn",
  "ctp-mocha",
  "ctp-latte",
  "dracula",
  "everforest-dark-hard",
  "everforest-light-soft",
  "gruvbox-dark-hard",
  "gruvbox-light-soft",
  "nord-polar-night",
  "nord-snow-storm",
] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_CONFIG: Record<ThemeName, { label: string; isDark: boolean }> = {
  "autumn": { label: "Autumn", isDark: true },
  "ctp-mocha": { label: "Catppuccin Mocha", isDark: true },
  "ctp-latte": { label: "Catppuccin Latte", isDark: false },
  "dracula": { label: "Dracula", isDark: true },
  "everforest-dark-hard": { label: "Everforest Dark", isDark: true },
  "everforest-light-soft": { label: "Everforest Light", isDark: false },
  "gruvbox-dark-hard": { label: "Gruvbox Dark", isDark: true },
  "gruvbox-light-soft": { label: "Gruvbox Light", isDark: false },
  "nord-polar-night": { label: "Nord Polar Night", isDark: true },
  "nord-snow-storm": { label: "Nord Snow Storm", isDark: false },
};

export const THEME_LABELS: Record<ThemeName, string> = Object.fromEntries(
  THEMES.map((t) => [t, THEME_CONFIG[t].label]),
) as Record<ThemeName, string>;

const STORAGE_KEY = "blombrain:theme";

function readInitialTheme(): ThemeName {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) {
      return stored as ThemeName;
    }
  }
  return "ctp-mocha";
}

class ThemeStore {
  current = $state<ThemeName>(readInitialTheme());

  constructor() {
    if (typeof document === "undefined") return;

    $effect.root(() => {
      $effect(() => {
        document.documentElement.dataset.theme = this.current;
        localStorage.setItem(STORAGE_KEY, this.current);
      });
    });
  }

  get isDark(): boolean {
    return THEME_CONFIG[this.current]?.isDark ?? true;
  }

  set(theme: ThemeName) {
    this.current = theme;
  }
}

export const themeStore = new ThemeStore();
