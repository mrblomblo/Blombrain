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

  confirm(opts: string | ConfirmOptions): Promise<boolean> {
    if (typeof opts === "string") {
      this.options = { message: opts };
    } else {
      this.options = opts;
    }

    this.isOpen = true;

    return new Promise<boolean>((resolve) => {
      this.resolveFn = resolve;
    });
  }

  handleResolve(result: boolean) {
    this.isOpen = false;
    if (this.resolveFn) {
      this.resolveFn(result);
      this.resolveFn = null;
    }
  }
}

export const confirmStore = new ConfirmStore();
