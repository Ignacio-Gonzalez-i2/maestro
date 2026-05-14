/**
 * Thin wrappers around Tauri `invoke` / `listen` for PTY session management.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler. Errors are
 * propagated as rejected promises; callers are responsible for catch/logging.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BackendCapabilities, BackendType } from "./terminalTheme";

/**
 * Spawns a new PTY shell session on the backend.
 * @param cwd - Starting working directory; when omitted the backend uses its default.
 * @param env - Environment variables to pass to the shell process. These are inherited
 *   by all child processes (including Claude CLI → MCP server). MAESTRO_SESSION_ID is
 *   automatically set by the backend.
 * @returns The numeric session ID assigned by the backend.
 */
export async function spawnShell(cwd?: string, env?: Record<string, string>): Promise<number> {
  return invoke<number>("spawn_shell", { cwd: cwd ?? null, env: env ?? null });
}

/** Saves pasted image data to a temporary file. Returns the absolute file path. */
export async function savePastedImage(data: number[], mediaType: string): Promise<string> {
  return invoke<string>("save_pasted_image", { data, mediaType });
}

/**
 * Maximum payload size per `write_stdin` IPC call.
 *
 * Tauri's IPC marshals each invoke arg as JSON. Very large strings can blow
 * through WebView2's serialization buffers on Windows and trigger silent
 * truncation when pasting megabytes of text. We split larger payloads into
 * 64 KiB chunks; the Rust side acquires the writer mutex per chunk so the
 * sequence still lands in order.
 *
 * Picked empirically — large enough that normal keystrokes / typical pastes
 * stay in a single chunk, small enough to be safe across platforms.
 */
const WRITE_STDIN_CHUNK_BYTES = 64 * 1024;

/**
 * Per-session write queue. Each session's `writeStdin` calls are chained
 * onto a single promise so chunks never overlap or reorder across async
 * boundaries. Without this, fire-and-forget writeStdin calls from
 * xterm.onData and paste handlers could race inside Tauri's command worker
 * pool and arrive at the PTY out of order, mangling user input.
 */
const writeStdinQueues = new Map<number, Promise<void>>();

function chunkString(s: string, maxBytes: number): string[] {
  // Byte-aware splitting so we never cut a UTF-8 codepoint mid-sequence.
  // Iterate by codepoint and emit whenever we would exceed maxBytes.
  const enc = new TextEncoder();
  const out: string[] = [];
  let buf = "";
  let bufBytes = 0;
  for (const ch of s) {
    const chBytes = enc.encode(ch).length;
    if (bufBytes + chBytes > maxBytes && buf.length > 0) {
      out.push(buf);
      buf = "";
      bufBytes = 0;
    }
    buf += ch;
    bufBytes += chBytes;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/**
 * Writes raw bytes to the PTY stdin of the given session.
 *
 * Large payloads (typically clipboard pastes) are split into chunks and
 * sent sequentially. All writes for a given session are serialized through
 * a per-session promise queue so chunks always arrive at the PTY in the
 * order the caller issued them.
 */
export function writeStdin(sessionId: number, data: string): Promise<void> {
  const prev = writeStdinQueues.get(sessionId) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // Don't let one failed write poison subsequent writes for this session;
      // upstream callers already log via their own .catch.
    })
    .then(async () => {
      // Fast path: small payload, single invoke.
      if (data.length === 0) return;
      // Use string length as a cheap proxy for byte count. UTF-8 codepoints
      // are at most 4 bytes so the check is conservative but cheap.
      if (data.length * 4 <= WRITE_STDIN_CHUNK_BYTES) {
        await invoke("write_stdin", { sessionId, data });
        return;
      }
      const chunks = chunkString(data, WRITE_STDIN_CHUNK_BYTES);
      for (const chunk of chunks) {
        await invoke("write_stdin", { sessionId, data: chunk });
      }
    });
  writeStdinQueues.set(sessionId, next);
  // Drop the queue entry once this write is the tail and has settled, so we
  // don't hold long promise chains for dead sessions. We attach the cleanup
  // to a separately-caught branch so it never produces an unhandled rejection
  // if the write itself rejected — the caller still sees the rejection on
  // their own `next` reference.
  next.then(
    () => {
      if (writeStdinQueues.get(sessionId) === next) {
        writeStdinQueues.delete(sessionId);
      }
    },
    () => {
      if (writeStdinQueues.get(sessionId) === next) {
        writeStdinQueues.delete(sessionId);
      }
    },
  );
  return next;
}

