export const THEMES = ["slate-ember", "paper-fern", "nightshade"] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_CONFIG: Record<ThemeName, { label: string; isDark: boolean }> = {
  "slate-ember": { label: "Slate Ember", isDark: true },
  "paper-fern": { label: "Paper Fern", isDark: false },
  nightshade: { label: "Nightshade", isDark: true },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  "slate-ember": THEME_CONFIG["slate-ember"].label,
  "paper-fern": THEME_CONFIG["paper-fern"].label,
  nightshade: THEME_CONFIG["nightshade"].label,
};

const STORAGE_KEY = "blombrain:theme";

function readInitialTheme(): ThemeName {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (THEMES as readonly string[]).includes(stored)) {
      return stored as ThemeName;
    }
  }
  return "slate-ember";
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
