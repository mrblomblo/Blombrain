const isTauriEnv =
  typeof window !== "undefined" &&
  Boolean((window as any).__TAURI_INTERNALS__?.invoke);

async function invokeWindow(cmd: string, args: Record<string, any> = {}): Promise<any> {
  const internals =
    typeof window !== "undefined" ? (window as any).__TAURI_INTERNALS__ : null;
  if (!internals?.invoke) return undefined;
  return internals.invoke(cmd, args);
}

class DesktopWindowStore {
  readonly isTauri = isTauriEnv;
  isMaximized = $state(false);
  private modalOpenCount = 0;
  activeModalCount = $state(0);
  private listenerAttached = false;

  registerActiveModal(): () => void {
    this.modalOpenCount += 1;
    this.activeModalCount = this.modalOpenCount;
    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      this.modalOpenCount = Math.max(0, this.modalOpenCount - 1);
      this.activeModalCount = this.modalOpenCount;
    };
  }

  constructor() {
    this.syncDocumentClass();
  }

  private syncDocumentClass() {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle(
      "tauri-rounded",
      this.isTauri && !this.isMaximized,
    );
  }

  async refreshMaximized() {
    if (!this.isTauri) return;
    try {
      const next = Boolean(await invokeWindow("plugin:window|is_maximized"));
      if (this.isMaximized !== next) {
        this.isMaximized = next;
      }
      this.syncDocumentClass();
    } catch {
      // Ignore if invoked outside a window context
    }
  }

  attachListeners(): () => void {
    if (!this.isTauri || typeof window === "undefined") {
      return () => {};
    }
    this.refreshMaximized();
    if (this.listenerAttached) {
      return () => {};
    }
    this.listenerAttached = true;
    const onResize = () => {
      void this.refreshMaximized();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      this.listenerAttached = false;
    };
  }

  async minimize() {
    try {
      await invokeWindow("plugin:window|minimize");
    } catch { }
  }

  async toggleMaximize() {
    try {
      await invokeWindow("plugin:window|toggle_maximize");
      await this.refreshMaximized();
    } catch { }
  }

  async close() {
    try {
      await invokeWindow("plugin:window|close");
    } catch { }
  }

  async openExternal(url: string): Promise<boolean> {
    if (this.isTauri) {
      try {
        await invokeWindow("open_external_url", { url });
        return true;
      } catch (e1) {
        try {
          await invokeWindow("plugin:opener|open_url", { url });
          return true;
        } catch (e2) {
          console.error("Failed to open external URL in desktop app:", e1, e2);
        }
      }
    }
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  }
}

export const desktopWindow = new DesktopWindowStore();
