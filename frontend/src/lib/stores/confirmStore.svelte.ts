import type { ButtonVariant } from "../components/ui/Button.svelte";

export type ButtonStyle = ButtonVariant | "outline";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: ButtonStyle;
  cancelStyle?: ButtonStyle;
  confirmOutline?: boolean;
  cancelOutline?: boolean;
}

class ConfirmStore {
  isOpen = $state(false);
  options = $state<ConfirmOptions>({ message: "" });
  private resolveFn: ((value: boolean) => void) | null = null;
  private queue: Array<{ options: ConfirmOptions; resolve: (value: boolean) => void }> = [];

  confirm(opts: string | ConfirmOptions): Promise<boolean> {
    const normalized: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;

    return new Promise<boolean>((resolve) => {
      if (this.isOpen && this.resolveFn) {
        this.queue.push({ options: normalized, resolve });
      } else {
        this.options = normalized;
        this.resolveFn = resolve;
        this.isOpen = true;
      }
    });
  }

  handleResolve(result: boolean) {
    const currentResolve = this.resolveFn;
    this.resolveFn = null;

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.options = next.options;
      this.resolveFn = next.resolve;
      this.isOpen = true;
    } else {
      this.isOpen = false;
    }

    if (currentResolve) {
      currentResolve(result);
    }
  }
}

export const confirmStore = new ConfirmStore();