/** Notifies the backend PTY of a terminal dimension change (rows x cols). */
export async function resizePty(sessionId: number, rows: number, cols: number): Promise<void> {
  return invoke("resize_pty", { sessionId, rows, cols });
}

/** Terminates the backend PTY process and cleans up the session. */
export async function killSession(sessionId: number): Promise<void> {
  return invoke("kill_session", { sessionId });
}

/** AI mode variants matching the backend enum. */
export type AiMode = "Claude" | "Gemini" | "Codex" | "OpenCode" | "Plain";

/** CLI modes that support flags (excludes Plain). */
export type CliAiMode = Exclude<AiMode, "Plain">;

/** CLI command configuration for each AI mode */
export const AI_CLI_CONFIG: Record<AiMode, {
  command: string | null;
  installHint: string;
  skipPermissionsFlag: string | null;
}> = {
  Claude: {
    command: "claude",
    installHint: "npm install -g @anthropic-ai/claude-code",
    skipPermissionsFlag: "--dangerously-skip-permissions",
  },
  Gemini: {
    command: "gemini",
    installHint: "npm install -g @google/gemini-cli",
    skipPermissionsFlag: "--yolo",
  },
  Codex: {
    command: "codex",
    installHint: "npm install -g codex",
    skipPermissionsFlag: "--dangerously-bypass-approvals-and-sandbox",
  },
  OpenCode: {
    command: "opencode",
    installHint: "npm install -g opencode-ai",
    skipPermissionsFlag: "--dangerously-skip-permissions",
  },
  Plain: {
    command: null,
    installHint: "",
    skipPermissionsFlag: null,
  },
};

/** Writes hooks configuration for a Claude session to .claude/settings.local.json. */
export async function writeSessionHooksConfig(
  workingDir: string,
  sessionId: number
): Promise<void> {
  await invoke("write_session_hooks_config", {
    workingDir,
    sessionId,
  });
}

/** Removes hooks configuration from .claude/settings.local.json. */
export async function removeSessionHooksConfig(
  workingDir: string
): Promise<void> {
  await invoke("remove_session_hooks_config", { workingDir });
}

/** Checks if a CLI tool is available in the user's PATH */
export async function checkCliAvailable(command: string): Promise<boolean> {
  return invoke<boolean>("check_cli_available", { command });
}

/** Info about a previous Claude Code session that can be resumed. */
export interface ClaudeSessionInfo {
  session_id: string;
  first_prompt: string | null;
  started_at: string;
  last_active: string;
  git_branch: string | null;
}

/** Lists previous Claude Code sessions for a project from Claude's native storage. */
export async function listClaudeSessions(projectPath: string): Promise<ClaudeSessionInfo[]> {
  return invoke<ClaudeSessionInfo[]>("list_claude_sessions", { projectPath });
}

/** Deletes a Claude Code session's transcript and snapshot data. */
export async function deleteClaudeSession(projectPath: string, sessionId: string): Promise<void> {
  return invoke("delete_claude_session", { projectPath, sessionId });
}

/** Session config returned by createSession. */
export interface SessionConfig {
  id: number;
  mode: AiMode;
  name?: string | null;
  branch: string | null;
  status: string;
  worktree_path: string | null;
  project_path: string;
  /** Shell spawn directory — may differ from project_path in multi-repo workspaces. */
  working_directory?: string | null;
}

/** Creates a session in the SessionManager (separate from PTY spawning). */
export async function createSession(
  id: number,
  mode: AiMode,
  projectPath: string,
  workingDirectory?: string
): Promise<SessionConfig> {
  return invoke<SessionConfig>("create_session", {
    id,
    mode,
    projectPath,
    workingDirectory: workingDirectory ?? null,
  });
}

/** Assigns a branch and optional worktree path to a session. */
export async function assignSessionBranch(
  sessionId: number,
  branch: string,
  worktreePath: string | null
): Promise<SessionConfig> {
  return invoke<SessionConfig>("assign_session_branch", { sessionId, branch, worktreePath });
}

