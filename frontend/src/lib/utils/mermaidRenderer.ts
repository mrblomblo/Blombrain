import DOMPurify from "dompurify";
import { THEME_CONFIG, type ThemeName } from "../theme.svelte";

const MAX_CACHE_ENTRIES = 200;
const svgCache = new Map<string, string>();

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();
let activeThemeKey: string | null = null;
let renderSeq = 0;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid");
  }
  return mermaidPromise;
}

function rgbStringToHex(color: string, fallback: string): string {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) return fallback;
  const r = Math.max(0, Math.min(255, Math.round(Number(m[1])))).toString(16).padStart(2, "0");
  const g = Math.max(0, Math.min(255, Math.round(Number(m[2])))).toString(16).padStart(2, "0");
  const b = Math.max(0, Math.min(255, Math.round(Number(m[3])))).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function resolveThemeColors(themeName: ThemeName) {
  const isDark = THEME_CONFIG[themeName]?.isDark ?? true;
  const defaults = isDark
    ? {
        bg: "#1a1815",
        bgElevated: "#221f1a",
        bgInset: "#161411",
        fg: "#ece6d8",
        fgMuted: "#b8a898",
        line: "#5a4f3f",
        accent: "#d4741a",
        accentFg: "#1a1815",
      }
    : {
        bg: "#eceff4",
        bgElevated: "#eff1f5",
        bgInset: "#dfe3ec",
        fg: "#2e3440",
        fgMuted: "#5c5f77",
        line: "#b8bfce",
        accent: "#5e81ac",
        accentFg: "#ffffff",
      };

  if (typeof document === "undefined" || !document.body) {
    return { isDark, ...defaults };
  }

  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);

  const read = (varName: string, fallback: string): string => {
    probe.style.color = `var(${varName})`;
    const computed = getComputedStyle(probe).color;
    return rgbStringToHex(computed, fallback);
  };

  try {
    return {
      isDark,
      bg: read("--bg", defaults.bg),
      bgElevated: read("--bg-elevated", defaults.bgElevated),
      bgInset: read("--bg-inset", defaults.bgInset),
      fg: read("--fg", defaults.fg),
      fgMuted: read("--fg-muted", defaults.fgMuted),
      line: read("--line", defaults.line),
      accent: read("--accent", defaults.accent),
      accentFg: read("--accent-fg", defaults.accentFg),
    };
  } finally {
    probe.remove();
  }
}

export function getCachedMermaidSvg(hash: string, themeName: ThemeName): string | undefined {
  return svgCache.get(`${hash}::${themeName}`);
}

export async function renderMermaidDiagram(
  code: string,
  hash: string,
  themeName: ThemeName,
): Promise<{ svg: string } | { error: string }> {
  const cacheKey = `${hash}::${themeName}`;
  const cached = svgCache.get(cacheKey);
  if (cached) {
    return { svg: cached };
  }

  const task = renderQueue.then(async (): Promise<{ svg: string } | { error: string }> => {
    const again = svgCache.get(cacheKey);
    if (again) return { svg: again };

    try {
      const mod = await loadMermaid();
      const mermaid = mod.default;

      if (activeThemeKey !== themeName) {
        const c = resolveThemeColors(themeName);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          darkMode: c.isDark,
          fontFamily: "Ubuntu, sans-serif",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          themeVariables: {
            darkMode: c.isDark,
            background: c.bgElevated,
            primaryColor: c.bgInset,
            primaryTextColor: c.fg,
            primaryBorderColor: c.accent,
            secondaryColor: c.bg,
            secondaryTextColor: c.fg,
            secondaryBorderColor: c.line,
            tertiaryColor: c.bgElevated,
            tertiaryTextColor: c.fg,
            tertiaryBorderColor: c.line,
            lineColor: c.fgMuted,
            textColor: c.fg,
            mainBkg: c.bgInset,
            nodeBkg: c.bgInset,
            nodeBorder: c.line,
            clusterBkg: c.bg,
            clusterBorder: c.line,
            titleColor: c.fg,
            edgeLabelBackground: c.bgElevated,
            actorBkg: c.bgInset,
            actorBorder: c.accent,
            actorTextColor: c.fg,
            signalColor: c.fg,
            signalTextColor: c.fg,
            labelBoxBkgColor: c.bgElevated,
            labelBoxBorderColor: c.line,
            labelTextColor: c.fg,
            noteBkgColor: c.bg,
            noteBorderColor: c.accent,
            noteTextColor: c.fg,
          },
        });
        activeThemeKey = themeName;
      }

      const id = `blombrain-mermaid-${++renderSeq}`;
      const { svg } = await mermaid.render(id, code);
      // Clean up any detached temporary render wrapper Mermaid may leave on error
      document.getElementById(`d${id}`)?.remove();

      const sanitized = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_ATTR: ["xmlns", "viewBox", "preserveAspectRatio", "dominant-baseline", "text-anchor"],
      });

      if (svgCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = svgCache.keys().next().value;
        if (oldestKey) svgCache.delete(oldestKey);
      }
      svgCache.set(cacheKey, sanitized);
      return { svg: sanitized };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  });

  renderQueue = task.catch(() => {});
  return task;
}
