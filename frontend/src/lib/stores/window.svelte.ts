const isTauriEnv =
  typeof window !== "undefined" &&
  Boolean((window as any).__TAURI_INTERNALS__?.invoke);

async function invokeWindow(cmd: string): Promise<any> {
  const internals =
    typeof window !== "undefined" ? (window as any).__TAURI_INTERNALS__ : null;
  if (!internals?.invoke) return undefined;
  return internals.invoke(cmd, {});
}

class DesktopWindowStore {
  readonly isTauri = isTauriEnv;
  isMaximized = $state(false);
  private listenerAttached = false;

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
}

export const desktopWindow = new DesktopWindowStore();
