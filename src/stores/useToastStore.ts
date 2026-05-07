import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** External link (e.g. PR url) — opens when the toast is clicked. */
  href?: string;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  /** Push a toast; auto-dismisses after `durationMs` (default 6000). */
  pushToast: (
    input: Omit<Toast, "id" | "createdAt">,
    durationMs?: number
  ) => string;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  pushToast: (input, durationMs = 6000) => {
    const id = `toast-${++nextId}`;
    const toast: Toast = { id, createdAt: Date.now(), ...input };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismissToast(id), durationMs);
    }
    return id;
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clearAll: () => set({ toasts: [] }),
}));
