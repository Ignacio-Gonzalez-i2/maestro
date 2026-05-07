import { FolderOpen, Play, Plus } from "lucide-react";
import { UsageBar } from "./UsageBar";

interface BottomBarProps {
  /** Whether in the grid view (project selected and launched) */
  inGridView: boolean;
  /** Number of total slots (pre-launch + launched) */
  slotCount: number;
  /** Number of actually running sessions */
  launchedCount: number;
  maxSessions?: number;
  onSelectDirectory: () => void;
  onLaunchAll: () => void;
  onAddSession?: () => void;
}

export function BottomBar({
  inGridView,
  slotCount,
  launchedCount,
  maxSessions = 6,
  onSelectDirectory,
  onLaunchAll,
  onAddSession,
}: BottomBarProps) {
  const hasUnlaunchedSlots = slotCount > launchedCount;
  const unlaunchedCount = slotCount - launchedCount;

  return (
    <div className="no-select relative flex h-11 items-center justify-center gap-3 px-4">
      <button
        type="button"
        onClick={inGridView ? undefined : onSelectDirectory}
        disabled={inGridView}
        className={`flex items-center gap-2 rounded-lg border border-maestro-border bg-maestro-card px-4 py-1.5 text-xs font-medium shadow-md shadow-black/20 transition-colors ${
          inGridView
            ? "cursor-not-allowed text-maestro-muted/50 opacity-50"
            : "text-maestro-text hover:bg-maestro-border/50"
        }`}
      >
        <FolderOpen size={13} />
        Select Directory
      </button>

      {inGridView && (
        <button
          type="button"
          onClick={onAddSession}
          disabled={slotCount >= maxSessions}
          className="flex items-center gap-2 rounded-lg border border-maestro-border bg-maestro-card px-4 py-1.5 text-xs font-medium shadow-md shadow-black/20 transition-colors text-maestro-text hover:bg-maestro-border/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={13} />
          Add Session
        </button>
      )}

      {(hasUnlaunchedSlots || !inGridView) && (
        <button
          type="button"
          onClick={unlaunchedCount > 0 ? onLaunchAll : undefined}
          disabled={unlaunchedCount === 0}
          className="flex items-center gap-2 rounded-lg bg-maestro-accent px-4 py-1.5 text-xs font-medium text-white shadow-md shadow-black/20 transition-colors hover:bg-maestro-accent/80 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play size={11} fill="currentColor" />
          {unlaunchedCount === 0
            ? "Launch Sessions"
            : unlaunchedCount === 1
              ? "Launch Session"
              : `Launch All (${unlaunchedCount})`}
        </button>
      )}

      <div className="absolute right-4 top-1/2 -translate-y-1/2">
        <UsageBar />
      </div>
    </div>
  );
}
