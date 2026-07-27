export const THEMES = ["slate-ember", "paper-fern", "nightshade"] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  "slate-ember": "Slate Ember",
  "paper-fern": "Paper Fern",
  nightshade: "Nightshade",
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

  set(theme: ThemeName) {
    this.current = theme;
  }
}

export const themeStore = new ThemeStore();
