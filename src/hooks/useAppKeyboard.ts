import { useEffect } from "react";

interface UseAppKeyboardOptions {
  /** Callback to add a new session */
  onAddSession: () => void;
  /** Whether adding a session is currently allowed (e.g. in grid view) */
  canAddSession: boolean;
  /** Callback to toggle the left sidebar (Alt+1) */
  onToggleSidebar?: () => void;
  /** Callback to toggle the git panel (Cmd/Ctrl+2) */
  onToggleGitPanel?: () => void;
}

/**
 * Detect whether the current platform uses Cmd (Mac) or Ctrl (Windows/Linux) as the modifier key.
 */
function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * App-level keyboard shortcut handler.
 *
 * Shortcuts:
 * - Cmd/Ctrl+T: Add a new session slot (when in grid view)
 * - Cmd/Ctrl+2: Toggle the git panel
 * - Alt+1: Toggle the left sidebar
 * - Alt+N: Add a new session slot (when in grid view)
 */
export function useAppKeyboard({
  onAddSession,
  canAddSession,
  onToggleSidebar,
  onToggleGitPanel,
}: UseAppKeyboardOptions): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Alt-based shortcuts (no Cmd/Ctrl, no Shift)
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === "1" && onToggleSidebar) {
          event.preventDefault();
          event.stopImmediatePropagation();
          onToggleSidebar();
          return;
        }
        // Alt+N to add a new session slot
        if ((event.key === "n" || event.key === "N") && canAddSession) {
          event.preventDefault();
          event.stopImmediatePropagation();
          onAddSession();
          return;
        }
      }

      const modifierKey = isMac() ? event.metaKey : event.ctrlKey;
      if (!modifierKey) return;

      // Don't interfere with other modifier combinations
      if (event.altKey || event.shiftKey) return;

      // Cmd/Ctrl+2: toggle the git panel.
      // stopImmediatePropagation prevents useTerminalKeyboard's number-focus from firing.
      if (event.key === "2" && onToggleGitPanel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onToggleGitPanel();
        return;
      }

      if (event.key === "t") {
        // Always prevent default to block WebView's new-tab behavior
        event.preventDefault();
        if (canAddSession) {
          onAddSession();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onAddSession, canAddSession, onToggleSidebar, onToggleGitPanel]);
}