/**
 * Subscribes to the per-session `pty-output-{sessionId}` Tauri event.
 * Returns a promise that resolves to an unlisten function. The caller must
 * invoke the unlisten function on cleanup to avoid leaked event listeners.
 */
export function onPtyOutput(
  sessionId: number,
  callback: (data: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty-output-${sessionId}`, (event) => {
    callback(event.payload);
  });
}

/** Backend info as returned by the Rust backend. */
export interface BackendInfo {
  backendType: BackendType;
  capabilities: BackendCapabilities;
}

/** Cached backend info to avoid repeated IPC calls. */
let cachedBackendInfo: BackendInfo | null = null;

/**
 * Returns information about the active terminal backend.
 * The result is cached after the first call.
 */
export async function getBackendInfo(): Promise<BackendInfo> {
  if (cachedBackendInfo) {
    return cachedBackendInfo;
  }
  cachedBackendInfo = await invoke<BackendInfo>("get_backend_info");
  return cachedBackendInfo;
}

/** Checks if the current backend supports enhanced terminal state. */
export async function hasEnhancedState(): Promise<boolean> {
  const info = await getBackendInfo();
  return info.capabilities.enhancedState;
}

// Terminal ready signaling mechanism
// Used to coordinate between TerminalGrid (which sends CLI commands) and
// TerminalView (which needs to be listening for PTY output first)
//
// Uses window-level storage to ensure the same instance is shared across
// all chunks in production builds (module-level Maps can be duplicated).
declare global {
  interface Window {
    __maestroTerminalsReady?: Set<number>;
  }
}

function getTerminalsReadySet(): Set<number> {
  if (!window.__maestroTerminalsReady) {
    window.__maestroTerminalsReady = new Set();
  }
  return window.__maestroTerminalsReady;
}

/**
 * Signals that a terminal is ready to receive PTY output.
 * Called by TerminalView after xterm.js is mounted and listening.
 */
export function signalTerminalReady(sessionId: number): void {
  getTerminalsReadySet().add(sessionId);
}

/**
 * Waits for a terminal to signal it's ready to receive PTY output.
 * Called by TerminalGrid before sending CLI commands.
 * Uses polling to check if the terminal has signaled ready.
 * @param sessionId - The session ID to wait for
 * @param timeoutMs - Maximum time to wait (default 5000ms to account for font loading)
 * @returns Promise that resolves when terminal is ready or rejects on timeout
 */
export function waitForTerminalReady(sessionId: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const pollInterval = 50; // Check every 50ms

    const check = () => {
      const readySet = getTerminalsReadySet();
      if (readySet.has(sessionId)) {
        readySet.delete(sessionId);
        resolve();
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Terminal ${sessionId} ready timeout after ${timeoutMs}ms`));
        return;
      }

      setTimeout(check, pollInterval);
    };

    check();
  });
}

/**
 * CLI flags for a specific AI mode.
 */
export type CliFlags = {
  skipPermissions: boolean;
  customFlags: string;
};

/**
 * Builds the full CLI command with user-configured flags.
 *
 * @param mode - The AI mode to build the command for
 * @param flags - The CLI flags configuration for this mode
 * @returns The full CLI command string, or null for Plain mode
 *
 * @example
 * buildCliCommand("Claude", { skipPermissions: true, customFlags: "--verbose" })
 * // Returns: "claude --dangerously-skip-permissions --verbose"
 *
 * buildCliCommand("Gemini", { skipPermissions: true, customFlags: "" })
 * // Returns: "gemini --yolo"
 *
 * buildCliCommand("Codex", { skipPermissions: true, customFlags: "" })
 * // Returns: "codex --dangerously-bypass-approvals-and-sandbox"
 */
export function buildCliCommand(mode: AiMode, flags?: CliFlags, resumeSessionId?: string): string | null {
  const config = AI_CLI_CONFIG[mode];
  if (!config.command) return null;

  const parts: string[] = [config.command];

  if (resumeSessionId) {
    parts.push("--resume", resumeSessionId);
  }

  if (flags) {
    if (flags.skipPermissions && config.skipPermissionsFlag) {
      parts.push(config.skipPermissionsFlag);
    }
    if (flags.customFlags.trim()) {
      parts.push(flags.customFlags.trim());
    }
  }

  return parts.join(" ");
}
